import type { VerifiedInvocationContext } from '@sentropic/contracts';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCliNamespaceModule,
  createClusterMeshPlugin,
  createClusterMeshRuntime,
  type CliCommandIntentAdapter,
  type CliSessionDelegatePort,
} from '../src/index.js';

const verified: VerifiedInvocationContext = {
  invocationId: 'invocation-1', correlationId: 'correlation-1', generationId: 'generation-1',
  principal: { principalId: 'principal-1', kind: 'human', verifierId: 'verifier-1' },
  workspace: { bindingId: 'binding-1', workspaceId: 'workspace-1', revision: '1' },
  registration: {
    registrationId: 'registration-1', generationId: 'generation-1', workspaceId: 'workspace-1',
    actuatorRef: 'pty:session-1', custodyEpoch: 1, expiresAt: '2026-09-02T00:00:00.000Z',
  },
  scopes: ['cli:invoke'], policyRevision: 'policy-1', issuedAt: '2026-09-01T12:00:00.000Z',
};
const verify = vi.fn(async () => verified);
const runtime = createClusterMeshRuntime({
  generationId: 'generation-1', config: { capacity: { poolSize: 1 } }, context: { verify },
  registration: { authorize: vi.fn(async () => ({ ok: false, reason: 'missing_registration' })) },
  receipts: { append: vi.fn(async () => undefined) },
});
const parseIntent = vi.fn((argv: readonly string[]) => ({
  runnerId: 'harness', source: '@sentropic/harness', argv: [...argv],
}));
const adapter: CliCommandIntentAdapter = {
  runnerId: 'harness', source: '@sentropic/harness', parseIntent,
};
const delegate = vi.fn(async () => Response.json({ status: 'acted', receiptRef: 'receipt-1' }));
const session: CliSessionDelegatePort = { kind: 'session-control-http', delegate };

const appWith = (input: Parameters<typeof createCliNamespaceModule>[0] = {}) => new Hono()
  .route('/api/v1', createClusterMeshPlugin({
    runtime,
    namespaces: [createCliNamespaceModule({
      enabled: true, generationId: 'generation-1', adapters: [adapter], session, ...input,
    })],
  }));
const request = (app: Hono, path: string, body: unknown) => app.request(`/api/v1/cli${path}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-cluster-mesh-invocation-id': 'invocation-1',
    'x-cluster-mesh-evidence': 'evidence-1',
  },
  body: JSON.stringify(body),
});

describe('cluster mesh CLI router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shadows package command parsing without delegating an effect', async () => {
    const response = await request(appWith(), '/intents', {
      runnerId: 'harness', argv: ['verify', '--category', 'unit'],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'shadow', effectsDuplicated: false,
      intent: {
        runnerId: 'harness', source: '@sentropic/harness',
        argv: ['verify', '--category', 'unit'],
      },
    });
    expect(parseIntent).toHaveBeenCalledOnce();
    expect(delegate).not.toHaveBeenCalled();
  });

  it('delegates drive only to the canonical session HTTP surface', async () => {
    const response = await request(appWith(), '/delegations/drive', {
      runnerId: 'harness', argv: ['verify'], commandId: 'command-1',
      targetRegistrationId: 'registration-1', idempotencyKey: 'idem-1',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'acted', receiptRef: 'receipt-1' });
    expect(delegate).toHaveBeenCalledWith({
      method: 'POST', path: '/auth/session/control/drive',
      headers: {
        'content-type': 'application/json', 'x-cluster-mesh-invocation-id': 'invocation-1',
        'x-correlation-id': 'correlation-1', 'x-cluster-mesh-evidence': 'evidence-1',
      },
      body: {
        commandId: 'command-1', targetRegistrationId: 'registration-1', idempotencyKey: 'idem-1',
      },
    });
  });

  it('refuses a missing registration before parsing or delegation', async () => {
    verify.mockResolvedValueOnce({ ...verified, registration: undefined });
    const response = await request(appWith(), '/delegations/wake', {
      runnerId: 'harness', argv: ['verify'], commandId: 'command-2',
      targetRegistrationId: 'registration-1', idempotencyKey: 'idem-2',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'missing_registration' });
    expect(parseIntent).not.toHaveBeenCalled();
    expect(delegate).not.toHaveBeenCalled();
  });

  it.each(['process', 'pty', 'session'])('rejects direct %s authority', async (authority) => {
    const response = await request(appWith(), '/intents', {
      runnerId: 'harness', argv: ['verify'], [authority]: { command: 'forbidden' },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_cli_command_intent' });
    expect(parseIntent).not.toHaveBeenCalled();
  });

  it('fails closed when the runner or canonical session delegate is absent', async () => {
    const missingRunner = await request(appWith({ adapters: [] }), '/intents', {
      runnerId: 'harness', argv: ['verify'],
    });
    expect(missingRunner.status).toBe(503);
    const missingSession = await request(appWith({ session: undefined }), '/delegations/relaunch', {
      runnerId: 'harness', argv: ['verify'], commandId: 'command-3',
      targetRegistrationId: 'registration-1', idempotencyKey: 'idem-3',
    });
    expect(missingSession.status).toBe(503);
    expect(delegate).not.toHaveBeenCalled();
  });

  it('is independently disableable with no fallback path', async () => {
    const app = new Hono().route('/api/v1', createClusterMeshPlugin({
      runtime, namespaces: [createCliNamespaceModule()],
    }));
    expect((await request(app, '/intents', { runnerId: 'harness', argv: [] })).status).toBe(404);
  });
});
