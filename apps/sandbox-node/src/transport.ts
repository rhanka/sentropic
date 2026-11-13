import { createServer, type ServerOptions } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { ExecutionNodeError } from './errors.js';
import type { ExecutionNodeTenantId } from './contract.js';

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); length += bytes.length;
    if (length > 1024 * 1024) throw new ExecutionNodeError('command_id_payload_mismatch', 'request exceeds 1 MiB');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ExecutionNodeError('command_id_payload_mismatch', 'invalid JSON request'); }
}

export function requestScope(path: string, tenantId: string | undefined, role: string) {
  const url = new URL(path, 'https://agent');
  const operator = ['/v1/node', '/v1/node/drain', '/v1/node/undrain', '/v1/node/status'].includes(url.pathname)
    || (url.pathname === '/v1/events' && url.searchParams.get('scope') === 'node');
  if (operator) {
    if (!(role === 'operator' || (role === 'control-plane' && url.pathname === '/v1/node'))
      || tenantId || url.searchParams.has('tenantId')) throw new ExecutionNodeError('custody_revoked');
    return { scope: 'node' as const };
  }
  if (!tenantId) throw new ExecutionNodeError('missing_tenant_id');
  if (!['sentropic', 'immo'].includes(tenantId)) throw new ExecutionNodeError('custody_revoked');
  return { scope: 'tenant' as const, tenantId: tenantId as ExecutionNodeTenantId };
}

export function agentRole(req: IncomingMessage): string | undefined {
    const socket = req.socket as TLSSocket;
    if (!socket.authorized) return undefined;
    const identity = socket.getPeerCertificate().subject?.CN;
    const identities: Record<string, string> = { 'control-plane:sentropic-api': 'control-plane',
      'data-plane:artifact-content': 'data-plane', 'operator:cluster-controller': 'operator' };
    const role = typeof identity === 'string' ? identities[identity] : undefined;
    return role;
}
export function createAgentServer(tls: ServerOptions, handler: (req: IncomingMessage, res: ServerResponse, role: string) => void) {
  return createServer({ ...tls, minVersion: 'TLSv1.3', requestCert: true, rejectUnauthorized: true }, (req, res) => {
    const role = agentRole(req);
    if (!role) {
      res.writeHead(403).end(); return;
    }
    handler(req, res, role);
  });
}

