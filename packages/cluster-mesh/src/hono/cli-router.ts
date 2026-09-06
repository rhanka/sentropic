import { Hono, type MiddlewareHandler } from 'hono';
import type { ClusterMeshHonoNamespaceModule } from './plugin.js';

export const CLI_PATHS = ['/intents', '/delegations/:action'] as const;
export const CLI_CONTROL_ACTIONS = ['drive', 'wake', 'relaunch'] as const;
export type CliControlAction = (typeof CLI_CONTROL_ACTIONS)[number];

export interface CliCommandIntent {
  readonly runnerId: string;
  readonly source: string;
  readonly argv: readonly string[];
}

export interface CliCommandIntentAdapter {
  readonly runnerId: string;
  readonly source: string;
  parseIntent(argv: readonly string[]): CliCommandIntent | null;
}

export interface CliSessionDelegatePort {
  readonly kind: 'session-control-http';
  delegate(input: {
    readonly method: 'POST';
    readonly path: `/auth/session/control/${CliControlAction}`;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: {
      readonly commandId: string;
      readonly targetRegistrationId: string;
      readonly idempotencyKey: string;
    };
  }): Promise<Response>;
}

interface CommandEnvelope {
  readonly runnerId: string;
  readonly argv: readonly string[];
  readonly commandId?: string;
  readonly targetRegistrationId?: string;
  readonly idempotencyKey?: string;
}

const forbiddenAuthority = ['process', 'pty', 'session', 'spawn', 'execute'] as const;

const parseEnvelope = (value: unknown): CommandEnvelope | null => {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (forbiddenAuthority.some((key) => key in body)) return null;
  if (typeof body.runnerId !== 'string' || !body.runnerId) return null;
  if (!Array.isArray(body.argv) || body.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    return null;
  }
  for (const key of ['commandId', 'targetRegistrationId', 'idempotencyKey'] as const) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || !body[key])) return null;
  }
  return body as unknown as CommandEnvelope;
};

const controlAction = (value: string): CliControlAction | null =>
  (CLI_CONTROL_ACTIONS as readonly string[]).includes(value) ? value as CliControlAction : null;

export function createCliNamespaceModule(options: {
  readonly enabled?: boolean;
  readonly generationId?: string;
  readonly authenticate?: MiddlewareHandler;
  readonly adapters?: readonly CliCommandIntentAdapter[];
  readonly session?: CliSessionDelegatePort;
} = {}): ClusterMeshHonoNamespaceModule {
  const adapters = new Map<string, CliCommandIntentAdapter>();
  for (const adapter of options.adapters ?? []) {
    if (adapters.has(adapter.runnerId)) throw new Error(`duplicate CLI runner: ${adapter.runnerId}`);
    adapters.set(adapter.runnerId, adapter);
  }

  return {
    namespace: '/cli',
    enabled: options.enabled ?? false,
    createRouter(ports) {
      const router = new Hono();
      for (const path of CLI_PATHS) router.use(path, options.authenticate ?? (async (_c, next) => next()));

      const prepare = async (c: Parameters<MiddlewareHandler>[0]) => {
        if (!options.generationId) return { error: c.json({ error: 'cli_runtime_unavailable' }, 503) };
        const invocationId = c.req.header('x-cluster-mesh-invocation-id');
        if (!invocationId) return { error: c.json({ error: 'cli_invocation_reference_required' }, 400) };
        let verified;
        try {
          verified = await ports.context.verify({
            invocationId,
            correlationId: c.req.header('x-correlation-id') ?? invocationId,
            generationId: options.generationId,
            method: c.req.method,
            path: c.req.path,
            authorizationEvidenceRef: c.req.header('x-cluster-mesh-evidence'),
          });
        } catch {
          return { error: c.json({ error: 'cli_invocation_unverified' }, 401) };
        }
        if (!verified.registration) return { error: c.json({ error: 'missing_registration' }, 409) };
        const envelope = parseEnvelope(await c.req.json().catch(() => null));
        if (!envelope) return { error: c.json({ error: 'invalid_cli_command_intent' }, 400) };
        const adapter = adapters.get(envelope.runnerId);
        if (!adapter) return { error: c.json({ error: 'cli_runner_unavailable' }, 503) };
        const intent = adapter.parseIntent(envelope.argv);
        if (!intent || intent.runnerId !== adapter.runnerId || intent.source !== adapter.source) {
          return { error: c.json({ error: 'invalid_cli_command_intent' }, 400) };
        }
        return { envelope, intent, verified };
      };

      router.post('/intents', async (c) => {
        const prepared = await prepare(c);
        if ('error' in prepared) return prepared.error;
        return c.json({ status: 'shadow', intent: prepared.intent, effectsDuplicated: false });
      });

      router.post('/delegations/:action', async (c) => {
        const action = controlAction(c.req.param('action'));
        if (!action) return c.json({ error: 'unsupported_session_action' }, 400);
        const prepared = await prepare(c);
        if ('error' in prepared) return prepared.error;
        const { envelope, verified } = prepared;
        if (!envelope.commandId || !envelope.targetRegistrationId || !envelope.idempotencyKey) {
          return c.json({ error: 'invalid_session_control_intent' }, 400);
        }
        if (envelope.targetRegistrationId !== verified.registration!.registrationId) {
          return c.json({ error: 'registration_mismatch' }, 409);
        }
        if (!options.session) return c.json({ error: 'cli_session_delegate_unavailable' }, 503);
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-cluster-mesh-invocation-id': verified.invocationId,
          'x-correlation-id': verified.correlationId,
        };
        const evidence = c.req.header('x-cluster-mesh-evidence');
        if (evidence) headers['x-cluster-mesh-evidence'] = evidence;
        return options.session.delegate({
          method: 'POST',
          path: `/auth/session/control/${action}`,
          headers,
          body: {
            commandId: envelope.commandId,
            targetRegistrationId: envelope.targetRegistrationId,
            idempotencyKey: envelope.idempotencyKey,
          },
        });
      });
      return router;
    },
  };
}
