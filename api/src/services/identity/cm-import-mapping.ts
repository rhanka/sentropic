import type { BoundLoginSessionV1, IdentityImportRowV1, SingleUseProofV1, WebAuthnCredentialV1 } from '@sentropic/cluster-mesh';
import { sourceBoolean as bool, sourceChoice as choice, sourceCounter as counter, sourceDigest as digest,
  sourceNullableText as nullable, sourceNullableTime as nullableTime, sourceStringArray,
  sourceText as text, sourceTime as time, type A4SourceRow } from './cm-import-values';

export function mapA4Account(row: A4SourceRow): Extract<IdentityImportRowV1, { entity: 'account' }> {
  const status = choice(row.account_status,
    ['active', 'pending_admin_approval', 'approval_expired_readonly', 'disabled_by_user', 'disabled_by_admin']);
  const userId = text(row.id), createdAt = time(row.created_at);
  return { entity: 'account', record: {
    userId, email: text(row.email).trim().toLowerCase(),
    globalRole: choice(row.role, ['admin_app', 'admin_org', 'editor', 'guest']),
    accountStatus: status === 'active' ? 'active' : status.startsWith('disabled_') ? 'disabled' : 'pending_admin_approval',
    createdAt, updatedAt: row.updated_at === null ? createdAt : time(row.updated_at),
  }, profile: {
    userId, emailVerified: bool(row.email_verified), displayName: nullable(row.display_name),
    approvalDueAt: nullableTime(row.approval_due_at), approvedAt: nullableTime(row.approved_at),
    approvedByUserId: nullable(row.approved_by_user_id), disabledAt: nullableTime(row.disabled_at),
    disabledReason: nullable(row.disabled_reason), legacyAccountStatus: status,
  } };
}

export const mapA4Credential = (row: A4SourceRow, rpId: string): WebAuthnCredentialV1 => ({
  proofId: text(row.id), userId: text(row.user_id), credentialId: text(row.credential_id),
  publicKeyCose: text(row.public_key_cose), counter: counter(row.counter, 4294967295), revision: 0,
  rpId, deviceName: text(row.device_name), transports: sourceStringArray(row.transports_json),
  uv: bool(row.uv), deviceType: null, backedUp: null, createdAt: time(row.created_at),
  lastUsedAt: nullableTime(row.last_used_at), revokedAt: null,
});

export function mapA4Proof(kind: SingleUseProofV1['kind'], row: A4SourceRow,
  verifier: { rpId: string; origins: readonly string[] }): SingleUseProofV1 {
  const base = { proofId: text(row.id), userId: kind === 'email_code' ? null : nullable(row.user_id),
    state: bool(row.used) ? 'consumed' as const : 'pending' as const, revision: 0,
    createdAt: time(row.created_at), expiresAt: time(row.expires_at), consumedAt: null, revokedAt: null };
  if (kind === 'email_code') return { ...base, kind, email: text(row.email).trim().toLowerCase(),
    codeDigest: { algorithm: 'sha256', value: digest(row.code_hash) } };
  if (kind === 'magic_link') return { ...base, kind, email: text(row.email).trim().toLowerCase(), tokenHash: digest(row.token_hash) };
  const purpose = choice(row.type, ['registration', 'authentication']);
  return { ...base, kind, challenge: text(row.challenge), purpose, rpId: verifier.rpId,
    allowedOrigins: [...verifier.origins], userVerification: purpose === 'registration' ? 'preferred' : 'required' };
}

export function mapA4Login(row: A4SourceRow, importedAt: string, remotelyRevoked = false): BoundLoginSessionV1 {
  const createdAt = time(row.created_at), expiresAt = time(row.expires_at), mfaVerified = bool(row.mfa_verified);
  const sessionVersion = Date.parse(createdAt);
  return { sessionId: text(row.id), userId: text(row.user_id),
    status: remotelyRevoked ? 'revoked' : expiresAt <= time(importedAt) ? 'expired' : 'active',
    mfaState: mfaVerified ? 'step_up' : 'none', refreshCount: 0,
    sessionTokenHash: digest(row.session_token_hash),
    refreshTokenHash: row.refresh_token_hash === null ? null : digest(row.refresh_token_hash),
    login: { mfaVerified, sessionVersion, authTime: Math.floor(sessionVersion / 1000) }, rotationVersion: 0,
    createdAt, expiresAt, deviceName: nullable(row.device_name), ipAddress: nullable(row.ip_address),
    userAgent: nullable(row.user_agent), lastActivityAt: nullableTime(row.last_activity_at),
  };
}
