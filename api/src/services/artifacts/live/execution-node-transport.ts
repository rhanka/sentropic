import { Agent, request } from 'node:https';
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

export interface NodeReply { status: number; headers: Record<string, string | string[] | undefined>; bytes: Buffer }
export type NodeTransport = (method: string, path: string, body?: Buffer,
  headers?: Record<string, string>, signal?: AbortSignal) => Promise<NodeReply>;
export interface ExecutionNodeConfig {
  url: URL; nodeId: string; nodeInstanceId: string; nodeEpoch: number;
  provenanceKey: KeyObject; ticketKey: KeyObject; custodyKey: KeyObject;
  tls: { ca: Buffer; cert: Buffer; key: Buffer };
}
export class ExecutionNodeRefusal extends Error {
  constructor(readonly code: string, readonly status = 503, readonly retryAfterMs?: number) { super(code); }
}
type Env = Readonly<Record<string, string | undefined>>;
/** Values never appear in configuration errors. No implicit epoch adoption or TLS bypass. */
export function executionNodeConfig(env: Env): ExecutionNodeConfig {
  const required = (name: string) => {
    if (!env[name]) throw new ExecutionNodeRefusal(`invalid_config:${name}`);
    return env[name]!;
  };
  const parse = <T>(name: string, fn: (value: string) => T): T => {
    try { return fn(required(name)); } catch { throw new ExecutionNodeRefusal(`invalid_config:${name}`); }
  };
  const url = parse('ARTIFACT_EXECUTION_NODE_URL', value => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/'
      || parsed.search || parsed.hash) throw new Error();
    return parsed;
  });
  const ed25519 = (key: KeyObject) => { if (key.asymmetricKeyType !== 'ed25519') throw new Error(); return key; };
  const nodeInstanceId = required('ARTIFACT_EXECUTION_NODE_INSTANCE_ID');
  const provenanceKey = parse('ARTIFACT_EXECUTION_NODE_PROVENANCE_PUBLIC_KEY_B64', value =>
    ed25519(createPublicKey(Buffer.from(value, 'base64'))));
  // Operator handoff pin, SHA-256 of SPKI DER, never a private key or credential.
  if (nodeInstanceId === '7c710995-cfa9-4e2f-8cad-61706f83d933'
    && createHash('sha256').update(provenanceKey.export({ type: 'spki', format: 'der' })).digest('hex')
      !== '74b5cd02287bead58bf4e27948dc7e2150d80ca5a20924d289325b95f6bc4aaa') {
    throw new ExecutionNodeRefusal('invalid_config:ARTIFACT_EXECUTION_NODE_PROVENANCE_PUBLIC_KEY_B64');
  }
  const ticketKey = parse('ARTIFACT_EXECUTION_TICKET_ED25519_KEY_B64', value => ed25519(createPrivateKey(Buffer.from(value, 'base64'))));
  const custodyKey = parse('ARTIFACT_CUSTODY_ED25519_KEY_B64', value => {
    const key = ed25519(createPrivateKey(Buffer.from(value, 'base64')));
    if (createPublicKey(key).export({ type: 'spki', format: 'der' }).equals(createPublicKey(ticketKey).export({ type: 'spki', format: 'der' }))) throw new Error();
    return key;
  });
  return { url, nodeId: required('ARTIFACT_EXECUTION_NODE_ID'),
    nodeInstanceId,
    nodeEpoch: parse('ARTIFACT_EXECUTION_NODE_EPOCH', value => {
      const epoch = Number(value); if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error(); return epoch;
    }),
    provenanceKey,
    ticketKey, custodyKey,
    tls: { ca: Buffer.from(required('SANDBOX_MTLS_CA_CERT_B64'), 'base64'),
      cert: Buffer.from(required('SANDBOX_MTLS_CONTROL_PLANE_CERT_B64'), 'base64'),
      key: Buffer.from(required('SANDBOX_MTLS_CONTROL_PLANE_KEY_B64'), 'base64') } };
}

/** Bounded binary export, no redirects, normal hostname verification, TLS 1.3 + control-plane certificate. */
export function executionNodeTransport(config: ExecutionNodeConfig): NodeTransport & { close(): void } {
  const agent = new Agent({ ...config.tls, minVersion: 'TLSv1.3', keepAlive: true, rejectUnauthorized: true });
  const call: NodeTransport = (method, path, body, headers = {}, signal) => new Promise<NodeReply>((resolve, reject) => {
    if (!path.startsWith('/v1/') || path.includes('://')) { reject(new ExecutionNodeRefusal('invalid_node_path')); return; }
    const req = request(new URL(path, config.url), { method, agent, signal,
      headers: { 'content-type': 'application/json', ...(body ? { 'content-length': String(body.length) } : {}), ...headers } }, res => {
      let length = 0; const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 64 * 1024 * 1024) req.destroy(); else chunks.push(chunk);
      });
      res.on('error', () => reject(new ExecutionNodeRefusal('node_transport_failure')));
      res.on('end', () => resolve({ status: res.statusCode ?? 503, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    // Four outstanding jobs, max 120s each: a create may wait behind three services.
    // This is an admission transport deadline, independent of test/UI timeouts.
    const timeout = method === 'POST' && path === '/v1/sandboxes' ? 365_000
      : method === 'PUT' && path.endsWith('/bases') ? 125_000 : path === '/v1/node/heartbeat' ? 5000 : 6500;
    req.setTimeout(timeout, () => req.destroy());
    req.on('error', () => reject(new ExecutionNodeRefusal('node_transport_failure')));
    req.end(body);
  }).catch(() => { throw new ExecutionNodeRefusal('node_transport_failure'); });
  return Object.assign(call, { close: () => agent.destroy() });
}
