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
  readonly commandRef: string;
  readonly targetRegistrationId: string;
  readonly idempotencyKey: string;
}

const parseIntent = (value: unknown): ControlIntent | null => {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.commandRef !== 'string' || !body.commandRef
    || typeof body.targetRegistrationId !== 'string' || !body.targetRegistrationId
    || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey
  ) return null;
  return body as unknown as ControlIntent;
};

export const isValidSessionControlIntent = (value: unknown): boolean => parseIntent(value) !== null;

/**
 * The composition-root MUST mount the session module such that `[mount-prefix] +
 * projection.control` resolves EXACTLY `/auth/session/control`, matching the fixed
 * `CliSessionDelegatePort` template `/auth/session/control/:action`. A CLI delegation
 * reaches the actuator only through this verified session control (the PDP gate), never
 * directly. This repository mounts the module at `/api/v1/auth/session/control`; the
 * remaining source gap is the h2a client base URL including `/api/v1`, not this mount.
 * Wire identity is preserved: CLI `commandId` == session body `commandRef` == evidence
 * `invocationId` == store `commandId`.
 */
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
              invocationId: intent.commandRef,
              correlationId: c.req.header('x-correlation-id') ?? intent.commandRef,
              generationId: input.control.runtime.generation.generationId,
              method: c.req.method,
              path: c.req.path,
              targetRegistrationId: intent.targetRegistrationId,
              idempotencyKey: intent.idempotencyKey,
              receiptStages: ['transported', 'verified', 'acted'],
              authorizationEvidenceRef: c.req.header('x-cluster-mesh-evidence'),
            });
          } catch {
            return c.json({ error: 'unverified_invocation_context' }, 401);
          }
          if (context.registration?.registrationId !== intent.targetRegistrationId) {
            return c.json({ error: 'registration_mismatch' }, 409);
          }
          const coordinates = {
            commandId: intent.commandRef,
            invocationId: context.invocationId,
            correlationId: context.correlationId,
            idempotencyKey: idempotencyKey(intent.idempotencyKey),
          };
          await input.control.runtime.receipts.transported(coordinates);
          const inserted = await input.control.store.enqueueCommand({
            commandId: intent.commandRef,
            generationId: input.control.runtime.generation.generationId,
            targetRegistrationId: intent.targetRegistrationId,
            idempotencyKey: intent.idempotencyKey,
            action,
            status: 'pending',
          });
          if (!inserted) return c.json({ error: 'duplicate_command' }, 409);
          let decision;
          try {
            decision = await input.control.runtime.registration.authorize(context, action);
          } catch {
            await input.control.store.updateCommand(intent.commandRef, {
              status: 'failed', refusalReason: 'authorization_failed',
            });
            return c.json({ error: 'authorization_failed' }, 502);
          }
          if (!decision.ok) {
            await input.control.runtime.receipts.verified(coordinates, 'refused', decision.reason);
            await input.control.store.updateCommand(intent.commandRef, {
              status: 'refused', refusalReason: decision.reason,
            });
            if (decision.reason === 'actuator_unavailable') {
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
            }
            return c.json({ error: decision.reason }, 409);
          }
          let resolvedInstruction;
          try {
            resolvedInstruction = await input.control.instructions.resolve({
              commandRef: intent.commandRef,
              registrationId: decision.registration.registrationId,
              action,
            });
          } catch {
            await input.control.store.updateCommand(intent.commandRef, {
              status: 'failed', refusalReason: 'instruction_resolution_failed',
            });
            return c.json({ error: 'instruction_resolution_failed' }, 502);
          }
          if (!resolvedInstruction) {
            await input.control.runtime.receipts.verified(coordinates, 'refused', 'command_unresolved');
            await input.control.store.updateCommand(intent.commandRef, {
              status: 'refused', refusalReason: 'command_unresolved',
            });
            return c.json({ error: 'command_unresolved' }, 409);
          }
          const reservation = input.control.runtime.admission.reserveBeforeSpawn({
            reservationId: intent.commandRef,
            subjectRef: intent.targetRegistrationId,
          });
          if (!reservation.ok) {
            await input.control.runtime.receipts.verified(coordinates, 'refused', reservation.reason);
            await input.control.store.updateCommand(intent.commandRef, {
              status: 'refused', refusalReason: reservation.reason,
            });
            return c.json({ error: reservation.reason }, 429);
          }
          await input.control.runtime.receipts.verified(coordinates, 'accepted');
          await input.control.store.updateCommand(intent.commandRef, { status: 'accepted' });
          try {
            let result;
            try {
              result = await decision.actuator.actuate({
                registration: decision.registration,
                action,
                commandRef: intent.commandRef,
                resolvedInstruction,
              });
            } catch {
              await input.control.store.updateCommand(intent.commandRef, {
                status: 'failed', refusalReason: 'actuation_failed',
              });
              return c.json({ error: 'actuation_failed' }, 502);
            }
            if (result.outcome !== 'acted' && result.outcome !== 'deferred') {
              await input.control.store.updateCommand(intent.commandRef, {
                status: 'failed', refusalReason: 'actuation_failed',
              });
              return c.json({
                error: 'actuation_failed', status: 'failed', effectRef: result.effectRef,
                ...(result.actedTargets ? { actedTargets: result.actedTargets } : {}),
              }, 502);
            }
            if (result.outcome === 'deferred') {
              await input.control.store.updateCommand(intent.commandRef, { status: 'deferred' });
              return c.json({
                status: 'deferred', effectRef: result.effectRef,
                ...(result.actedTargets ? { actedTargets: result.actedTargets } : {}),
              }, 202);
            }
            const actedAt = (input.control.now ?? (() => new Date()))().toISOString();
            try {
              await input.control.store.updateCommand(intent.commandRef, { status: 'acted', actedAt });
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
            input.control.runtime.admission.release(intent.commandRef);
          }
        });
      }
      return router;
    },
  };
}
