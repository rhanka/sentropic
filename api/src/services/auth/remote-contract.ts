import { createHash } from 'node:crypto';
import { z } from 'zod';
import { remoteCanonicalJson } from './remote-json';
export { parseRemoteJson } from './remote-json';

export type RemoteRefusal = 'invalid_request' | 'unsupported_version' | 'authentication_required'
  | 'authority_refused' | 'authority_unavailable' | 'replay_refused' | 'expired' | 'session_proof_invalid'
  | 'workspace_membership_required' | 'role_refused' | 'action_scope_refused' | 'control_disabled'
  | 'input_mode_refused' | 'origin_refused' | 'oversize';
export class RemoteAuthorityError extends Error {
  constructor(readonly code: RemoteRefusal) { super(code); }
}
export function requireRemoteVersion(value: unknown): void {
  if (value && typeof value === 'object' && 'version' in value && typeof value.version === 'string'
    && value.version !== 'remote-action-v1') throw new RemoteAuthorityError('unsupported_version');
}
export const remoteId = z.string().min(1).max(128).regex(/^[\x21-\x7e]+$/);
export const remoteCounter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const remoteHash = z.string().regex(/^[a-f0-9]{64}$/);
export const remoteOperation = z.enum(['input', 'permission-response']);
export const remoteActionId = z.string().regex(/^[A-Za-z0-9_-]{21}[AQgw]$/);
export const remoteTargetSchema = z.object({
  appMeshId: remoteId, sourceMeshId: remoteId, nativeAudience: remoteId, registrationId: remoteId,
  tenantId: remoteId, workspaceId: remoteId, bindingId: remoteId, sourceId: remoteId,
  sourceSessionId: remoteId, nativeSessionId: remoteId, sourceGeneration: remoteCounter,
  bootGeneration: remoteCounter, custodyEpoch: remoteCounter, controllerEpoch: remoteCounter,
  connectionId: remoteId, connectionGeneration: remoteCounter,
}).strict();
export const remoteActorSchema = z.object({
  issuer: remoteId, sub: remoteId, sid: remoteId, sessionVersion: remoteCounter,
}).strict();
export const remoteEvidenceRequestSchema = z.object({
  version: z.literal('remote-action-v1'), kind: z.literal('evidence-request'), actionId: remoteActionId,
  targetDigest: remoteHash, operation: remoteOperation, payloadDigest: remoteHash,
  nonceId: remoteId, sid: remoteId, sessionVersion: remoteCounter, sessionCredential: z.string().min(1).max(4096),
}).strict();
export type RemoteTarget = z.infer<typeof remoteTargetSchema>;
export type RemoteActor = z.infer<typeof remoteActorSchema>;
export type RemoteEvidenceRequest = z.infer<typeof remoteEvidenceRequestSchema>;
export const remoteSignatureSchema = z.object({
  alg: z.literal('Ed25519'), value: z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/),
}).strict();
export const remoteCliBodySchema = z.object({
  version: z.literal('remote-action-v1'), kind: z.literal('cli-session-proof'), issuer: remoteId,
  kid: remoteId, audience: remoteId, proofId: remoteId, target: remoteTargetSchema,
  ownerIssuer: remoteId, ownerSub: remoteId, approvedRegistrationRef: remoteId,
  approvedRegistrationRevision: remoteCounter, providerId: remoteId, providerVersion: remoteId,
  executableDigest: remoteHash, nativeSessionPublicKeyId: remoteId, capabilitiesDigest: remoteHash,
  permissionMode: z.enum(['interactive', 'auto-approve', 'bypass', 'unknown']),
  autoApprovePolicyDigest: remoteHash.nullable(), issuedAt: remoteCounter, expiresAt: remoteCounter,
}).strict();
export const remoteCliProofSchema = z.object({
  body: remoteCliBodySchema, signature: remoteSignatureSchema,
}).strict();

export const remoteRawHash = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
export function remoteDomainBytes(kind: string, value: unknown): Buffer {
  const prefix = Buffer.from(`sentropic.remote-action-v1/${kind}\0`);
  const bytes = kind === 'input' && value instanceof Uint8Array
    ? value : Buffer.from(remoteCanonicalJson(value));
  return Buffer.concat([prefix, bytes]);
}
export const remoteSignedBytes = (body: unknown): Buffer => {
  const kind = z.object({ kind: remoteId }).passthrough().parse(body).kind;
  return remoteDomainBytes(kind, body);
};
export const remoteDigest = (kind: string, value: unknown): string => remoteRawHash(remoteDomainBytes(kind, value));

export function requireRemoteDeadline(issuedAt: number, expiresAt: number, now: number, maxTtl = 60_000): void {
  if (![issuedAt, expiresAt, now].every((x) => Number.isSafeInteger(x) && x >= 0)
    || issuedAt > now || expiresAt <= issuedAt || expiresAt - issuedAt > maxTtl
    || now + 5000 >= expiresAt) throw new RemoteAuthorityError('expired');
}
