import { createServer, request, type ServerOptions } from 'node:https';
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
  const operator = url.pathname === '/v1/node' || url.pathname === '/v1/node/drain'
    || (url.pathname === '/v1/events' && url.searchParams.get('scope') === 'node');
  if (operator) {
    if (role !== 'operator' || tenantId || url.searchParams.has('tenantId')) throw new ExecutionNodeError('custody_revoked');
    return { scope: 'node' as const };
  }
  if (!tenantId) throw new ExecutionNodeError('missing_tenant_id');
  if (!['sentropic', 'immo'].includes(tenantId)) throw new ExecutionNodeError('custody_revoked');
  return { scope: 'tenant' as const, tenantId: tenantId as ExecutionNodeTenantId };
}

export function createAgentServer(tls: ServerOptions, handler: (req: IncomingMessage, res: ServerResponse, role: string) => void) {
  return createServer({ ...tls, minVersion: 'TLSv1.3', requestCert: true, rejectUnauthorized: true }, (req, res) => {
    const socket = req.socket as TLSSocket;
    if (!socket.authorized) { res.writeHead(403).end(); return; }
    const role = socket.getPeerCertificate().subject?.OU;
    if (typeof role !== 'string' || !['operator', 'control-plane', 'data-plane'].includes(role)) {
      res.writeHead(403).end(); return;
    }
    handler(req, res, role);
  });
}

/** Uses the same operator-managed CA and client credentials; never disables verification. */
export function sendJobAlertHeartbeat(url: string, tls: ServerOptions, payload: unknown): Promise<void> {
  if (!url.startsWith('https://')) return Promise.reject(new Error('job-alerts HTTPS required'));
  return new Promise((resolve, reject) => {
    const req = request(url, { ...tls, method: 'POST', rejectUnauthorized: true, timeout: 3000,
      headers: { 'content-type': 'application/json' } }, res => {
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`job-alerts heartbeat HTTP ${res.statusCode}`));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('heartbeat timeout')));
    req.end(JSON.stringify(payload));
  });
}
