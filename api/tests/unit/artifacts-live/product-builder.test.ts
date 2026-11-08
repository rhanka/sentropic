import { generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Pool } from 'pg';
import {
  ARTIFACT_BUILDER_BASE_PATH, ARTIFACT_BUILDER_SCOPE, createBuilderMount, hostAuthenticator, parseBuilderHostBindings,
} from '../../../src/services/artifacts/live/builder-mount';
import { createProductBuilder, SCHEDULER_INTERVAL_MS, type ProductBuilderDeps } from '../../../src/services/artifacts/live/product-builder';
import { remoteHostForge, UNCONFIGURED_FORGE_READS } from '../../../src/services/artifacts/live/forge';
import type { KubernetesCore } from '../../../src/services/artifacts/live/pods';
import { key } from './fixture';

const der = (k: KeyObject, type: 'pkcs8' | 'spki') => k.export({ type, format: 'der' } as never).toString('base64');
const signing = (kid: string) => JSON.stringify({ kid, privateKey: der(generateKeyPairSync('ed25519').privateKey, 'pkcs8') });
const immo = { clientId: 'immo-builder-client', hostId: 'immo', storageScopeId: 'immo' };
const ENV: Record<string, string> = {
  ARTIFACT_BUILDER_ENABLED: '1', APP_ARTIFACT_HOST_ENABLED: '1',
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
  ARTIFACT_DEPENDENCY_CACHE_SIGNING_KEY: randomBytes(32).toString('base64url'),
  ARTIFACT_BUILDER_NODE: 'd2-4-test',
  ARTIFACT_BUILDER_HOST_BINDINGS_JSON: JSON.stringify([immo]),
};
/** Fake Postgres: no live runtime, no row; the composition must not query it before a request or a tick. */
function deps() {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  const kubernetes = vi.fn((): KubernetesCore => ({ get: vi.fn(), create: vi.fn(), delete: vi.fn(), waitDeleted: vi.fn() }));
  const authenticate = hostAuthenticator(parseBuilderHostBindings(ENV.ARTIFACT_BUILDER_HOST_BINDINGS_JSON));
  const value: ProductBuilderDeps = { pool, cacheBlobs: { put: vi.fn(), get: vi.fn(), delete: vi.fn() }, authenticate,
    kubernetes, forge: UNCONFIGURED_FORGE_READS, log: vi.fn(), fetch: vi.fn() as unknown as typeof fetch };
  return { ...value, query, kubernetes };
}
const requireService: MiddlewareHandler = async (c, next) => {
  c.set('serviceClient' as never, { clientId: c.req.header('x-client') ?? '', scopes: [ARTIFACT_BUILDER_SCOPE], jkt: null } as never);
  await next();
};
function mounted(api: Hono<never> | null, d = deps()) {
  const app = new Hono(); app.route('/', createBuilderMount({ requireService, authenticate: d.authenticate, api: api as never }));
  return (path: string, body: unknown, client = immo.clientId) => app.request(`${ARTIFACT_BUILDER_BASE_PATH}${path}`,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-client': client }, body: JSON.stringify(body) });
}

afterEach(() => { vi.useRealTimers(); });

describe('product builder composition (ARTIFACT_BUILDER_ENABLED)', () => {
  it('should compose nothing and keep the 503 builder_unavailable mount when the flag is absent or not 1', async () => {
    for (const flag of [undefined, '', '0', 'true']) {
      const d = deps();
      expect(createProductBuilder({ ...ENV, ARTIFACT_BUILDER_ENABLED: flag }, d)).toBeNull();
      expect(d.kubernetes).not.toHaveBeenCalled();
    }
    const post = mounted(null);
    expect((await post('/v1/builds', {})).status).toBe(503);
    expect(await (await post('/v1/live/reconcile', {})).json()).toEqual({ error: 'builder_unavailable' });
  });

  it('should route /v1/builds and /v1/live/* to the composed service when the flag is 1', async () => {
    const d = deps();
    const builder = createProductBuilder(ENV, d)!;
    expect(d.kubernetes).toHaveBeenCalledWith({ namespace: ENV.ARTIFACT_BUILDER_NAMESPACE, serviceDomain: ENV.ARTIFACT_BUILDER_SERVICE_DOMAIN });
    const post = mounted(builder.api as never, d);
    for (const path of ['/v1/builds', '/v1/live/reconcile', '/v1/live/stop']) {
      const response = await post(path, { unexpected: true });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    expect((await post('/v1/builds', {}, 'unbound-client')).status).toBe(403);
    expect(d.query).not.toHaveBeenCalled();
  });

  it('should refuse to start, naming the variable and never its value, when a required value is missing or invalid', () => {
    for (const name of Object.keys(ENV).filter(name => name !== 'ARTIFACT_BUILDER_ENABLED')) {
      for (const value of [undefined, 'invalid?']) {
        const run = () => createProductBuilder({ ...ENV, [name]: value }, deps());
        expect(run, name).toThrow(`Artifact builder refused to start: ${name} is missing or invalid`);
      }
    }
    let message = '';
    try { createProductBuilder({ ...ENV, ARTIFACT_LIVE_CONTROLLER_KEY: 'sentropic-test-live-1=c2hvcnQ' }, deps()); }
    catch (error) { message = String(error); }
    expect(message).toContain('ARTIFACT_LIVE_CONTROLLER_KEY');
    expect(message).not.toContain('c2hvcnQ');
  });

  it('should start one live scheduler per process that ticks every 30 s and stops cleanly', async () => {
    vi.useFakeTimers();
    const builder = createProductBuilder(ENV, deps())!;
    const active = vi.spyOn(builder.controller, 'active').mockResolvedValue([]);
    const scheduler = builder.start();
    expect(builder.start()).toBe(scheduler);
    expect(active).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SCHEDULER_INTERVAL_MS * 2);
    expect(active).toHaveBeenCalledTimes(3);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(SCHEDULER_INTERVAL_MS * 2);
    expect(active).toHaveBeenCalledTimes(3);
  });
});

describe('remote-host forge port (D0)', () => {
  it('should refuse a fast-forward: git_commit runs in the host LiveService, never in this controller', async () => {
    const reads = { head: vi.fn(async () => 'a'.repeat(40)), reachable: vi.fn(async () => true), snapshot: vi.fn(), source: vi.fn() };
    const forge = remoteHostForge(reads as never);
    await expect(forge.fastForward(key, 'a'.repeat(40), 'b'.repeat(40)))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'fast_forward_remote_host' });
    await expect(forge.head(key)).resolves.toBe('a'.repeat(40));
    await expect(forge.reachable(key, 'a'.repeat(40))).resolves.toBe(true);
    expect(reads.head).toHaveBeenCalledWith(key);
  });

  it('should refuse every read until the lease reader is composed', async () => {
    const forge = remoteHostForge(UNCONFIGURED_FORGE_READS);
    for (const read of [forge.head(key), forge.reachable(key, 'a'.repeat(40)), forge.snapshot(key, 'a'.repeat(40)),
      UNCONFIGURED_FORGE_READS.source('ref')]) {
      await expect(read).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'forge_unconfigured' });
    }
  });
});
