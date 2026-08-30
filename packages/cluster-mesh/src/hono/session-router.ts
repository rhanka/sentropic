import { idempotencyKey } from '@sentropic/contracts';
import { Hono, type MiddlewareHandler } from 'hono';
import type { ClusterMeshHonoNamespaceModule } from './plugin.js';
import type {
  DeviceRouteHandlers,
  SessionControlPorts,
  SessionPathProjection,
  SessionRouteHandlers,
} from './session-contracts.js';

const path = (base: string, suffix = ''): string =>
  suffix ? `${base === '/' ? '' : base}${suffix}` : base;

interface ControlIntent {
  readonly commandId: string;
  readonly targetRegistrationId: string;
  readonly idempotencyKey: string;
}

const parseIntent = (value: unknown): ControlIntent | null => {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.commandId !== 'string' || !body.commandId
    || typeof body.targetRegistrationId !== 'string' || !body.targetRegistrationId
    || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey
  ) return null;
  return body as unknown as ControlIntent;
};

export const isValidSessionControlIntent = (value: unknown): boolean => parseIntent(value) !== null;

export function createSessionNamespaceModule(input: {
  readonly handlers: SessionRouteHandlers;
  readonly devices: DeviceRouteHandlers;
  readonly projection: SessionPathProjection;
  readonly control: SessionControlPorts;
  readonly enabled?: boolean;
}): ClusterMeshHonoNamespaceModule {
  return {
    namespace: '/session',
    enabled: input.enabled ?? true,
    createRouter(ports) {
      const router = new Hono();
      const ensureAuthor: MiddlewareHandler = async (c, next) => {
        const author = await input.control.author.ensureAuthor();
        if (!author.ok) return c.json({ error: author.reason }, 503);
        return next();
      };
      router.get(path(input.projection.session), ensureAuthor, input.handlers.current);
      router.post(path(input.projection.session, '/refresh'), ensureAuthor, input.handlers.refresh);
      router.post(path(input.projection.session, '/extension-token'), ensureAuthor, input.handlers.extensionToken);
      router.delete(path(input.projection.session), ensureAuthor, input.handlers.logout);
      router.delete(path(input.projection.session, '/all'), ensureAuthor, input.handlers.logoutAll);
      router.get(path(input.projection.session, '/list'), ensureAuthor, input.handlers.list);
      router.post(path(input.projection.device, '/code'), ensureAuthor, input.devices.issue);
      router.post(path(input.projection.device, '/poll'), ensureAuthor, input.devices.poll);
      router.post(path(input.projection.device, '/approve'), ensureAuthor, input.devices.approve);

      for (const action of ['drive', 'wake', 'relaunch'] as const) {
        router.post(path(input.projection.control, `/${action}`), ensureAuthor, async (c) => {
          const intent = parseIntent(await c.req.json().catch(() => null));
          if (!intent) return c.json({ error: 'invalid_control_intent' }, 400);
          let context;
          try {
            context = await ports.context.verify({
              invocationId: intent.commandId,
              correlationId: c.req.header('x-correlation-id') ?? intent.commandId,
              generationId: input.control.runtime.generation.generationId,
              method: c.req.method,
              path: c.req.path,
              authorizationEvidenceRef: c.req.header('x-cluster-mesh-evidence'),
            });
          } catch {
            return c.json({ error: 'unverified_invocation_context' }, 401);
          }
          const coordinates = {
            commandId: intent.commandId,
            invocationId: context.invocationId,
            correlationId: context.correlationId,
            idempotencyKey: idempotencyKey(intent.idempotencyKey),
          };
          await input.control.runtime.receipts.transported(coordinates);
          const inserted = await input.control.store.enqueueCommand({
            commandId: intent.commandId,
            generationId: input.control.runtime.generation.generationId,
            targetRegistrationId: intent.targetRegistrationId,
            idempotencyKey: intent.idempotencyKey,
            action,
            status: 'pending',
          });
          if (!inserted) return c.json({ error: 'duplicate_command' }, 409);
          const decision = await input.control.runtime.registration.authorize(context);
          if (!decision.ok) {
            await input.control.runtime.receipts.verified(coordinates, 'refused', decision.reason);
            await input.control.store.updateCommand(intent.commandId, {
              status: 'refused', refusalReason: decision.reason,
            });
            const actuatorRef = context.registration?.actuatorRef;
            if (actuatorRef) {
              const state = await input.control.targets.inspect(actuatorRef);
              if (state === 'dead' || state === 'parked') {
                await input.control.store.markRegistrationLost(
                  context.registration!.registrationId,
                  (input.control.now ?? (() => new Date()))().toISOString(),
                );
              }
            }
            return c.json({ error: decision.reason }, 409);
          }
          const reservation = input.control.runtime.admission.reserveBeforeSpawn({
            reservationId: intent.commandId,
            subjectRef: intent.targetRegistrationId,
          });
          if (!reservation.ok) {
            await input.control.runtime.receipts.verified(coordinates, 'refused', reservation.reason);
            await input.control.store.updateCommand(intent.commandId, {
              status: 'refused', refusalReason: reservation.reason,
            });
            return c.json({ error: reservation.reason }, 429);
          }
          await input.control.runtime.receipts.verified(coordinates, 'accepted');
          await input.control.store.updateCommand(intent.commandId, { status: 'accepted' });
          try {
            let result;
            try {
              result = await decision.actuator.actuate({
                registration: decision.registration,
                action,
                commandRef: intent.commandId,
              });
            } catch {
              await input.control.store.updateCommand(intent.commandId, {
                status: 'failed', refusalReason: 'actuation_failed',
              });
              return c.json({ error: 'actuation_failed' }, 502);
            }
            const actedAt = (input.control.now ?? (() => new Date()))().toISOString();
            try {
              await input.control.store.updateCommand(intent.commandId, { status: 'acted', actedAt });
              await input.control.runtime.receipts.acted(coordinates, result.effectRef);
            } catch {
              return c.json({
                error: 'post_effect_persistence_failed', status: 'acted', effectRef: result.effectRef,
              }, 500);
            }
            return c.json({
              status: 'acted', effectRef: result.effectRef,
              ...(result.actedTargets ? { actedTargets: result.actedTargets } : {}),
            });
          } finally {
            input.control.runtime.admission.release(intent.commandId);
          }
        });
      }
      return router;
    },
  };
}
