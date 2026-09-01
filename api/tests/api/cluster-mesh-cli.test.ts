import { readdirSync, readFileSync } from 'node:fs';
import {
  createCliNamespaceModule,
  createClusterMeshPlugin,
  createClusterMeshRuntime,
  type CliCommandIntentAdapter,
  type CliControlAction,
  type CliSessionDelegatePort,
} from '@sentropic/cluster-mesh';
import type { VerifiedInvocationContext } from '@sentropic/contracts';
import { Hono, type MiddlewareHandler } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app as productApp, PREFIX_MOUNTED_NAMESPACE_REGISTRY } from '../../src/app';
import { CLI_ENABLED, CLI_PATHS } from '../../src/routes/namespaces/cli';

const passAuth: MiddlewareHandler = async (_context, next) => next();
const registered: VerifiedInvocationContext = {
  invocationId: 'cli-invocation-1', correlationId: 'cli-correlation-1', generationId: 'generation-1',
  principal: { principalId: 'principal-1', kind: 'human', verifierId: 'verifier-1' },
  workspace: { bindingId: 'binding-1', workspaceId: 'workspace-1', revision: '1' },
  registration: {
    registrationId: 'registration-1', generationId: 'generation-1', workspaceId: 'workspace-1',
    actuatorRef: 'pty:session-1', custodyEpoch: 1, expiresAt: '2026-09-02T00:00:00.000Z',
  },
  scopes: ['cli:invoke'], policyRevision: 'policy-1', issuedAt: '2026-09-01T12:00:00.000Z',
};
const verify = vi.fn(async () => registered);
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
const delegate = vi.fn(async () => Response.json({
  status: 'delegated', receiptRef: 'session-receipt-1',
}));
const session: CliSessionDelegatePort = { kind: 'session-control-http', delegate };

const appWith = () => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime,
  namespaces: [createCliNamespaceModule({
    enabled: true, generationId: 'generation-1', authenticate: passAuth,
    adapters: [adapter], session,
  })],
}));
const invoke = (action: CliControlAction) => appWith().request(`/api/v1/cli/delegations/${action}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-cluster-mesh-invocation-id': 'cli-invocation-1',
  },
  body: JSON.stringify({
    runnerId: 'harness', argv: ['verify'], commandId: `command-${action}`,
    targetRegistrationId: 'registration-1', idempotencyKey: `idem-${action}`,
  }),
});

describe('cluster mesh CLI API composition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers an enumerated fence while remaining disabled without genuine PTY evidence', async () => {
    const registration = PREFIX_MOUNTED_NAMESPACE_REGISTRY.find(({ namespace }) => namespace === '/cli');
    expect(registration).toMatchObject({ mount: '/cli', authPaths: CLI_PATHS });
    expect(registration?.authPaths).not.toBeNull();
    expect(CLI_ENABLED).toBe(false);
    expect((await productApp.request('/api/v1/cli/intents', { method: 'POST' })).status).toBe(404);
    expect((await productApp.request('/api/v1/api/v1/cli/intents', { method: 'POST' })).status).toBe(404);
  });

  it.each(['drive', 'wake', 'relaunch'] as const)(
    'delegates %s exclusively to the canonical session-control HTTP path',
    async (action) => {
      const response = await invoke(action);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: 'delegated', receiptRef: 'session-receipt-1',
      });
      expect(delegate).toHaveBeenCalledWith(expect.objectContaining({
        method: 'POST', path: `/auth/session/control/${action}`,
      }));
    },
  );

  it('fails before parsing or delegation when registration is absent', async () => {
    verify.mockResolvedValueOnce({ ...registered, registration: undefined });
    const response = await invoke('drive');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'missing_registration' });
    expect(parseIntent).not.toHaveBeenCalled();
    expect(delegate).not.toHaveBeenCalled();
  });

  it('proves the legacy direct HTTP command path and mount are absent', async () => {
    const apiFiles = readdirSync('src/routes/api');
    const legacyNames = /^(cli|commands?|terminal|shell)(\.|-)/;
    expect(apiFiles.filter((name) => legacyNames.test(name))).toEqual([]);
    const legacyApiSource = apiFiles
      .filter((name) => name.endsWith('.ts'))
      .map((name) => readFileSync(`src/routes/api/${name}`, 'utf8'))
      .join('\n');
    expect(legacyApiSource).not.toMatch(/\.(?:route|use|post)\(['"]\/(?:cli|commands?|terminal|shell)/);
    for (const path of ['/api/v1/command', '/api/v1/commands', '/api/v1/terminal', '/api/v1/shell']) {
      expect((await productApp.request(path, { method: 'POST' })).status, path).toBe(404);
    }
  });
});
