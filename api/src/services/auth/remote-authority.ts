import { sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { RemoteAuthorityError, remoteActionId, remoteActorSchema, remoteCounter, remoteHash, remoteId,
  remoteOperation, remoteRawHash, remoteSignedBytes, remoteTargetSchema, requireRemoteDeadline } from './remote-contract';
import { remoteCanonicalJson } from './remote-json';

const consentSchema = z.object({
  bindingId: remoteId, consentPolicyId: remoteId, consentRevision: remoteCounter,
  ownerIssuer: remoteId, ownerSub: remoteId,
  actionScopes: z.array(z.enum(['remote.input', 'remote.permission.respond'])).max(2), scopeDigest: remoteHash,
}).strict();
const authoritySchema = z.object({
  target: remoteTargetSchema, actor: remoteActorSchema, ownerIssuer: remoteId, ownerSub: remoteId,
  membershipActive: z.boolean(), membershipTenantId: remoteId, membershipWorkspaceId: remoteId,
  membershipRevision: remoteCounter, role: remoteId, consent: consentSchema.nullable(),
  expectedConsentRevision: remoteCounter, enabled: z.boolean(), remoteControlEpoch: remoteCounter,
  expectedRemoteControlEpoch: remoteCounter, controlPolicyRevision: remoteCounter, operation: remoteOperation,
  permissionMode: z.enum(['interactive', 'auto-approve', 'bypass', 'unknown']), autoApprovePolicyDigest: remoteHash.nullable(),
}).strict();
export function authorizeRemoteAction(input: unknown) {
  const parsed = authoritySchema.safeParse(input);
  if (!parsed.success) throw new RemoteAuthorityError('invalid_request');
  const a = parsed.data;
  if (a.actor.issuer !== a.ownerIssuer || a.actor.sub !== a.ownerSub)
    throw new RemoteAuthorityError('authority_refused');
  if (!a.membershipActive || a.membershipTenantId !== a.target.tenantId
    || a.membershipWorkspaceId !== a.target.workspaceId) throw new RemoteAuthorityError('workspace_membership_required');
  if (!['member', 'workspace-admin', 'workspace-owner'].includes(a.role)) throw new RemoteAuthorityError('role_refused');
  const c = a.consent;
  if (!a.enabled || a.remoteControlEpoch !== a.expectedRemoteControlEpoch || !c
    || c.bindingId !== a.target.bindingId || c.ownerIssuer !== a.ownerIssuer || c.ownerSub !== a.ownerSub
    || c.consentRevision !== a.expectedConsentRevision
    || remoteCanonicalJson(c.actionScopes) !== remoteCanonicalJson([...new Set(c.actionScopes)].sort())
    || c.scopeDigest !== remoteRawHash(remoteCanonicalJson(c.actionScopes))) throw new RemoteAuthorityError('control_disabled');
  const scope = a.operation === 'input' ? 'remote.input' : 'remote.permission.respond';
  if (!c.actionScopes.includes(scope)) throw new RemoteAuthorityError('action_scope_refused');
  if (a.operation === 'input' && (a.permissionMode !== 'interactive' || a.autoApprovePolicyDigest !== null))
    throw new RemoteAuthorityError('input_mode_refused');
  return { ...a, consent: c };
}

export function signRemoteAttestation(input: {
  authority: unknown; issuer: string; kid: string; key: KeyObject; actionId: string;
  cliSessionProofDigest: string; payloadDigest: string; nonceId: string; nonce: string;
  sessionEvidenceDigest: string; issuedAt: number; expiresAt: number;
}) {
  const a = authorizeRemoteAction(input.authority);
  const fields = z.object({ issuer: remoteId, kid: remoteId, actionId: remoteActionId,
    cliSessionProofDigest: remoteHash, payloadDigest: remoteHash, nonceId: remoteId,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/), sessionEvidenceDigest: remoteHash,
    issuedAt: remoteCounter, expiresAt: remoteCounter }).parse(input);
  requireRemoteDeadline(fields.issuedAt, fields.expiresAt, fields.issuedAt, 30_000);
  if (input.key.type !== 'private' || input.key.asymmetricKeyType !== 'ed25519')
    throw new RemoteAuthorityError('authority_unavailable');
  const body = {
    version: 'remote-action-v1' as const, kind: 'session-attestation' as const,
    issuer: fields.issuer, kid: fields.kid, audience: a.target.nativeAudience, actor: a.actor,
    tenantId: a.target.tenantId, workspaceId: a.target.workspaceId, target: a.target,
    cliSessionProofDigest: fields.cliSessionProofDigest, actionId: fields.actionId, operation: a.operation,
    payloadDigest: fields.payloadDigest, nonceId: fields.nonceId, nonce: fields.nonce,
    consentRevision: a.consent.consentRevision, membershipRevision: a.membershipRevision, role: a.role,
    actionScopes: a.consent.actionScopes, controlPolicyRevision: a.controlPolicyRevision,
    remoteControlEpoch: a.remoteControlEpoch, sessionEvidenceDigest: fields.sessionEvidenceDigest,
    issuedAt: fields.issuedAt, expiresAt: fields.expiresAt,
  };
  return { body, signature: { alg: 'Ed25519' as const,
    value: sign(null, remoteSignedBytes(body), input.key).toString('base64url') } };
}
