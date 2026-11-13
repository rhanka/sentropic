import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { executionNodeQueue, statelessNodeSources } from '../../src/services/artifacts/live/execution-node-queue';
import { executionNodeStorage } from '../../src/services/artifacts/live/execution-node-storage';
import { selectSandboxBackend, sandboxBackendKind } from '../../src/services/artifacts/live/sandbox-backend';
import { ExecutionNodeAdapter, nodeHash } from '../../src/services/artifacts/live/execution-node-adapter';
import { executionNodeHeartbeat } from '../../src/services/artifacts/live/execution-node-heartbeat';
import type { Pool } from 'pg';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
describe('execution node API policies', () => {
  it('should alternate eligible tenant heads and include active service in the two-job cap', async () => {
    const queue = executionNodeQueue(); const release = deferred(); const order: string[] = [];
    const first = queue.run('sentropic', async () => { order.push('s1'); await release.promise; });
    const second = queue.run('sentropic', async () => { order.push('s2'); });
    const other = queue.run('immo', async () => { order.push('i1'); });
    await expect(queue.run('sentropic', async () => {})).rejects.toMatchObject({ status: 429 });
    release.resolve(); await Promise.all([first, second, other]); expect(order).toEqual(['s1', 'i1', 's2']);
  });
  it('should coalesce concurrent observations only within the same tenant and authorize fresh later heads', async () => {
    const release = deferred(); const observe = vi.fn(async key => { await release.promise; return key; });
    const source = statelessNodeSources(observe);
    const one = source('sentropic', 'repo:g1'); const two = source('sentropic', 'repo:g1');
    const foreign = source('immo', 'repo:g1');
    expect(one).toBe(two); expect(one).not.toBe(foreign); expect(observe).toHaveBeenCalledTimes(2);
    release.resolve(); await Promise.all([one, two, foreign]); await source('sentropic', 'repo:g1');
    expect(observe).toHaveBeenCalledTimes(3);
  });
  it('should leave rollback lazy and refuse unknown backend names', () => {
    const k8s = vi.fn(() => 'existing-pool'); const node = vi.fn(() => 'node');
    expect(selectSandboxBackend({}, { kubernetes: k8s, executionNode: node })).toBe('existing-pool');
    expect(node).not.toHaveBeenCalled(); expect(sandboxBackendKind({})).toBe('kubernetes');
    expect(() => sandboxBackendKind({ ARTIFACT_SANDBOX_BACKEND: 'automatic' })).toThrow();
  });
  it('should presign only BHS tenant/environment objects and reject cross-tenant paths', () => {
    const env: Record<string, string> = {};
    for (const tenant of ['SENTROPIC', 'IMMO']) {
      const values = { ACCESS_KEY_ID: 'synthetic-access', SECRET_ACCESS_KEY: 'synthetic-secret', BUCKET: 'sentropic-execution-bhs',
        ENDPOINT: 'https://s3.bhs.io.cloud.ovh.net', PREFIX: `tenants/${tenant.toLowerCase()}/preprod/`, REGION: 'bhs', USERID: 'synthetic' };
      for (const [key, value] of Object.entries(values)) env[`SANDBOX_S3_${tenant}_${key}`] = value;
    }
    const storage = executionNodeStorage(env, 'preprod');
    const url = storage.presign('sentropic', 'builds/attempt.tar.gz', 'PUT', new Date('2026-11-13T12:00:00Z'));
    expect(new URL(url).pathname).toBe('/sentropic-execution-bhs/tenants/sentropic/preprod/builds/attempt.tar.gz');
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('60');
    storage.validateUrl(url, 'sentropic'); expect(() => storage.validateUrl(url, 'immo')).toThrow();
    expect(() => storage.presign('immo', '../other.erofs', 'PUT')).toThrow();
  });
  it('should refuse altered archive bytes even with a valid response envelope', () => {
    const keys = generateKeyPairSync('ed25519');
    const node = new ExecutionNodeAdapter({ url: new URL('https://localhost'), nodeId: 'n', nodeInstanceId: 'i', nodeEpoch: 1,
      provenanceKey: keys.publicKey, ticketKey: keys.privateKey, tls: { ca: Buffer.alloc(0), cert: Buffer.alloc(0), key: Buffer.alloc(0) } },
    async () => { throw new Error('must not connect'); });
    expect(nodeHash('one')).not.toBe(nodeHash('two'));
    expect(() => node.verifyExport({ status: 200, headers: {}, bytes: Buffer.from('tampered') }, {
      physicalUid: 'id', ownership: { tenantId: 'immo' } as never, devScope: {} as never })).toThrow(/invalid_node_provenance/);
  });
  it('should send one heartbeat from the elected database lock holder and release on stop', async () => {
    const sent = deferred(); const query = vi.fn(async (sql: string) => ({ rows: [{ held: sql.includes('try_advisory_lock') }] }));
    const client = { query, on: vi.fn(), removeListener: vi.fn(), release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const node = { config: { nodeId: 'node' }, inspect: vi.fn(async () => {}), heartbeat: vi.fn(async () => { sent.resolve(); }) };
    const leader = executionNodeHeartbeat(pool, node as unknown as ExecutionNodeAdapter, vi.fn());
    leader.start(); leader.start(); await sent.promise; await leader.stop();
    expect(node.heartbeat).toHaveBeenCalledOnce(); expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(true);
  });
  it('should release a candidate database connection when lock acquisition fails', async () => {
    const failed = deferred(); const release = vi.fn();
    const client = { query: vi.fn(async () => { throw new Error('database_unavailable'); }),
      on: vi.fn(), removeListener: vi.fn(), release };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const alarm = vi.fn(() => failed.resolve());
    const node = { config: { nodeId: 'node' }, inspect: vi.fn(), heartbeat: vi.fn() };
    const leader = executionNodeHeartbeat(pool, node as unknown as ExecutionNodeAdapter, alarm);
    leader.start(); await failed.promise; await leader.stop();
    expect(release).toHaveBeenCalledExactlyOnceWith(true); expect(node.heartbeat).not.toHaveBeenCalled();
  });
});
