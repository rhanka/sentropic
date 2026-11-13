import { afterEach, describe, expect, it } from 'vitest';
import { custodyRpcFixture } from './execution-node-rpc-fixture';
import { issueNodeCustody, revokeNodeCustody } from '../../src/services/artifacts/live/execution-node-custody';
import { session } from './execution-node-fake';

describe('real custody RPC to real agent data plane', () => {
  const fixtures: Awaited<ReturnType<typeof custodyRpcFixture>>[] = [];
  const setup = async () => { const fixture = await custodyRpcFixture(); fixtures.push(fixture); return fixture; };
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); });
  it('should issue a usable compact token over HTTP and cut attached HTTP and HMR on persisted revocation', async () => {
    const f = await setup(); const issued = await f.call('issue'); expect(issued.status).toBe(200);
    const lease = await issued.json(); expect(lease.token.split('.')).toHaveLength(3); expect(lease.port).toBe(5173);
    const http = f.open(lease.token); http.on('error', () => {});
    const response = await new Promise<import('node:http').IncomingMessage>(resolve => { http.once('response', resolve); http.end(); });
    expect(response.statusCode).toBe(200);
    const chunk = await new Promise<Buffer>(resolve => response.once('data', resolve)); expect(chunk.toString()).toBe('sandbox-stream');
    const httpCut = new Promise<void>(resolve => response.once('aborted', resolve));
    const ws = f.open(lease.token, { connection: 'Upgrade', upgrade: 'websocket',
      'sec-websocket-version': '13', 'sec-websocket-key': Buffer.alloc(16, 1).toString('base64') }); ws.on('error', () => {});
    const socket = await new Promise<import('node:stream').Duplex>(resolve => { ws.once('upgrade', (_r, stream) => resolve(stream)); ws.end(); });
    const wsCut = new Promise<Buffer>(resolve => socket.once('data', resolve));
    await revokeNodeCustody(f.fake.adapter, { ...session(), physicalUid: lease.physicalUid }, 2, 'owner_changed', 'revoke');
    await httpCut; const frame = await wsCut; expect(frame.subarray(0, 4)).toEqual(Buffer.from([0x88, 0x02, 0x03, 0xf0])); socket.destroy();
    expect((await f.call('issue')).status).toBe(403); expect((await f.call('watch')).status).toBe(403);
  });
  it('should refuse unauthenticated, cross-principal, stale-route and pod-name-only reissues', async () => {
    const f = await setup();
    expect((await f.call('issue', f.subject, false)).status).toBe(403);
    expect((await f.call('issue', { ...f.subject, route: { ...f.route, principalId: 'other' } })).status).toBe(403);
    expect((await f.call('issue', { kind: 'supervisor', podName: 'unowned-pod' })).status).toBe(403);
    expect((await f.call('watch')).status).toBe(200); f.stop();
    expect((await f.call('watch')).status).toBe(403); expect((await f.call('issue')).status).toBe(403);
  });
  it('should enforce token signature, role, tenant, UID and the runtime port allowlist without execution tickets', async () => {
    const f = await setup(); const lease = await (await f.call('issue')).json();
    for (const [headers, path] of [
      [{ 'x-tenant-id': 'immo' }, '/v1/ports/5173/'],
      [{ 'x-expected-physical-uid': 'other' }, '/v1/ports/5173/'],
      [{ 'x-execution-ticket': 'unrelated' }, '/v1/ports/5173/'],
      [{ 'x-custody-token': `${lease.token.slice(0, -4)}AAAA` }, '/v1/ports/5173/'],
      [{}, '/v1/ports/22/'],
    ] as Array<[Record<string, string>, string]>) {
      const req = f.open(lease.token, headers, path);
      const status = await new Promise<number>(resolve => { req.once('response', res => { res.resume(); resolve(res.statusCode!); }); req.end(); });
      expect(status).toBe(403);
    }
  });
  it('should cut an attached HTTP stream at the signed expiry', async () => {
    const f = await setup(); const s = { ...session(), physicalUid: f.route.podUid };
    const token = issueNodeCustody(f.fake.adapter, s, 'principal', 1, 40, f.fake.now()).headers['X-Custody-Token'];
    const req = f.open(token); req.on('error', () => {});
    const res = await new Promise<import('node:http').IncomingMessage>(resolve => { req.once('response', resolve); req.end(); });
    res.resume(); await new Promise<void>(resolve => res.once('aborted', resolve));
  });
});
