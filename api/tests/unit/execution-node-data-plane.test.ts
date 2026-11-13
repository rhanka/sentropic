import { afterEach, describe, expect, it } from 'vitest';
import { custodyRpcFixture } from './execution-node-rpc-fixture';
import { issueNodeCustody, revokeNodeCustody } from '../../src/services/artifacts/live/execution-node-custody';
import { session } from './execution-node-fake';
import { sign } from 'node:crypto';
import { ExecutionNodeAdapter } from '../../src/services/artifacts/live/execution-node-adapter';
import { sandboxSpec } from './execution-node-fake';

describe('real custody RPC to real agent data plane', () => {
  const fixtures: Awaited<ReturnType<typeof custodyRpcFixture>>[] = [];
  const setup = async () => { const fixture = await custodyRpcFixture(); fixtures.push(fixture); return fixture; };
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); });
  it('should refuse the execution key as custody authority and the custody key as execution authority', async () => {
    const f = await setup();
    const token = issueNodeCustody(f.fake.adapter, { ...session(), physicalUid: f.route.podUid }, 'principal', 1).headers['X-Custody-Token'];
    const [head, payload] = token.split('.'); const input = `${head}.${payload}`;
    const forged = `${input}.${sign(null, Buffer.from(input), f.fake.config.ticketKey).toString('base64url')}`;
    const req = f.open(forged);
    const status = await new Promise<number>((resolve, reject) => {
      req.once('error', reject); req.once('response', res => { res.resume(); resolve(res.statusCode!); }); req.end();
    });
    expect(status).toBe(403);
    const wrong = new ExecutionNodeAdapter({ ...f.fake.config, ticketKey: f.fake.config.custodyKey }, f.fake.adapter.transport);
    const s = { ...session(), physicalUid: 'cross-use' };
    await expect(wrong.create(s, sandboxSpec(s), 'cross-use')).rejects.toThrow();
    expect(f.fake.node.daemon.getSandbox('sentropic', s.physicalUid)).toBeUndefined();
  });
  it('should preserve owner and guest grants from authorizeLive and refuse a revoked guest', async () => {
    const f = await setup();
    const owner = await f.grant({ principalId: 'principal' });
    const guest = await f.grant({ principalId: 'guest', invitation: { id: 'invite', epoch: 1, expiresAt: Date.now() + 30_000 } });
    for (const subject of [owner, guest]) {
      const response = await f.call('issue', subject); expect(response.status).toBe(200);
      const lease = await response.json(); expect(lease.principalId).toBe('principal');
      const req = f.open(lease.token); req.on('error', () => {});
      const res = await new Promise<import('node:http').IncomingMessage>(resolve => { req.once('response', resolve); req.end(); });
      expect(res.statusCode).toBe(200); res.destroy();
    }
    f.revokeGuest();
    expect((await f.call('issue', guest)).status).toBe(403);
    expect((await f.call('watch', guest)).status).toBe(403);
    expect((await f.call('issue', owner)).status).toBe(200);
  });
  it('should keep watch authority stable across access updates and distinguish changed grants', async () => {
    const f = await setup(); const initial = await (await f.call('watch')).json();
    f.activity();
    expect(await (await f.call('watch')).json()).toEqual(initial);
    expect((await f.call('issue')).status).toBe(200);
    const changed = { ...f.subject, route: { ...f.route, expiresAt: f.route.expiresAt - 1000 } };
    expect((await (await f.call('watch', changed)).json()).version).not.toBe(initial.version);
    f.stop(); expect((await f.call('watch')).status).toBe(403);
  });
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
    expect((await f.call('issue', { ...f.subject, route: { ...f.route, expiresAt: undefined } })).status).toBe(403);
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
  it('should close HMR with 1008 at the signed expiry', async () => {
    const f = await setup(); const s = { ...session(), physicalUid: f.route.podUid };
    const token = issueNodeCustody(f.fake.adapter, s, 'principal', 1, 60, f.fake.now()).headers['X-Custody-Token'];
    const req = f.open(token, { connection: 'Upgrade', upgrade: 'websocket',
      'sec-websocket-version': '13', 'sec-websocket-key': Buffer.alloc(16, 2).toString('base64') }); req.on('error', () => {});
    const socket = await new Promise<import('node:stream').Duplex>(resolve => { req.once('upgrade', (_r, stream) => resolve(stream)); req.end(); });
    const frame = await new Promise<Buffer>(resolve => socket.once('data', resolve));
    expect(frame.subarray(0, 4)).toEqual(Buffer.from([0x88, 0x02, 0x03, 0xf0])); socket.destroy();
  });
  it('should notify two independent artifact-content replicas when API route authority changes', async () => {
    const f = await setup(); const lease = await (await f.call('issue')).json();
    const replicas = await Promise.all([0, 1].map(async () => {
      const initial = await (await f.call('watch')).json();
      const req = f.open(lease.token); req.on('error', () => {});
      const res = await new Promise<import('node:http').IncomingMessage>(resolve => { req.once('response', resolve); req.end(); });
      res.resume(); let timer: ReturnType<typeof setTimeout>; let disposed = false;
      const ended = new Promise<void>(resolve => res.once('aborted', resolve));
      const revoke = () => { disposed = true; clearTimeout(timer); req.destroy(); };
      const poll = async () => {
        try {
          const response = await f.call('watch');
          if (!response.ok || (await response.json()).version !== initial.version) { revoke(); return; }
        } catch { revoke(); return; }
        if (!disposed) timer = setTimeout(() => { void poll(); }, 250);
      };
      timer = setTimeout(() => { void poll(); }, 250);
      return { ended, revoke };
    }));
    try { f.stop(); await Promise.all(replicas.map(replica => replica.ended)); }
    finally { replicas.forEach(replica => replica.revoke()); }
    expect((await f.call('issue')).status).toBe(403);
  });
});
