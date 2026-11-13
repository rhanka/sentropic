import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import type { Duplex } from 'node:stream';
import { dataPlaneFromEnv, type CustodyIssuer, type CustodyLease } from '../src/data-plane';
import { testTls } from './data-plane-tls';
import { fixtureCustody } from './data-plane-custody';

export const subject = { kind: 'supervisor' as const, podName: 'artifact-test' };
export async function fakeDataPlane(tls = testTls()) {
  const custody = fixtureCustody();
  const watchers = new Set<() => void>(); const sockets = new Set<Duplex>();
  const received: IncomingMessage[] = []; let epoch = 1; let issues = 0;
  let tenant: 'sentropic' | 'immo' = 'sentropic'; let uid = 'physical-1'; let ttl = 1000; let port = 5173;
  let owner = { principalId: 'principal', custodyEpoch: 1 };
  const issuer: CustodyIssuer = {
    async issue() {
      issues++;
      const issuedAt = new Date().toISOString();
      const lease: CustodyLease = { tenantId: tenant, principalId: 'principal', physicalUid: uid, custodyEpoch: epoch,
        port, issuedAt, deadlineAt: new Date(Date.now() + ttl).toISOString(), token: '' };
      lease.token = custody.sign(lease);
      return lease;
    },
    watch(_subject, close) { watchers.add(close); return () => { watchers.delete(close); }; },
  };
  let answer = (_req: IncomingMessage, res: ServerResponse) => { res.end('live'); };
  const allowed = (req: IncomingMessage) => {
    received.push(req);
    try {
      const expectedUid = req.headers['x-tenant-id'] === 'sentropic' ? 'physical-1'
        : req.headers['x-tenant-id'] === 'immo' ? 'physical-2' : undefined;
      if (!(req.socket as TLSSocket).authorized
        || (req.socket as TLSSocket).getPeerCertificate().subject.CN !== 'data-plane:artifact-content'
        || req.headers['x-execution-ticket'] !== undefined
        || !expectedUid || req.headers['x-expected-physical-uid'] !== expectedUid
        || typeof req.headers['x-custody-token'] !== 'string') return undefined;
      const match = /^\/v1\/ports\/(\d+)(\/[^#]*)$/.exec(req.url ?? '');
      if (!match || Number(match[1]) !== 5173) return undefined;
      const claims = custody.verify(req.headers['x-custody-token'], req.headers['x-tenant-id'] as 'sentropic' | 'immo', expectedUid);
      if (claims.principalId !== owner.principalId || claims.custodyEpoch !== owner.custodyEpoch) return undefined;
      return claims;
    } catch { return false; }
  };
  const server = createServer(tls.server, (req, res) => {
    const claims = allowed(req);
    if (!claims) { res.writeHead(403).end('{"error":"custody_revoked"}'); return; }
    const detach = custody.guard.attach(claims, () => res.destroy());
    res.once('close', detach);
    answer(req, res);
  });
  server.on('secureConnection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    const claims = allowed(req);
    if (!claims) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const detach = custody.guard.attach(claims, () => socket.end(Buffer.from([0x88, 0x02, 0x03, 0xf0])));
    socket.once('close', detach);
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] +
      '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...tls.env, SANDBOX_NODE_URL: `https://127.0.0.1:${(server.address() as { port: number }).port}` };
  return {
    env, issuer, received, transport: dataPlaneFromEnv(env, issuer)!, get issues() { return issues; },
    get watchers() { return watchers.size; },
    setTtl(value: number) { ttl = value; }, setUid(value: string) { uid = value; },
    setTenant(value: 'sentropic' | 'immo') { tenant = value; },
    setPort(value: number) { port = value; },
    setOwner(principalId: string, custodyEpoch: number) { owner = { principalId, custodyEpoch }; },
    answer(handler: typeof answer) { answer = handler; },
    revoke() {
      epoch++; owner.custodyEpoch = epoch; for (const close of watchers) close();
      custody.guard.revoke(tenant, uid, epoch);
    },
    revokeAgent() { epoch++; owner.custodyEpoch = epoch; custody.guard.revoke(tenant, uid, epoch); },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve())); custody.close();
    },
  };
}
