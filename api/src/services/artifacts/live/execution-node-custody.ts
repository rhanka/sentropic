import { sign } from 'node:crypto';
import { ExecutionNodeAdapter, nodeJson, type NodeSession } from './execution-node-adapter';
import { ExecutionNodeRefusal } from './execution-node-transport';

/** S1-C1 contract: call only after authenticating principal and reading authoritative resource ownership.
 * Compact EdDSA JWS, RFC7515, exact claims below. Never expose the execution-ticket signing key.
 * Caller must persist revoke's acknowledged epoch before issuing any new resource token.
 */
export function issueNodeCustody(node: ExecutionNodeAdapter, session: NodeSession,
  principalId: string, minCustodyEpoch: number, ttlMs = 60_000, now = Date.now()) {
  const { ownership, physicalUid } = session;
  if (ownership.principalId !== principalId || ownership.poolOwned !== false || !physicalUid
    || !Number.isSafeInteger(minCustodyEpoch) || minCustodyEpoch < 0
    || !Number.isSafeInteger(ownership.custodyEpoch) || ownership.custodyEpoch < minCustodyEpoch
    || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60_000) throw new ExecutionNodeRefusal('custody_revoked', 403);
  const claims = { tenantId: ownership.tenantId, principalId, custodyEpoch: ownership.custodyEpoch,
    resourceId: physicalUid, issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + ttlMs).toISOString() };
  const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${head}.${payload}`;
  const signature = sign(null, Buffer.from(input), node.config.custodyKey).toString('base64url');
  return { claims, headers: { 'X-Custody-Token': `${input}.${signature}`, 'X-Tenant-Id': ownership.tenantId,
    'X-Expected-Physical-Uid': physicalUid } };
}

export async function revokeNodeCustody(node: ExecutionNodeAdapter, session: NodeSession,
  minCustodyEpoch: number, reason: string, commandId: string) {
  if (!Number.isSafeInteger(minCustodyEpoch) || minCustodyEpoch < session.ownership.custodyEpoch) {
    throw new ExecutionNodeRefusal('custody_revoked', 403);
  }
  const ack = nodeJson(await node.mutate(session, 'revoke-custody', commandId,
    { tenantId: session.ownership.tenantId, physicalUid: session.physicalUid, minCustodyEpoch, reason }));
  if (!Number.isSafeInteger(ack.activeCustodyEpoch) || Number(ack.activeCustodyEpoch) < minCustodyEpoch) {
    throw new ExecutionNodeRefusal('invalid_custody_ack');
  }
  return { ...session, ownership: { ...session.ownership, custodyEpoch: Number(ack.activeCustodyEpoch) } };
}
