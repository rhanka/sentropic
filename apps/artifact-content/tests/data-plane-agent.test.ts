import { request } from 'node:https';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeDataPlane, subject } from './data-plane-fixture';

const fixtures: Awaited<ReturnType<typeof fakeDataPlane>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function fixture() { const f = await fakeDataPlane(); fixtures.push(f); return f; }
async function open(f: Awaited<ReturnType<typeof fixture>>, path: string, websocket = false) {
  const lease = await f.issuer.issue(subject, AbortSignal.timeout(2000));
  return request(new URL(path, f.env.SANDBOX_NODE_URL), {
    cert: Buffer.from(f.env.SANDBOX_MTLS_DATA_PLANE_CERT_B64, 'base64'),
    key: Buffer.from(f.env.SANDBOX_MTLS_DATA_PLANE_KEY_B64, 'base64'), ca: Buffer.from(f.env.SANDBOX_MTLS_CA_CERT_B64, 'base64'),
    headers: { 'x-tenant-id': lease.tenantId, 'x-expected-physical-uid': lease.physicalUid, 'x-custody-token': lease.token,
      ...(websocket ? { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-protocol': 'vite-hmr' } : {}) },
  });
}
describe('fake agent routing and real custody stream guard', () => {
  it.each(['ticket', 'principal', 'epoch', 'port'] as const)('should refuse %s even with a valid signed token', async kind => {
    const f = await fixture();
    if (kind === 'principal') f.setOwner('other-owner', 1);
    if (kind === 'epoch') f.setOwner('principal', 2);
    if (kind === 'port') f.setPort(8792);
    const req = await open(f, `/v1/ports/${kind === 'port' ? 8792 : 5173}/src/main.ts`);
    if (kind === 'ticket') req.setHeader('x-execution-ticket', 'forbidden');
    const response = once(req, 'response'); req.end();
    const [res] = await response; expect(res.statusCode).toBe(403); res.resume();
  });
  it.each(['/src/main.ts', '/v1/ports/5000/src/main.ts', '/v1/ports/5173'])('should refuse an unbound data-plane route %s', async path => {
    const f = await fixture(); const req = await open(f, path);
    const response = once(req, 'response'); req.end();
    const [res] = await response; expect(res.statusCode).toBe(403); res.resume();
  });
  it.each(['expiry', 'revocation'] as const)('should cut HTTP inside the agent on %s without edge watchers', async kind => {
    const f = await fixture(); f.setTtl(300);
    f.answer((_req, res) => { res.write('partial'); });
    const req = await open(f, '/v1/ports/5173/src/main.ts');
    const response = once(req, 'response'); req.end(); const [res] = await response;
    const aborted = once(res, 'aborted'); res.resume();
    if (kind === 'revocation') f.revokeAgent();
    await aborted; expect(res.complete).toBe(false); expect(f.watchers).toBe(0);
  });
  it.each(['expiry', 'revocation'] as const)('should close WS 1008 inside the agent on %s without edge watchers', async kind => {
    const f = await fixture(); f.setTtl(300);
    const req = await open(f, '/v1/ports/5173/hmr', true);
    const upgraded = once(req, 'upgrade'); req.end(); const [, socket] = await upgraded;
    const frame = once(socket, 'data');
    if (kind === 'revocation') f.revokeAgent();
    expect(Buffer.from((await frame)[0])).toEqual(Buffer.from([0x88, 0x02, 0x03, 0xf0]));
    expect(f.watchers).toBe(0); socket.destroy();
  });
});
