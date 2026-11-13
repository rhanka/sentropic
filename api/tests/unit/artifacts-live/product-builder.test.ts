import { generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Pool } from 'pg';
import {
  ARTIFACT_BUILDER_BASE_PATH, ARTIFACT_BUILDER_SCOPE, createBuilderMount, hostAuthenticator, parseBuilderHostBindings,
} from '../../../src/services/artifacts/live/builder-mount';
import { LiveError } from '../../../src/services/artifacts/live/records';
import {
  CACHE_S3_ACCESS_KEY_ID_ENV, CACHE_S3_BUCKET_ENV, CACHE_S3_ENDPOINT_ENV, CACHE_S3_REGION_ENV,
  CACHE_S3_SECRET_ACCESS_KEY_ENV,
} from '../../../src/services/artifacts/live/cache-storage';
import { createProductBuilder, SCHEDULER_INTERVAL_MS, type ProductBuilderDeps } from '../../../src/services/artifacts/live/product-builder';
import { remoteHostForge } from '../../../src/services/artifacts/live/forge';
import type { KubernetesCore } from '../../../src/services/artifacts/live/pods';
import { key } from './fixture';

const der = (k: KeyObject, type: 'pkcs8' | 'spki') => k.export({ type, format: 'der' } as never).toString('base64');
const signing = (kid: string) => JSON.stringify({ kid, privateKey: der(generateKeyPairSync('ed25519').privateKey, 'pkcs8') });
const immo = { clientId: 'immo-builder-client', hostId: 'immo', storageScopeId: 'immo' };
const ENV: Record<string, string> = {
  ARTIFACT_BUILDER_ENABLED: '1',
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
  ARTIFACT_BUILDER_CACHE_S3_BUCKET: 'builder-dependency-cache-test',
  ARTIFACT_BUILDER_CACHE_S3_REGION: 'fr-par',
  ARTIFACT_BUILDER_CACHE_S3_ACCESS_KEY_ID: 'builder-cache-test-access-key',
  ARTIFACT_BUILDER_CACHE_S3_SECRET_ACCESS_KEY: 'builder-cache-test-secret',
};
/** Presence-only settings (the cache S3 values): an arbitrary value IS a value, so only an absent or blank one refuses. */
const PRESENCE_ONLY = [CACHE_S3_BUCKET_ENV, CACHE_S3_REGION_ENV, CACHE_S3_ACCESS_KEY_ID_ENV, CACHE_S3_SECRET_ACCESS_KEY_ENV];
/** Fake Postgres: no live runtime, no row; the composition must not query it before a request or a tick. */
function deps() {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  const kubernetes = vi.fn((): KubernetesCore => ({ get: vi.fn(), create: vi.fn(), delete: vi.fn(), waitDeleted: vi.fn() }));
  const authenticate = hostAuthenticator(parseBuilderHostBindings(ENV.ARTIFACT_BUILDER_HOST_BINDINGS_JSON));
  const cacheBlobs = vi.fn(() => ({ put: vi.fn(), get: vi.fn(), delete: vi.fn() }));
  const value: ProductBuilderDeps = { pool, cacheBlobs, authenticate,
    kubernetes, gitHubApp: null, log: vi.fn(), fetch: vi.fn() as unknown as typeof fetch };
  return { ...value, query, kubernetes, cacheBlobs };
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
  it('should compose the configured node backend without initializing Kubernetes or requiring B1 hydration at boot', () => {
    const d = deps(); const keys = generateKeyPairSync('ed25519');
    const product = createProductBuilder({ ...ENV, ARTIFACT_SANDBOX_BACKEND: 'execution-node',
      ARTIFACT_EXECUTION_NODE_URL: 'https://node.example.test:8443', ARTIFACT_EXECUTION_NODE_ID: 'node',
      ARTIFACT_EXECUTION_NODE_INSTANCE_ID: 'instance', ARTIFACT_EXECUTION_NODE_EPOCH: '2',
      ARTIFACT_EXECUTION_NODE_PROVENANCE_PUBLIC_KEY_B64: Buffer.from(keys.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
      ARTIFACT_EXECUTION_TICKET_ED25519_KEY_B64: Buffer.from(keys.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
      SANDBOX_MTLS_CA_CERT_B64: Buffer.from('synthetic').toString('base64'),
      SANDBOX_MTLS_CONTROL_PLANE_CERT_B64: Buffer.from('synthetic').toString('base64'),
      SANDBOX_MTLS_CONTROL_PLANE_KEY_B64: Buffer.from('synthetic').toString('base64') }, d);
    expect(product).not.toBeNull(); expect(d.kubernetes).not.toHaveBeenCalled(); expect(d.query).not.toHaveBeenCalled();
  });
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

  it('should refuse gracefully when a required value is missing or invalid: one artifact_builder_refused log naming the variable, never its value, no builder, no kubernetes client', async () => {
    for (const name of Object.keys(ENV).filter(name => name !== 'ARTIFACT_BUILDER_ENABLED')) {
      for (const value of [undefined, '', ...(PRESENCE_ONLY.includes(name) ? [] : ['invalid?'])] as (string | undefined)[]) {
        const d = deps();
        expect(createProductBuilder({ ...ENV, [name]: value }, d), name).toBeNull();
        expect(d.log, name).toHaveBeenCalledTimes(1);
        expect(d.log, name).toHaveBeenCalledWith('artifact_builder_refused',
          expect.objectContaining({ code: 'builder_unavailable', reason: name }));
        expect(d.kubernetes, name).not.toHaveBeenCalled();
      }
    }
    // The refusal names the variable and carries its value nowhere in the log payload.
    const d = deps();
    createProductBuilder({ ...ENV, ARTIFACT_LIVE_CONTROLLER_KEY: 'sentropic-test-live-1=c2hvcnQ' }, d);
    const [event, refused] = d.log.mock.calls[0] as [string, LiveError];
    expect(event).toBe('artifact_builder_refused');
    expect(refused.reason).toBe('ARTIFACT_LIVE_CONTROLLER_KEY');
    expect(JSON.stringify(refused)).not.toContain('c2hvcnQ');
    const post = mounted(null, d);
    expect((await post('/v1/builds', {})).status).toBe(503);
    expect(await (await post('/v1/live/reconcile', {})).json()).toEqual({ error: 'builder_unavailable' });
  });

  it('should read the dependency-cache storage from its own S3 settings, with no APP_ARTIFACT_HOST_ENABLED requirement (F1)', () => {
    // The sentropic artifacts MCP host stays disabled: the builder composes anyway.
    const d = deps();
    expect(createProductBuilder({ ...ENV, APP_ARTIFACT_HOST_ENABLED: '0' }, d)).not.toBeNull();
    expect(d.cacheBlobs).toHaveBeenCalledTimes(1);
    expect(d.cacheBlobs).toHaveBeenCalledWith({ bucket: ENV.ARTIFACT_BUILDER_CACHE_S3_BUCKET,
      region: ENV.ARTIFACT_BUILDER_CACHE_S3_REGION, accessKeyId: ENV.ARTIFACT_BUILDER_CACHE_S3_ACCESS_KEY_ID,
      secretAccessKey: ENV.ARTIFACT_BUILDER_CACHE_S3_SECRET_ACCESS_KEY });
    // An optional S3-compatible endpoint is carried through (forcePathStyle storage, e.g. MinIO in tests).
    const endpoint = deps();
    createProductBuilder({ ...ENV, [CACHE_S3_ENDPOINT_ENV]: 'http://minio.example.test:9000' }, endpoint);
    expect(endpoint.cacheBlobs).toHaveBeenCalledWith({ bucket: ENV.ARTIFACT_BUILDER_CACHE_S3_BUCKET,
      region: ENV.ARTIFACT_BUILDER_CACHE_S3_REGION, accessKeyId: ENV.ARTIFACT_BUILDER_CACHE_S3_ACCESS_KEY_ID,
      secretAccessKey: ENV.ARTIFACT_BUILDER_CACHE_S3_SECRET_ACCESS_KEY, endpoint: 'http://minio.example.test:9000' });
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
  it('should accept, read-only, a fast-forward the host already made: the branch head is the new head and the old one its ancestor', async () => {
    const before = 'a'.repeat(40); const after = 'b'.repeat(40);
    const reads = { head: vi.fn(async () => after), reachable: vi.fn(async () => true), snapshot: vi.fn(), source: vi.fn() };
    const forge = remoteHostForge(reads as never);
    await expect(forge.fastForward(key, before, after)).resolves.toBe(true);
    expect(reads.reachable).toHaveBeenCalledWith(key, before);
    await expect(forge.head(key)).resolves.toBe(after);
    expect(reads.head).toHaveBeenCalledWith(key);
  });

  it('should report a divergence when the branch head is not the new head or the old head is not its ancestor', async () => {
    const before = 'a'.repeat(40); const after = 'b'.repeat(40);
    const moved = remoteHostForge({ head: vi.fn(async () => 'c'.repeat(40)), reachable: vi.fn(async () => true),
      snapshot: vi.fn(), source: vi.fn() } as never);
    await expect(moved.fastForward(key, before, after)).resolves.toBe(false);
    const rewritten = remoteHostForge({ head: vi.fn(async () => after), reachable: vi.fn(async () => false),
      snapshot: vi.fn(), source: vi.fn() } as never);
    await expect(rewritten.fastForward(key, before, after)).resolves.toBe(false);
  });

  it('should refuse a git binding as forge_unconfigured while the GitHub App host or the repositories are absent', async () => {
    const d = deps(); const post = mounted(createProductBuilder(ENV, d)!.api as never, d);
    const response = await post('/v1/live/reconcile', { artifactId: key.artifactId, bindingGeneration: 1, ownerId: 'owner',
      liveSessionId: 's1', leaseEpoch: 1, routeEpoch: 1, invitation: { epoch: 1, expiresAt: null },
      binding: { repoId: 'repo-immo', branch: 'artifact/demo', subPath: '' } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'builder_unavailable', reason: 'forge_unconfigured' });
    expect(d.query).not.toHaveBeenCalled();
  });
});
