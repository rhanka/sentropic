import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import type { Duplex } from 'node:stream';
import { dataPlaneFromEnv, type CustodyIssuer, type CustodyLease } from '../src/data-plane';
import { testTls } from './data-plane-tls';

export const subject = { kind: 'supervisor' as const, podName: 'artifact-test' };
export async function fakeDataPlane(tls = testTls()) {
  const keys = generateKeyPairSync('ed25519');
  const watchers = new Set<() => void>(); const sockets = new Set<Duplex>();
  const received: IncomingMessage[] = []; let epoch = 1; let issues = 0;
  let tenant: 'sentropic' | 'immo' = 'sentropic'; let uid = 'physical-1'; let ttl = 1000;
  const issuer: CustodyIssuer = {
    async issue() {
      issues++;
      const issuedAt = new Date().toISOString();
      const lease: CustodyLease = { tenantId: tenant, principalId: 'principal', physicalUid: uid, custodyEpoch: epoch,
        port: 5173, issuedAt, deadlineAt: new Date(Date.now() + ttl).toISOString(), token: '' };
      const payload = Buffer.from(JSON.stringify({ ...lease, resourceId: uid })).toString('base64url');
      lease.token = payload + '.' + sign(null, Buffer.from(payload), keys.privateKey).toString('base64url');
      return lease;
    },
    watch(_subject, close) { watchers.add(close); return () => { watchers.delete(close); }; },
  };
  let answer = (_req: IncomingMessage, res: ServerResponse) => { res.end('live'); };
  const allowed = (req: IncomingMessage) => {
    received.push(req);
    try {
      const [payload, signature] = String(req.headers['x-custody-token']).split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as CustodyLease & { resourceId: string };
      const expectedUid = req.headers['x-tenant-id'] === 'sentropic' ? 'physical-1'
        : req.headers['x-tenant-id'] === 'immo' ? 'physical-2' : undefined;
      return (req.socket as TLSSocket).authorized
        && (req.socket as TLSSocket).getPeerCertificate().subject.CN === 'data-plane:artifact-content'
        && verify(null, Buffer.from(payload), keys.publicKey, Buffer.from(signature, 'base64url'))
        && expectedUid !== undefined && claims.tenantId === req.headers['x-tenant-id']
        && req.headers['x-expected-physical-uid'] === expectedUid && claims.resourceId === expectedUid
        && claims.custodyEpoch >= epoch && Date.parse(claims.deadlineAt) > Date.now();
    } catch { return false; }
  };
  const server = createServer(tls.server, (req, res) => {
    if (!allowed(req)) { res.writeHead(403).end('{"error":"custody_revoked"}'); return; }
    answer(req, res);
  });
  server.on('secureConnection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    if (!allowed(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
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
    answer(handler: typeof answer) { answer = handler; },
    revoke() { epoch++; for (const close of watchers) close(); },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
