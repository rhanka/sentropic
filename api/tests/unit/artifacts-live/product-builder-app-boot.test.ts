import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';

const der = (key: KeyObject, type: 'pkcs8' | 'spki') => key.export({ type, format: 'der' } as never).toString('base64');
const signing = (kid: string) =>
  JSON.stringify({ kid, privateKey: der(generateKeyPairSync('ed25519').privateKey, 'pkcs8') });

// The S2S guard (`createRequireServiceAuth`) only admits a token-verified bound host, which a unit
// boot cannot mint; the stub sets that verified identity on the context. Everything else app.ts
// imports stays the real code, so the 503 answer below is the real builder mount, not a mock.
vi.mock('@sentropic/mcp-auth/hono', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stub = () => async (
    c: { set(key: string, value: unknown): void }, next: () => Promise<void>
  ) => {
    c.set('serviceClient', { clientId: 'immo-builder-client', scopes: ['artifacts:builder'], jkt: null });
    await next();
  };
  return { ...actual, createRequireServiceAuth: stub };
});
// Watched so a refused composition provably starts no live scheduler.
vi.mock('../../../src/services/artifacts/live/scheduler', () => ({
  createLiveScheduler: vi.fn(() => ({ start: () => ({ stop: () => undefined }) })),
}));

const VALID: Record<string, string> = {
  ARTIFACT_BUILDER_NAMESPACE: 'sentropic-artifact-builders',
  ARTIFACT_BUILDER_SERVICE_DOMAIN: 'sentropic-artifact-builders.svc.cluster.local',
  ARTIFACT_SUPERVISOR_SIGNING_KEY_JSON: signing('sentropic-test-supervisor-1'),
  ARTIFACT_SUPERVISOR_RELAY_URL: 'http://artifact-content.sentropic-test.svc.cluster.local:8791',
  ARTIFACT_BUILDER_HANDOFF_SIGNING_KEY_JSON: signing('sentropic-test-builder-1'),
  ARTIFACT_BUILDER_HOST_RECEIPT_KEYS_JSON: JSON.stringify([{ kid: 'immo-test-receipt-1',
    publicKey: der(generateKeyPairSync('ed25519').publicKey, 'spki') }]),
  ARTIFACT_BUILDER_REMOTE_HOST_URL: 'https://immo.example.test/api/v1/artifacts',
  ARTIFACT_LIVE_CONTROLLER_KEY: `sentropic-test-live-1=${randomBytes(32).toString('base64url')}`,
  ARTIFACT_LIVE_EDGE_INTERNAL_URL: 'http://artifact-content.sentropic-test.svc.cluster.local:8791',
  ARTIFACT_BUILDER_NODE: 'd2-4-test',
  ARTIFACT_BUILDER_HOST_BINDINGS_JSON: JSON.stringify([
    { clientId: 'immo-builder-client', hostId: 'immo', storageScopeId: 'immo' },
  ]),
};

describe('builder boot refusal keeps the API serving (F2, s-archi review of #951)', () => {
  it('boots with the flag on and one missing value: API 200 on /, builder mount 503, artifact_builder_refused naming the variable, no scheduler', async () => {
    process.env.ARTIFACT_BUILDER_ENABLED = '1';
    delete process.env.ARTIFACT_DEPENDENCY_CACHE_SIGNING_KEY;
    for (const [name, value] of Object.entries(VALID)) process.env[name] = value;
    const { logger } = await import('../../../src/logger');
    const errorSpy = vi.spyOn(logger, 'error');
    const { createLiveScheduler } = await import('../../../src/services/artifacts/live/scheduler');
    const { app } = await import('../../../src/app');
    // The process booted: the refusal is one error log naming the variable, never its value.
    const refused = errorSpy.mock.calls.filter(call => call[1] === 'artifact_builder_refused');
    expect(refused).toEqual([[{ code: 'builder_unavailable', event: 'artifact_builder_refused',
      reason: 'ARTIFACT_DEPENDENCY_CACHE_SIGNING_KEY' }, 'artifact_builder_refused']]);
    // The rest of the API keeps serving.
    const root = await app.request('/');
    expect(root.status).toBe(200);
    expect(await root.json()).toEqual({ name: 'Sentropic API', version: '0.1.0' });
    // The builder mount stays up and answers 503 builder_unavailable to a bound host.
    const build = await app.request('/api/v1/artifacts/builder/v1/builds', { method: 'POST', body: '{}' });
    expect(build.status).toBe(503);
    expect(await build.json()).toEqual({ error: 'builder_unavailable' });
    // No live scheduler was started for the refused builder.
    expect(createLiveScheduler).not.toHaveBeenCalled();
  });
});
