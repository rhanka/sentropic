import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import type { ExecutionNodeDevScope, ExecutionNodeOwnership, ExecutionNodeSandboxSpec,
  ExecutionNodeTicket } from '../../../../../apps/sandbox-node/src/contract';
import { ExecutionNodeRefusal, executionNodeTransport, type ExecutionNodeConfig,
  type NodeReply, type NodeTransport } from './execution-node-transport';

export type NodeSession = { ownership: ExecutionNodeOwnership; devScope: ExecutionNodeDevScope; physicalUid: string };
export const nodeHash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Matches the agent's ticket signing bytes. Body hash separately covers exact JSON wire order. */
export function canonicalNodeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalNodeJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalNodeJson(entry)}`).join(',')}}`;
}
export function nodeJson<T = Record<string, unknown>>(reply: NodeReply): T {
  try {
    const value = JSON.parse(reply.bytes.toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as T;
  } catch { throw new ExecutionNodeRefusal('invalid_node_response'); }
}
/** Control-plane client only. The immutable configuration is the operator-approved identity fence. */
export class ExecutionNodeAdapter {
  private fenced = false;
  private verified = false;
  readonly transport: NodeTransport;
  constructor(readonly config: ExecutionNodeConfig, transport?: NodeTransport,
    private readonly now = Date.now, private readonly alarm: (code: string) => void = () => {}) {
    this.transport = transport ?? executionNodeTransport(config);
  }
  private refuseIdentity(): never {
    if (!this.fenced) this.alarm('execution_node_identity_mismatch');
    this.fenced = true;
    throw new ExecutionNodeRefusal('execution_node_identity_mismatch');
  }
  private identity(value: Record<string, unknown>) {
    if (value.nodeInstanceId !== this.config.nodeInstanceId || value.nodeEpoch !== this.config.nodeEpoch) this.refuseIdentity();
  }
  private active() { if (this.fenced) throw new ExecutionNodeRefusal('execution_node_identity_mismatch'); }
  private checked(reply: NodeReply): NodeReply {
    if (reply.status >= 200 && reply.status < 300) return reply;
    const error = nodeJson(reply).error;
    if (error === 'stale_node_epoch') this.refuseIdentity();
    // Untrusted response text/URLs never escape to application logs.
    const code = typeof error === 'string' && /^[a-z_]{1,80}$/.test(error) ? error : 'node_request_refused';
    const delay = Number(reply.headers['retry-after']);
    throw new ExecutionNodeRefusal(code, reply.status,
      reply.status === 429 ? (Number.isFinite(delay) && delay > 0 ? Math.min(delay * 1000, 30_000) : 1000) : undefined);
  }
  async inspect() {
    this.active();
    const info = nodeJson(this.checked(await this.transport('GET', '/v1/node')));
    this.identity(info);
    try {
      const key = createPublicKey(String(info.provenancePublicKey)).export({ type: 'spki', format: 'der' });
      if (info.contractVersion !== 'execution-node.v1' || info.nodeId !== this.config.nodeId
        || !key.equals(this.config.provenanceKey.export({ type: 'spki', format: 'der' }))) this.refuseIdentity();
    } catch { this.refuseIdentity(); }
    this.verified = true; return info;
  }
  async heartbeat() {
    this.active();
    if (!this.verified) await this.inspect();
    const body = Buffer.from(JSON.stringify({ expectedNodeInstanceId: this.config.nodeInstanceId,
      expectedNodeEpoch: this.config.nodeEpoch, sentAt: new Date(this.now()).toISOString() }));
    const result = nodeJson(this.checked(await this.transport('POST', '/v1/node/heartbeat', body)));
    this.identity(result); return result;
  }
  /** Caller persists commandId with its intent; retries re-sign the same method/path/body triple. No blind 429 retry. */
  async command(session: NodeSession, method: string, path: string, commandId: string, fields: Record<string, unknown>) {
    this.active();
    if (!this.verified) await this.inspect();
    const { ownership, devScope } = session;
    if (!['sentropic', 'immo'].includes(ownership.tenantId) || !commandId
      || !['workspaceId', 'principalId', 'sessionId', 'buildId', 'jobId', 'attemptId', 'purpose']
        .every(key => typeof ownership[key as keyof typeof ownership] === 'string')
      || !Number.isSafeInteger(ownership.generation) || ownership.generation < 0
      || !Number.isSafeInteger(ownership.custodyEpoch) || ownership.custodyEpoch < 0
      || (ownership.poolOwned !== false && ownership.poolOwned !== `system:warm-pool:${ownership.tenantId}`)) {
      throw new ExecutionNodeRefusal('invalid_node_session');
    }
    const body = Buffer.from(JSON.stringify({ ...fields, commandId, devScope }));
    const ticket: ExecutionNodeTicket = { v: 1, tenantId: ownership.tenantId, commandId, method, path,
      bodySha256: nodeHash(body), targetNodeId: this.config.nodeId,
      expectedNodeInstanceId: this.config.nodeInstanceId, expectedNodeEpoch: this.config.nodeEpoch,
      ownership, issuedAt: new Date(this.now()).toISOString(), deadlineAt: new Date(this.now() + 30_000).toISOString() };
    const signature = sign(null, Buffer.from(canonicalNodeJson(ticket)), this.config.ticketKey).toString('base64url');
    return this.checked(await this.transport(method, path, body, { 'X-Tenant-Id': ownership.tenantId,
      'X-Execution-Ticket': Buffer.from(JSON.stringify({ ticket, signature })).toString('base64url'),
      'Idempotency-Key': commandId, 'X-Expected-Physical-Uid': session.physicalUid }));
  }
  async create(session: NodeSession, spec: ExecutionNodeSandboxSpec, commandId: string) {
    if (spec.tenantId !== session.ownership.tenantId || JSON.stringify(spec.devScope) !== JSON.stringify(session.devScope)) {
      throw new ExecutionNodeRefusal('invalid_node_session');
    }
    return nodeJson(await this.command(session, 'POST', '/v1/sandboxes', commandId, { spec, ownership: session.ownership }));
  }
  async mutate(session: NodeSession, operation: string, commandId: string, fields: Record<string, unknown> = {}) {
    if (!/^[a-zA-Z0-9-]+$/.test(session.physicalUid)
      || !['start', 'claim', 'stop', 'export', 'renew', 'revoke-custody', 'write', 'delete'].includes(operation)) {
      throw new ExecutionNodeRefusal('invalid_node_operation');
    }
    return this.command(session, operation === 'delete' ? 'DELETE' : 'POST',
      `/v1/sandboxes/${session.physicalUid}${operation === 'delete' ? '' : `/${operation}`}`, commandId, fields);
  }
  verifyExport(reply: NodeReply, session: NodeSession): Record<string, unknown> {
    try {
      const token = reply.headers['x-artifact-provenance']; if (typeof token !== 'string') throw new Error();
      const parts = token.split('.'); if (parts.length !== 3) throw new Error();
      const [header, payload, signature] = parts as [string, string, string];
      if (JSON.parse(Buffer.from(header, 'base64url').toString()).alg !== 'EdDSA'
        || !verify(null, Buffer.from(`${header}.${payload}`), this.config.provenanceKey, Buffer.from(signature, 'base64url'))) throw new Error();
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()); this.identity(claims);
      if (claims.tenantId !== session.ownership.tenantId || claims.archiveSha256 !== nodeHash(reply.bytes)) throw new Error();
      return claims;
    } catch { throw new ExecutionNodeRefusal('invalid_node_provenance'); }
  }
}
