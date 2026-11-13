import { verify, type KeyObject } from 'node:crypto';
import { request } from 'node:http';
import type { IncomingMessage, ServerResponse, RequestOptions } from 'node:http';
import type { Duplex } from 'node:stream';
import { CustodyGuard } from './custody.js';
import type { ExecutionNodeSignedCustodyToken } from './contract.js';
import type { SandboxRecord } from './daemon.js';
import { ExecutionNodeError } from './errors.js';

/** Only these runtime services are reachable; no host TCP destination comes from a request. */
export const DATA_PLANE_PORTS = new Set([5173]);
export function createDataPlane(options: {
  publicKey: KeyObject; custody: CustodyGuard;
  sandbox(tenant: ExecutionNodeSignedCustodyToken['tenantId'], uid: string): SandboxRecord | undefined;
  target(sandbox: SandboxRecord, port: number): Promise<RequestOptions>;
}) {
  function authorize(req: IncomingMessage, role: string) {
    if (role !== 'data-plane' || req.headers['x-execution-ticket'] !== undefined) throw new ExecutionNodeError('custody_revoked');
    const match = /^\/v1\/ports\/(\d+)(\/[^#]*)$/.exec(req.url ?? '');
    const tenant = req.headers['x-tenant-id'], uid = req.headers['x-expected-physical-uid'];
    if (tenant === undefined) throw new ExecutionNodeError('missing_tenant_id');
    const token = req.headers['x-custody-token'];
    if (!match || !DATA_PLANE_PORTS.has(Number(match[1])) || typeof uid !== 'string'
      || !['sentropic', 'immo'].includes(String(tenant)) || typeof token !== 'string') throw new ExecutionNodeError('custody_revoked');
    let claims: ExecutionNodeSignedCustodyToken;
    try {
      const [head, payload, signature, extra] = token.split('.');
      if (!head || !payload || !signature || extra !== undefined
        || JSON.parse(Buffer.from(head, 'base64url').toString()).alg !== 'EdDSA'
        || !verify(null, Buffer.from(`${head}.${payload}`), options.publicKey, Buffer.from(signature, 'base64url'))) throw new Error();
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (Object.keys(claims).sort().join() !== 'custodyEpoch,deadlineAt,issuedAt,principalId,resourceId,tenantId'
        || typeof claims.principalId !== 'string' || !claims.principalId) throw new Error();
    } catch { throw new ExecutionNodeError('custody_revoked'); }
    options.custody.authorize(claims, tenant as ExecutionNodeSignedCustodyToken['tenantId'], uid, false);
    const sandbox = options.sandbox(claims.tenantId, uid);
    if (!sandbox || sandbox.state !== 'running' || sandbox.poolOwned || sandbox.network !== 'ports'
      || sandbox.ownership.principalId !== claims.principalId
      || sandbox.ownership.custodyEpoch !== claims.custodyEpoch) throw new ExecutionNodeError('custody_revoked');
    return { claims, sandbox, port: Number(match[1]), path: match[2]! };
  }
  const headers = (req: IncomingMessage) => Object.fromEntries(Object.entries(req.headers).filter(([name]) =>
    !['x-custody-token', 'x-tenant-id', 'x-expected-physical-uid', 'x-execution-ticket',
      'authorization', 'cookie', 'proxy-authorization', 'forwarded'].includes(name) && !name.startsWith('x-forwarded-')));
  return {
    async http(req: IncomingMessage, res: ServerResponse, role: string) {
      let outgoing: ReturnType<typeof request> | undefined;
      let detach = () => {};
      try {
        const admitted = authorize(req, role);
        const target = await options.target(admitted.sandbox, admitted.port);
        authorize(req, role);
        outgoing = request({ ...target, path: admitted.path, method: req.method, headers: headers(req), agent: false }, upstream => {
          res.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(res);
          upstream.on('error', () => res.destroy());
        });
        outgoing.on('error', () => res.destroy());
        detach = options.custody.attach(admitted.claims, () => { outgoing?.destroy(); res.destroy(); });
        res.once('close', () => { detach(); outgoing?.destroy(); });
        req.pipe(outgoing);
      } catch (error) { detach(); outgoing?.destroy(); res.writeHead(error instanceof ExecutionNodeError ? error.status : 502).end(); }
    },
    async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, role: string) {
      let outgoing: ReturnType<typeof request> | undefined;
      let upstreamSocket: Duplex | undefined; let detach = () => {}; let closing = false;
      const close = () => {
        if (closing) return; closing = true; detach();
        // Unmasked server close frame, status 1008. End before destroying the tunnel.
        if (upstreamSocket) socket.end(Buffer.from([0x88, 0x02, 0x03, 0xf0]));
        else socket.destroy();
        upstreamSocket?.destroy(); outgoing?.destroy();
        const timer = setTimeout(() => socket.destroy(), 100); timer.unref();
      };
      try {
        const admitted = authorize(req, role);
        const target = await options.target(admitted.sandbox, admitted.port);
        authorize(req, role);
        outgoing = request({ ...target, path: admitted.path, method: 'GET', headers: headers(req), agent: false });
        detach = options.custody.attach(admitted.claims, close);
        socket.once('close', () => { detach(); upstreamSocket?.destroy(); outgoing?.destroy(); });
        outgoing.once('upgrade', (response, upstream, upstreamHead) => {
          try { authorize(req, role); } catch { upstream.destroy(); close(); return; }
          upstreamSocket = upstream;
          socket.write(`HTTP/1.1 101 Switching Protocols\r\n${response.rawHeaders.reduce((s, v, i) => s + v + (i % 2 ? '\r\n' : ': '), '')}\r\n`);
          if (upstreamHead.length) socket.write(upstreamHead);
          if (head.length) upstream.write(head);
          upstream.on('error', close); socket.on('error', close);
          upstream.once('close', () => { if (!closing) socket.destroy(); });
          socket.pipe(upstream).pipe(socket);
        });
        outgoing.once('response', response => { response.destroy(); close(); });
        outgoing.once('error', close); outgoing.end();
      } catch { detach(); outgoing?.destroy(); socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); }
    },
  };
}
