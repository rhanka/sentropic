// A2.0b custody row codecs. Both profiles emit the same snake_case columns,
// so one decode layer serves both. Decoders validate discriminators,
// encodings, integer ranges and field combinations; annotations alone are
// insufficient. Explicit `T | null` fields decode SQL NULL exactly; a decoder
// rejects explicit null for a field whose type is only optional.

import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import type {
  BoundLoginSessionV1,
  DigestInvitationV1,
  EmailCodeProofV1,
  EmailRegistrationTicketV1,
  IdentityAccountProfileV1,
  IdentityDigestV1,
  MagicLinkProofV1,
  SingleUseProofV1,
  SocialIdentityV1,
  WebAuthnChallengeV1,
  WebAuthnCredentialV1,
} from '../../identity-contracts/custody.js';
import { isCanonicalBase64UrlV1, isSha256HexV1 } from '../../identity/custody-crypto.js';

export class IdentityCustodyRowError extends Error {
  constructor(readonly table: string, readonly reason: string) {
    super(`Invalid identity custody row in ${table}: ${reason}`);
    this.name = 'IdentityCustodyRowError';
  }
}

type Row = Record<string, unknown>;

const text = (table: string, row: Row, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') throw new IdentityCustodyRowError(table, `column ${column} is not text`);
  return value;
};

const nullableText = (table: string, row: Row, column: string): string | null => {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== 'string') throw new IdentityCustodyRowError(table, `column ${column} is not text-or-null`);
  return value;
};

const booleanOf = (table: string, row: Row, column: string): boolean => {
  const value = row[column];
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  throw new IdentityCustodyRowError(table, `column ${column} is not boolean`);
};

const nullableBooleanOf = (table: string, row: Row, column: string): boolean | null => {
  const value = row[column];
  if (value === null) return null;
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  throw new IdentityCustodyRowError(table, `column ${column} is not boolean-or-null`);
};

/** Parses PostgreSQL int8 (string), number and bigint into safe integers. */
const safeInt = (table: string, row: Row, column: string): number => {
  const value = row[column];
  const parsed = typeof value === 'bigint' ? value : typeof value === 'number' ? BigInt(value) : typeof value === 'string' && value !== '' ? BigInt(value) : null;
  if (parsed === null) throw new IdentityCustodyRowError(table, `column ${column} is not an integer`);
  if (parsed < 0 || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new IdentityCustodyRowError(table, `column ${column} is out of range`);
  }
  return Number(parsed);
};

const uint32 = (table: string, row: Row, column: string): number => {
  const value = safeInt(table, row, column);
  if (value > 4294967295) throw new IdentityCustodyRowError(table, `column ${column} exceeds uint32`);
  return value;
};

const sha256 = (table: string, row: Row, column: string): string => {
  const value = text(table, row, column);
  if (!isSha256HexV1(value)) throw new IdentityCustodyRowError(table, `column ${column} is not lowercase sha256 hex`);
  return value;
};

const base64url = (table: string, row: Row, column: string): string => {
  const value = text(table, row, column);
  if (!isCanonicalBase64UrlV1(value)) throw new IdentityCustodyRowError(table, `column ${column} is not canonical base64url`);
  return value;
};

const digestOf = (table: string, row: Row, algorithmColumn: string, valueColumn: string, keyRefColumn: string): IdentityDigestV1 => {
  const algorithm = nullableText(table, row, algorithmColumn);
  const value = nullableText(table, row, valueColumn);
  const keyRef = nullableText(table, row, keyRefColumn);
  if (algorithm === 'sha256' && value !== null && keyRef === null && isSha256HexV1(value)) {
    return { algorithm: 'sha256', value };
  }
  if (algorithm === 'hmac-sha256' && value !== null && keyRef !== null && keyRef.length > 0 && isSha256HexV1(value)) {
    return { algorithm: 'hmac-sha256', value, keyRef };
  }
  throw new IdentityCustodyRowError(table, 'digest columns do not form a valid algorithm/value/keyRef tuple');
};

const stateOf = <T extends string>(table: string, row: Row, column: string, allowed: readonly T[]): T => {
  const value = text(table, row, column);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new IdentityCustodyRowError(table, `column ${column} has unexpected state`);
  }
  return value as T;
};

export const decodeAccountProfile = (row: Row): IdentityAccountProfileV1 => ({
  userId: text('identity_account_profiles', row, 'user_id'),
  emailVerified: booleanOf('identity_account_profiles', row, 'email_verified'),
  displayName: nullableText('identity_account_profiles', row, 'display_name'),
  approvalDueAt: nullableText('identity_account_profiles', row, 'approval_due_at'),
  approvedAt: nullableText('identity_account_profiles', row, 'approved_at'),
  approvedByUserId: nullableText('identity_account_profiles', row, 'approved_by_user_id'),
  disabledAt: nullableText('identity_account_profiles', row, 'disabled_at'),
  disabledReason: nullableText('identity_account_profiles', row, 'disabled_reason'),
  legacyAccountStatus: nullableText('identity_account_profiles', row, 'legacy_account_status'),
});

export const decodeWebAuthnCredential = (row: Row): WebAuthnCredentialV1 => ({
  proofId: text('identity_webauthn_credentials', row, 'proof_id'),
  userId: text('identity_webauthn_credentials', row, 'user_id'),
  credentialId: base64url('identity_webauthn_credentials', row, 'credential_id'),
  publicKeyCose: base64url('identity_webauthn_credentials', row, 'public_key_cose'),
  counter: uint32('identity_webauthn_credentials', row, 'counter'),
  revision: safeInt('identity_webauthn_credentials', row, 'revision'),
  rpId: text('identity_webauthn_credentials', row, 'rp_id'),
  deviceName: nullableText('identity_webauthn_credentials', row, 'device_name'),
  transports: (() => {
    const raw = nullableText('identity_webauthn_credentials', row, 'transports_json');
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new IdentityCustodyRowError('identity_webauthn_credentials', 'transports_json is not a string array');
    }
    return parsed as readonly string[];
  })(),
  uv: booleanOf('identity_webauthn_credentials', row, 'uv'),
  deviceType: nullableText('identity_webauthn_credentials', row, 'device_type'),
  backedUp: nullableBooleanOf('identity_webauthn_credentials', row, 'backed_up'),
  createdAt: text('identity_webauthn_credentials', row, 'created_at'),
  lastUsedAt: nullableText('identity_webauthn_credentials', row, 'last_used_at'),
  revokedAt: nullableText('identity_webauthn_credentials', row, 'revoked_at'),
});

const decodeBase = (row: Row): Omit<
  WebAuthnChallengeV1,
  'kind' | 'challenge' | 'purpose' | 'rpId' | 'allowedOrigins' | 'userVerification' | 'email' | 'codeDigest' | 'tokenHash'
> => ({
  proofId: text('identity_single_use_proofs', row, 'proof_id'),
  userId: nullableText('identity_single_use_proofs', row, 'user_id'),
  state: stateOf('identity_single_use_proofs', row, 'state', ['pending', 'consumed', 'revoked']),
  revision: safeInt('identity_single_use_proofs', row, 'revision'),
  createdAt: text('identity_single_use_proofs', row, 'created_at'),
  expiresAt: text('identity_single_use_proofs', row, 'expires_at'),
  consumedAt: nullableText('identity_single_use_proofs', row, 'consumed_at'),
  revokedAt: nullableText('identity_single_use_proofs', row, 'revoked_at'),
});

export const decodeSingleUseProof = (row: Row): SingleUseProofV1 => {
  const table = 'identity_single_use_proofs';
  const kind = stateOf(table, row, 'kind', ['webauthn_challenge', 'email_code', 'magic_link']);
  const base = decodeBase(row);
  if (kind === 'webauthn_challenge') {
    const challenge = nullableText(table, row, 'challenge');
    const purpose = nullableText(table, row, 'challenge_purpose');
    const rpId = nullableText(table, row, 'rp_id');
    const origins = nullableText(table, row, 'allowed_origins_json');
    const verification = nullableText(table, row, 'user_verification');
    if (challenge === null || purpose === null || rpId === null || origins === null || verification === null) {
      throw new IdentityCustodyRowError(table, 'challenge row misses required challenge fields');
    }
    if (!isCanonicalBase64UrlV1(challenge)) throw new IdentityCustodyRowError(table, 'challenge is not canonical base64url');
    if (purpose !== 'registration' && purpose !== 'authentication') {
      throw new IdentityCustodyRowError(table, 'challenge purpose is unknown');
    }
    if (verification !== 'required' && verification !== 'preferred' && verification !== 'discouraged') {
      throw new IdentityCustodyRowError(table, 'user verification is unknown');
    }
    const record: WebAuthnChallengeV1 = {
      ...base,
      kind,
      challenge,
      purpose,
      rpId,
      allowedOrigins: JSON.parse(origins) as readonly string[],
      userVerification: verification,
    };
    return record;
  }
  if (kind === 'email_code') {
    const email = nullableText(table, row, 'email');
    if (email === null) throw new IdentityCustodyRowError(table, 'email code row misses email');
    const record: EmailCodeProofV1 = { ...base, kind, email, codeDigest: digestOf(table, row, 'digest_algorithm', 'secret_digest', 'digest_key_ref') };
    return record;
  }
  const email = nullableText(table, row, 'email');
  const tokenHash = nullableText(table, row, 'secret_digest');
  if (email === null || tokenHash === null || !isSha256HexV1(tokenHash)) {
    throw new IdentityCustodyRowError(table, 'magic link row misses email or token hash');
  }
  const record: MagicLinkProofV1 = { ...base, kind, email, tokenHash };
  return record;
};

export const decodeEmailTicket = (row: Row): EmailRegistrationTicketV1 => ({
  codeProofId: text('identity_email_registration_tickets', row, 'code_proof_id'),
  email: text('identity_email_registration_tickets', row, 'email'),
  tokenHash: sha256('identity_email_registration_tickets', row, 'token_hash'),
  userId: nullableText('identity_email_registration_tickets', row, 'user_id'),
  state: stateOf('identity_email_registration_tickets', row, 'state', ['pending', 'consumed', 'revoked']),
  revision: safeInt('identity_email_registration_tickets', row, 'revision'),
  createdAt: text('identity_email_registration_tickets', row, 'created_at'),
  expiresAt: text('identity_email_registration_tickets', row, 'expires_at'),
  consumedAt: nullableText('identity_email_registration_tickets', row, 'consumed_at'),
  revokedAt: nullableText('identity_email_registration_tickets', row, 'revoked_at'),
});

export const decodeDigestInvitation = (row: Row): DigestInvitationV1 => ({
  invitationId: text('identity_invitation_digests', row, 'invitation_id'),
  email: text('identity_invitation_digests', row, 'email'),
  tenantId: nullableText('identity_invitation_digests', row, 'tenant_id'),
  workspaceId: nullableText('identity_invitation_digests', row, 'workspace_id'),
  clientId: nullableText('identity_invitation_digests', row, 'client_id'),
  tokenHash: sha256('identity_invitation_digests', row, 'token_hash'),
  status: stateOf('identity_invitation_digests', row, 'status', ['pending', 'consumed', 'revoked']),
  expiresAt: text('identity_invitation_digests', row, 'expires_at'),
  createdAt: nullableText('identity_invitation_digests', row, 'created_at'),
  consumedAt: nullableText('identity_invitation_digests', row, 'consumed_at'),
  consumedByUserId: nullableText('identity_invitation_digests', row, 'consumed_by_user_id'),
  revision: safeInt('identity_invitation_digests', row, 'revision'),
});

export const decodeBoundSession = (row: Row): BoundLoginSessionV1 => ({
  sessionId: text('identity_login_token_bindings', row, 'session_id'),
  userId: '',
  sessionTokenHash: sha256('identity_login_token_bindings', row, 'session_token_hash'),
  refreshTokenHash: (() => {
    const value = nullableText('identity_login_token_bindings', row, 'refresh_token_hash');
    if (value !== null && !isSha256HexV1(value)) {
      throw new IdentityCustodyRowError('identity_login_token_bindings', 'refresh hash is not sha256 hex');
    }
    return value;
  })(),
  login: {
    mfaVerified: booleanOf('identity_login_token_bindings', row, 'mfa_verified'),
    authTime: safeInt('identity_login_token_bindings', row, 'auth_time'),
    sessionVersion: safeInt('identity_login_token_bindings', row, 'session_version'),
  },
  rotationVersion: safeInt('identity_login_token_bindings', row, 'rotation_version'),
  createdAt: '',
  expiresAt: '',
  revokedAt: null,
  deviceName: nullableText('identity_login_token_bindings', row, 'device_name'),
  ipAddress: nullableText('identity_login_token_bindings', row, 'ip_address'),
  userAgent: nullableText('identity_login_token_bindings', row, 'user_agent'),
  lastActivityAt: nullableText('identity_login_token_bindings', row, 'last_activity_at'),
});

export const decodeSocialLink = (row: Row): SocialIdentityV1 => ({
  proofId: text('identity_social_links', row, 'proof_id'),
  userId: text('identity_social_links', row, 'user_id'),
  provider: text('identity_social_links', row, 'provider'),
  providerSubject: text('identity_social_links', row, 'provider_subject'),
  providerTenant: nullableText('identity_social_links', row, 'provider_tenant'),
  emailAtLink: nullableText('identity_social_links', row, 'email_at_link'),
  emailVerifiedByProvider: booleanOf('identity_social_links', row, 'email_verified_by_provider'),
  linkedAt: text('identity_social_links', row, 'linked_at'),
  lastLoginAt: nullableText('identity_social_links', row, 'last_login_at'),
  revokedAt: nullableText('identity_social_links', row, 'revoked_at'),
  revision: safeInt('identity_social_links', row, 'revision'),
});

export const assertCustodyMaterial = (record: WebAuthnCredentialV1 | SingleUseProofV1): void => {
  if (record === null || typeof record !== 'object') throw new IdentityCustodyErrorV1('identity_material_invalid');
};
