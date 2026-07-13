import type { JwksPort, OauthStateStorePort } from './oauth/state-store-types.js';

export type {
  AuthCodePayload,
  DpopProofRecord,
  JwksKeyRecord,
  JwksPort,
  JwksPublicJwk,
  OauthClientRecord,
  OauthStateStorePort,
  OauthTokenType,
  ServiceClientRecord,
  TokenMeta,
} from './oauth/state-store-types.js';

export type AuthHonoAccountStatus =
  | 'active'
  | 'pending_admin_approval'
  | 'approval_expired_readonly'
  | 'disabled_by_user'
  | 'disabled_by_admin'
  | (string & {});

export type AuthHonoChallengeType = 'registration' | 'authentication';

export interface AuthHonoDeviceInfo {
  name?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthHonoUserRecord {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
  emailVerified: boolean;
  accountStatus: AuthHonoAccountStatus;
  approvalDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthHonoCreateUserInput {
  email: string;
  displayName?: string | null;
  role: string;
  emailVerified?: boolean;
  accountStatus?: AuthHonoAccountStatus;
  approvalDueAt?: Date | null;
}

export interface AuthHonoUpdateUserInput {
  email?: string | null;
  displayName?: string | null;
  role?: string;
  emailVerified?: boolean;
  accountStatus?: AuthHonoAccountStatus;
  approvalDueAt?: Date | null;
  updatedAt?: Date;
}

export interface AuthHonoUserPort {
  findById(userId: string): Promise<AuthHonoUserRecord | null>;
  findByEmail(email: string): Promise<AuthHonoUserRecord | null>;
  create(input: AuthHonoCreateUserInput): Promise<AuthHonoUserRecord>;
  update(userId: string, input: AuthHonoUpdateUserInput): Promise<AuthHonoUserRecord | null>;
  count(): Promise<number>;
}

export interface AuthHonoCredentialRecord {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array | ArrayBuffer | string;
  counter: number;
  transports: string[] | null;
  name: string | null;
  deviceType: string | null;
  backedUp: boolean | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface AuthHonoCreateCredentialInput {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array | ArrayBuffer | string;
  counter: number;
  transports?: string[] | null;
  name?: string | null;
  deviceType?: string | null;
  backedUp?: boolean | null;
}

export interface AuthHonoCredentialPort {
  findById(credentialRecordId: string): Promise<AuthHonoCredentialRecord | null>;
  findByCredentialId(credentialId: string): Promise<AuthHonoCredentialRecord | null>;
  listForUser(userId: string): Promise<AuthHonoCredentialRecord[]>;
  create(input: AuthHonoCreateCredentialInput): Promise<AuthHonoCredentialRecord>;
  updateCounter(credentialId: string, counter: number, lastUsedAt?: Date): Promise<void>;
  rename(credentialRecordId: string, userId: string, name: string): Promise<AuthHonoCredentialRecord | null>;
  revoke(credentialRecordId: string, userId: string): Promise<boolean>;
}

export interface AuthHonoChallengeRecord {
  id: string;
  challenge: string;
  userId: string | null;
  type: AuthHonoChallengeType;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface AuthHonoCreateChallengeInput {
  challenge: string;
  userId?: string | null;
  type: AuthHonoChallengeType;
  expiresAt: Date;
}

export interface AuthHonoChallengePort {
  create(input: AuthHonoCreateChallengeInput): Promise<AuthHonoChallengeRecord>;
  findValid(challenge: string, type: AuthHonoChallengeType): Promise<AuthHonoChallengeRecord | null>;
  markUsed(challenge: string): Promise<void>;
  purgeExpired(now: Date): Promise<number>;
}

export interface AuthHonoSessionRecord {
  id: string;
  userId: string;
  sessionTokenHash: string;
  refreshTokenHash: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  mfaVerified: boolean;
  expiresAt: Date;
  createdAt: Date;
  lastActivityAt: Date;
  revokedAt: Date | null;
}

export interface AuthHonoCreateSessionInput {
  id: string;
  userId: string;
  sessionTokenHash: string;
  refreshTokenHash?: string | null;
  deviceInfo?: AuthHonoDeviceInfo;
  mfaVerified?: boolean;
  expiresAt: Date;
  now: Date;
}

export interface AuthHonoSessionPort {
  create(input: AuthHonoCreateSessionInput): Promise<AuthHonoSessionRecord>;
  findById(sessionId: string): Promise<AuthHonoSessionRecord | null>;
  findByTokenHash(sessionTokenHash: string): Promise<AuthHonoSessionRecord | null>;
  findByRefreshTokenHash(refreshTokenHash: string): Promise<AuthHonoSessionRecord | null>;
  touch(sessionId: string, now: Date): Promise<void>;
  updateTokens(input: {
    expiresAt: Date;
    refreshTokenHash: string;
    sessionId: string;
    sessionTokenHash: string;
  }): Promise<AuthHonoSessionRecord | null>;
  revoke(sessionId: string): Promise<boolean>;
  revokeAllForUser(userId: string): Promise<number>;
  listForUser(userId: string): Promise<AuthHonoSessionRecord[]>;
}

export interface AuthHonoEmailVerificationRecord {
  id: string;
  email: string;
  codeHash: string;
  verificationToken: string | null;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface AuthHonoEmailVerificationPort {
  countRecent(email: string, since: Date): Promise<number>;
  createCode(input: {
    email: string;
    codeHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<AuthHonoEmailVerificationRecord>;
  findLatestValidCode(email: string, codeHash: string, now: Date): Promise<AuthHonoEmailVerificationRecord | null>;
  markUsedWithVerificationToken(id: string, verificationToken: string): Promise<void>;
  verifyToken(email: string, verificationToken: string, now: Date): Promise<boolean>;
}

export interface AuthHonoMagicLinkRecord {
  id: string;
  tokenHash: string;
  email: string;
  userId: string | null;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface AuthHonoMagicLinkPort {
  create(input: {
    email: string;
    tokenHash: string;
    userId?: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<AuthHonoMagicLinkRecord>;
  findValidByTokenHash(tokenHash: string, now: Date): Promise<AuthHonoMagicLinkRecord | null>;
  markUsed(id: string, userId?: string | null): Promise<void>;
}

export interface AuthHonoEmailDeliveryPort {
  sendVerificationCode(input: { email: string; code: string; expiresAt: Date }): Promise<void>;
  sendMagicLink(input: { email: string; token: string; expiresAt: Date; url: string }): Promise<void>;
}

export interface AuthHonoCookiePort {
  readSessionToken(request: Request): string | null;
  readRefreshToken(request: Request): string | null;
  serializeSessionCookie(input: { token: string; expiresAt: Date }): string;
  serializeRefreshCookie(input: { token: string; expiresAt: Date }): string;
  serializeClearedSessionCookie(): string;
  serializeClearedRefreshCookie(): string;
}

export interface AuthHonoSessionClaims {
  userId: string;
  sessionId: string;
  role: string;
  email?: string | null;
  displayName?: string | null;
}

export interface AuthHonoTokenPort {
  hashSecret(secret: string): Promise<string> | string;
  signSessionToken(claims: AuthHonoSessionClaims, expiresAt: Date): Promise<string>;
  verifySessionToken(token: string): Promise<AuthHonoSessionClaims | null>;
  signVerificationToken(input: { email: string; expiresAt: Date }): Promise<string>;
}

export type AuthHonoAuditLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AuthHonoAuditLogPort {
  record(level: AuthHonoAuditLevel, event: string, fields?: Record<string, unknown>): Promise<void> | void;
}

export interface AuthHonoClockPort {
  now(): Date;
  addSeconds(date: Date, seconds: number): Date;
}

export interface AuthHonoRandomPort {
  uuid(): string;
  bytes(length: number): Uint8Array;
  numericCode(length: number): string;
  token(bytes: number): string;
}

export interface AuthHonoAccountPolicyDecision {
  allowed: boolean;
  status?: number;
  code?: string;
  message?: string;
}

export interface AuthHonoAccountPolicyPort {
  normalizeEmail(email: string): string;
  deriveDisplayName(email: string): string;
  resolveUserVerification?(user: AuthHonoUserRecord): 'discouraged' | 'preferred' | 'required';
  roleForNewUser(input: { email: string; isFirstUser: boolean }): Promise<string> | string;
  statusForNewUser(input: { email: string; isFirstUser: boolean; now: Date }): Promise<{
    accountStatus: AuthHonoAccountStatus;
    approvalDueAt: Date | null;
  }> | {
    accountStatus: AuthHonoAccountStatus;
    approvalDueAt: Date | null;
  };
  canAuthenticate(user: AuthHonoUserRecord, now: Date): Promise<AuthHonoAccountPolicyDecision> | AuthHonoAccountPolicyDecision;
  resolveSessionRole(user: AuthHonoUserRecord, now: Date): Promise<string> | string;
  afterUserCreated?(user: AuthHonoUserRecord): Promise<void> | void;
}

/**
 * BR-39e: tenancy spine. OPTIONAL — when absent, auth-hono keeps the legacy behavior of
 * sourcing the auth-code `tenantId` from the client. When present, the tenant claim (`tid`)
 * is derived ONLY from a VALIDATED `approved` membership (never a raw request parameter),
 * and re-checked at token time (lifecycle gate).
 */
export interface AuthHonoTenantPort {
  /** Tenant ids the user is an `approved` member of, for selection + claim derivation. */
  listApprovedTenantIds(userId: string): Promise<string[]>;
  /** True iff (userId, tenantId) is currently an `approved` membership (binding re-check). */
  isApprovedMember(userId: string, tenantId: string): Promise<boolean>;
}

/**
 * ARCH-11 G1c: S2S on-behalf-of (OBO) tenant resolution for the `client_credentials` grant
 * (spec §2.2). OPTIONAL — when absent, `issueServiceToken` keeps the legacy behavior (no `tid`
 * claim, no rejection: byte-identical to the pre-G1c stateless service token).
 *
 * The HOST owns the enforcement policy AND the rollout gate: the reference Sentropic adapter is
 * mode-gated on `TENANT_RESOLUTION_MODE`, returning `{ tid: null }` (no claim, no rejection) in
 * `alias`/`shadow`, and only under `strict` validating the requested tenant against the client's
 * authorized set (fixed `service_clients.tenant_id` UNION active `connector_tenant_enrollments`).
 *
 * Contract:
 *  - `{ tid: string }` → sign that `tid` on the minted access token.
 *  - `{ tid: null }`   → sign NO `tid` (legacy / shadow).
 *  - `{ error }`       → the mint is rejected `400 invalid_target` (strict fail-closed).
 */
export interface AuthHonoServiceTenantPort {
  resolveOboTenant(input: {
    /** The authenticated S2S client (`service_clients.client_id`). */
    clientId: string;
    /** The client's fixed tenant (`service_clients.tenant_id`), or null when unset. */
    fixedTenantId: string | null;
    /** The on-behalf-of `tenant` selector from the token request, or null when omitted. */
    requestedTenant: string | null;
  }): Promise<{ tid: string | null } | { error: 'invalid_target'; description: string }>;
}

/**
 * Consent persistence. OPTIONAL — when absent, auth-hono keeps the legacy behavior of
 * always re-showing the consent screen on every `/authorize`. When present, an approved
 * grant per exact `(userId, clientId)` lets the authorize handler skip consent and issue
 * the auth code directly, provided the stored grant's scopes are a SUPERSET of the
 * requested scopes (scope-escalation re-consents) and `prompt !== 'consent'`.
 *
 * ARCH-11 G1c (spec §4.2.5): `getGrant`/`saveGrant` gain an OPTIONAL `tenantId` — the org the
 * authorize request is scoped to. It is ADDITIVE (a store may ignore it, preserving today's
 * behavior). The reference Sentropic adapter keys the grant on `(userId, clientId, tenantId)`
 * ONLY under `strict`, so an org-A consent never skips consent in org-B (the §1.5 bypass fix).
 */
export interface AuthHonoConsentGrant {
  scopes: string[];
}

export interface AuthHonoConsentStorePort {
  /** The user's currently granted scopes for this client (optionally scoped to `tenantId`), or `null`. */
  getGrant(userId: string, clientId: string, tenantId?: string): Promise<AuthHonoConsentGrant | null>;
  /** Upsert the grant for `(userId, clientId[, tenantId])`, unioning `scopes` with any prior grant. */
  saveGrant(userId: string, clientId: string, scopes: string[], tenantId?: string): Promise<void>;
}

/**
 * BR-39r L4: single-use invitation tokens (invitation → direct device enrollment).
 * OPTIONAL — when absent, the invite path is inert (registration behaves as a normal cold
 * register). The token is the single-use bearer secret bound to an email; it is consumed
 * ATOMICALLY at registration (never at authorize — an emailed link is routinely prefetched).
 *
 * `consume` MUST be a single atomic statement so exactly one concurrent caller wins:
 * `UPDATE auth_invite_tokens SET consumed_at=$now, consumed_by_user_id=$uid
 *  WHERE token_hash=$h AND consumed_at IS NULL AND expires_at>$now RETURNING email`.
 *
 * C3 (no account-enumeration): the caller MUST collapse every failure mode
 * (invalid / expired / consumed / email-mismatch / unknown) into one generic behavior.
 */
export interface AuthHonoInvitesPort {
  /** Look up a still-valid invite by token hash (read-only; does NOT consume). */
  findValid(tokenHash: string, now: Date): Promise<{ email: string; clientId: string | null } | null>;
  /** Atomically consume the invite; returns the bound `email` to the single winner, else `null`. */
  consume(tokenHash: string, now: Date, userId: string): Promise<{ email: string } | null>;
}

/**
 * BR-39e Lot 0: a linked external identity (social/enterprise federation).
 * One external identity `(provider, providerSubject)` maps to EXACTLY ONE Sentropic user (D6).
 * `providerSubject` is the STABLE upstream subject (Google `sub`, GitHub numeric id, MS `oid`,
 * Apple `sub`, FB id) — NEVER the email. `emailAtLink` is audit metadata only (D13).
 */
export interface AuthHonoIdentityRecord {
  id: string;
  userId: string;
  provider: string;
  providerSubject: string;
  emailAtLink: string | null;
  emailVerifiedByProvider: boolean;
  providerTenant: string | null;
  linkedAt: Date;
  lastLoginAt: Date | null;
}

export interface AuthHonoLinkIdentityInput {
  userId: string;
  provider: string;
  providerSubject: string;
  emailAtLink: string | null;
  emailVerifiedByProvider: boolean;
  providerTenant?: string | null;
  now: Date;
}

/**
 * One-time, SERVER-SIDE federation flow-state (D5, CRITICAL). Holds the upstream CSRF `state`,
 * the OIDC `nonce`, the PKCE `codeVerifier`, and a POINTER (`continuationToken`) to the sealed
 * OAuth continuation. It is referenced by the opaque `id`, which is the ONLY value carried through
 * the provider round-trip (in a bound `HttpOnly; Secure; SameSite=Lax` cookie). The sealed HMAC
 * OAuth `continue` is NEVER placed in a browser-visible / provider-visible parameter — it lives
 * here server-side, dereferenced by pointer. Consumed verify-and-DELETE (single-use + TTL).
 */
export interface AuthHonoFederationFlowState {
  id: string;
  provider: string;
  upstreamState: string;
  nonce: string | null;
  codeVerifier: string | null;
  continuationToken: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthHonoCreateFederationFlowStateInput {
  provider: string;
  upstreamState: string;
  nonce?: string | null;
  codeVerifier?: string | null;
  continuationToken?: string | null;
  expiresAt: Date;
  now: Date;
}

/**
 * BR-39e Lot 0 federation substrate. OPTIONAL — when absent, auth-hono keeps its legacy behavior
 * and no federation routes are mounted. Owns ONLY the `identities` link table + the one-time
 * flow-state store; user find/upsert stays on the existing `users` port (`create`/`findByEmail`/
 * `findById`). The SAFE linking algorithm (D6/D7) lives in `resolveOrCreateFederatedUser`, which
 * composes this port + `users` + `accountPolicy`.
 */
export interface AuthHonoFederationPort {
  /** Resolve by the stable `(provider, providerSubject)` — the FIRST and only linking key (D6). */
  findIdentityBySubject(provider: string, providerSubject: string): Promise<AuthHonoIdentityRecord | null>;
  /** List a user's linked identities (settings surface + unlink last-factor lockout check, D12). */
  findIdentitiesForUser(userId: string): Promise<AuthHonoIdentityRecord[]>;
  /**
   * Insert a link. MUST reject a duplicate `(provider, providerSubject)` by throwing
   * `AuthHonoIdentityConflictError` so the resolver can re-read + log the existing user in
   * idempotently (concurrent-callback race).
   */
  linkIdentity(input: AuthHonoLinkIdentityInput): Promise<AuthHonoIdentityRecord>;
  unlinkIdentity(userId: string, provider: string, providerSubject: string): Promise<boolean>;
  touchLogin(identityId: string, now: Date): Promise<void>;
  /**
   * True iff the user already holds a COMPLETED sign-in factor (a webauthn credential, an existing
   * federated identity, or a used magic link). A `false` return marks a "non-credentialed shell"
   * that MAY be auto-linked (D7); a credentialed account is NEVER silently merged.
   */
  isUserCredentialed(userId: string): Promise<boolean>;
  /** Persist a one-time server-side flow-state; returns the record incl. the opaque `id` pointer. */
  createFlowState(input: AuthHonoCreateFederationFlowStateInput): Promise<AuthHonoFederationFlowState>;
  /** Verify-and-DELETE by `id` (single-use + TTL); `null` if missing / expired / already consumed. */
  consumeFlowState(id: string, now: Date): Promise<AuthHonoFederationFlowState | null>;
}

export interface AuthHonoPorts {
  users: AuthHonoUserPort;
  credentials: AuthHonoCredentialPort;
  challenges: AuthHonoChallengePort;
  sessions: AuthHonoSessionPort;
  emailVerification: AuthHonoEmailVerificationPort;
  magicLinks: AuthHonoMagicLinkPort;
  emailDelivery: AuthHonoEmailDeliveryPort;
  cookies: AuthHonoCookiePort;
  tokens: AuthHonoTokenPort;
  auditLog: AuthHonoAuditLogPort;
  clock: AuthHonoClockPort;
  random: AuthHonoRandomPort;
  accountPolicy: AuthHonoAccountPolicyPort;
  oauthStateStore: OauthStateStorePort;
  jwks: JwksPort;
  /** BR-39e tenancy spine (optional; legacy behavior when absent). */
  tenant?: AuthHonoTenantPort;
  /** ARCH-11 G1c S2S OBO tenant resolution (optional; no `tid`, no rejection when absent). */
  serviceTenant?: AuthHonoServiceTenantPort;
  /** Consent persistence (optional; always-consent legacy behavior when absent). */
  consentStore?: AuthHonoConsentStorePort;
  /** BR-39r L4 single-use invitation tokens (optional; inert when absent). */
  invites?: AuthHonoInvitesPort;
  /** BR-39e Lot 0 social/enterprise federation substrate (optional; no federation routes when absent). */
  federation?: AuthHonoFederationPort;
}
