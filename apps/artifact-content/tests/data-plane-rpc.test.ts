import { afterEach, describe, expect, it } from 'vitest';
import { fakeDataPlane, subject } from './data-plane-fixture';
import { fakeCustodyApi } from './data-plane-rpc-fixture';
import { custodyIssuerFromEnv } from '../src/custody-issuer';
import { dataPlaneFromEnv } from '../src/data-plane';
import { dataPlaneFetch } from '../src/data-plane-http';
import { startContentServer } from '../src/index';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const node = await fakeDataPlane(); cleanup.push(() => node.close()); node.setTtl(10_000);
  const api = await fakeCustodyApi(node.issuer); cleanup.push(() => api.close());
  return { node, api };
}
describe('API custody RPC client', () => {
  it('should authenticate exact HTTP bytes, preserve all lease fields and forward the API-owned supervisor port', async () => {
    const { node, api } = await fixture(); node.setPort(8792);
    const transport = dataPlaneFromEnv(node.env, api.replica())!;
    const response = await dataPlaneFetch(transport, subject, '/_supervisor/v1/frame', {
      method: 'POST', headers: {}, signal: AbortSignal.timeout(2000), maxBytes: 1024,
    });
    expect(await response.text()).toBe('live');
    expect(node.received[0].url).toBe('/v1/ports/8792/_supervisor/v1/frame');
    expect(api.requests.map(req => req.operation)).toEqual(['watch', 'issue', 'watch']);
    expect(api.requests.every(req => req.authenticated && req.subject.kind === 'supervisor')).toBe(true);
  });
  it.each(['revoke', 'change', 'hang', 'oversized'] as const)('should revoke all replicas and refuse renewed custody when API watch %s', async action => {
    const { node, api } = await fixture();
    let first!: () => void; let second!: () => void;
    const ended = Promise.all([new Promise<void>(resolve => { first = resolve; }), new Promise<void>(resolve => { second = resolve; })]);
    const replicas = [api.replica(), api.replica()];
    const unwatch = [replicas[0].watch(subject, first), replicas[1].watch(subject, second)];
    try {
      const leases = await Promise.all(replicas.map(replica => replica.issue(subject, AbortSignal.timeout(2000))));
      expect(leases[0]).toMatchObject({ tenantId: 'sentropic', principalId: 'principal', physicalUid: 'physical-1', custodyEpoch: 1, port: 5173 });
      expect(leases[0].token.split('.')).toHaveLength(3);
      api[action](); await ended;
      for (const replica of replicas) await expect(replica.issue(subject, AbortSignal.timeout(2000))).rejects.toThrow('custody_revoked');
      expect(node.received).toHaveLength(0);
    } finally { unwatch.forEach(stop => stop()); }
  });
  it('should discard a token if authority changes between the pre-issue and post-issue watches', async () => {
    const { api } = await fixture(); api.changeOnIssue();
    const issuer = api.replica(); const stop = issuer.watch(subject, () => {});
    try { await expect(issuer.issue(subject, AbortSignal.timeout(2000))).rejects.toThrow('custody_revoked'); }
    finally { stop(); }
  });
  it('should cut pending HTTP on every replica and refuse new issuance after API revocation', async () => {
    const { node, api } = await fixture(); let started!: () => void; let count = 0;
    const pending = new Promise<void>(resolve => { started = resolve; });
    node.answer((_req, res) => { res.write('private partial bytes'); if (++count === 2) started(); });
    const responses = [api.replica(), api.replica()].map(issuer => dataPlaneFetch(dataPlaneFromEnv(node.env, issuer)!, subject, '/src/main.ts', {
      method: 'GET', headers: {}, signal: AbortSignal.timeout(2000), maxBytes: 1024,
    }));
    await pending; api.revoke();
    for (const response of await Promise.all(responses)) {
      expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'custody_revoked' });
    }
    const transport = dataPlaneFromEnv(node.env, api.replica())!;
    await expect(transport.prepare(subject)).rejects.toThrow('custody_revoked');
  });
  it('should refuse an incorrect controller identity before token issuance', async () => {
    const { api } = await fixture();
    const issuer = custodyIssuerFromEnv({ ...api.env, APP_ARTIFACT_LIVE_CONTROLLER_KEYS: `controller-test=${Buffer.alloc(32).toString('base64url')}` })!;
    const stop = issuer.watch(subject, () => {});
    try { await expect(issuer.issue(subject, AbortSignal.timeout(2000))).rejects.toThrow('custody_revoked'); }
    finally { stop(); }
    expect(api.requests).toHaveLength(0);
  });
  it('should cancel all polling when the last attached stream unsubscribes', async () => {
    const { api } = await fixture(); const issuer = api.replica(); let revoked = false;
    const stop = issuer.watch(subject, () => { revoked = true; });
    await issuer.issue(subject, AbortSignal.timeout(2000)); stop(); const count = api.requests.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(api.requests).toHaveLength(count); expect(revoked).toBe(false);
  });
  it('should compose standalone execution-node mode and refuse missing RPC credentials at startup', async () => {
    const { node, api } = await fixture();
    const server = await startContentServer({ env: { ...node.env, ...api.env }, hostname: '127.0.0.1', port: 0 });
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/healthz`);
    expect(await response.text()).toBe('ok');
    await expect(startContentServer({ env: node.env, port: 0 })).rejects.toThrow('APP_ARTIFACT_CUSTODY_API_URL');
    expect(custodyIssuerFromEnv({})).toBeUndefined();
  });
});
