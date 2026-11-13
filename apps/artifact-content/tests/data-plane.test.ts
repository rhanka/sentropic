import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:https';
import { dataPlaneFetch } from '../src/data-plane-http';
import { fakeDataPlane, subject } from './data-plane-fixture';
import { dataPlaneFromEnv } from '../src/data-plane';

const open: Awaited<ReturnType<typeof fakeDataPlane>>[] = [];
const fixture = async () => { const f = await fakeDataPlane(); open.push(f); return f; };
afterEach(async () => { for (const f of open.splice(0)) await f.close(); });
const get = (f: Awaited<ReturnType<typeof fixture>>) => dataPlaneFetch(f.transport, subject, '/src/main.ts?v=1', {
  method: 'GET', headers: { accept: '*/*' }, signal: AbortSignal.timeout(2000), maxBytes: 1024,
});
describe('execution-node data plane', () => {
  it('should authenticate mTLS and forward only the issued tenant, physical UID and custody token', async () => {
    const f = await fixture(); const response = await get(f);
    expect(response.status).toBe(200); expect(await response.text()).toBe('live');
    expect(f.received[0].url).toBe('/v1/ports/5173/src/main.ts?v=1');
    expect(f.received[0].headers).toMatchObject({ 'x-tenant-id': 'sentropic', 'x-expected-physical-uid': 'physical-1' });
    expect(f.received[0].headers['x-custody-token']).toBeTruthy(); expect(f.watchers).toBe(0);
  });
  it('should refuse a client without an mTLS certificate before dispatch', async () => {
    const f = await fixture();
    await new Promise<void>(resolve => {
      const req = request(f.env.SANDBOX_NODE_URL, { rejectUnauthorized: false }, res => {
        res.resume(); throw new Error('unauthenticated client dispatched');
      });
      req.once('error', () => resolve()); req.end();
    });
    expect(f.received).toHaveLength(0);
  });
  it.each(['uid', 'tenant'] as const)('should refuse an incorrect %s at the data-plane server', async kind => {
    const f = await fixture(); if (kind === 'uid') f.setUid('wrong-physical'); else f.setTenant('immo');
    const response = await get(f); expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'custody_revoked' });
  });
  it('should obtain a fresh token for each new HTTP hop', async () => {
    const f = await fixture(); await (await get(f)).text(); await (await get(f)).text(); expect(f.issues).toBe(2);
  });
  it('should contain an invalid upstream status and continue serving subsequent requests', async () => {
    const f = await fixture(); f.answer((_req, res) => { res.writeHead(600).end('invalid'); });
    expect((await get(f)).status).toBe(502); expect(f.watchers).toBe(0);
    f.answer((_req, res) => { res.end('valid'); });
    expect(await (await get(f)).text()).toBe('valid');
  });
  it.each(['expiry', 'revocation'] as const)('should cut a slow HTTP consumer on %s after upstream completion', async kind => {
    const f = await fixture(); f.setTtl(200);
    const response = await get(f); expect(response.status).toBe(200); expect(f.watchers).toBe(1);
    if (kind === 'revocation') f.revoke();
    else await new Promise(resolve => setTimeout(resolve, 220));
    await expect(response.text()).rejects.toThrow('custody_revoked'); expect(f.watchers).toBe(0);
  });
  it.each([0, 60_001])('should refuse invalid token lifetime %s before any node call', async ttl => {
    const f = await fixture(); f.setTtl(ttl);
    expect((await get(f)).status).toBe(403); expect(f.received).toHaveLength(0); expect(f.watchers).toBe(0);
  });
  it.each(['revocation', 'abort'] as const)('should cancel a blocked issuer on %s and unsubscribe', async kind => {
    const f = await fixture();
    const transport = dataPlaneFromEnv(f.env, { ...f.issuer, issue: async () => new Promise(() => {}) })!;
    const controller = new AbortController();
    const result = transport.prepare(subject, controller.signal);
    if (kind === 'revocation') f.revoke(); else controller.abort();
    await expect(result).rejects.toThrow('custody_revoked'); expect(f.watchers).toBe(0);
  });
  it.each(['expiry', 'revocation'] as const)('should cut pending HTTP on %s without releasing partial bytes', async kind => {
    const f = await fixture(); f.setTtl(200);
    let started!: () => void; const start = new Promise<void>(resolve => { started = resolve; });
    f.answer((_req, res) => { res.write('private partial response'); started(); });
    const result = get(f); await start;
    if (kind === 'revocation') f.revoke();
    const response = await result; expect(response.status).toBe(403);
    expect(await response.text()).toBe('{"error":"custody_revoked"}'); expect(f.watchers).toBe(0);
  });
});
