import { boolean, customType, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Workspace constants (keep stable IDs for migrations/backfills)
export const ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id'), // nullable; UNIQUE constraint removed to allow multiple workspaces per user
  name: text('name').notNull(),
  type: text('type').notNull().default('ai-priorities'), // 'neutral' | 'ai-priorities' | 'opportunity' | 'code'
  // ARCH-11 G1a: the single durable `workspace → tenant` edge (one tenant → many workspaces;
  // one workspace → exactly one tenant). Real FK to `tenants` (D1=B: tenant = org). DEFAULT-safe
  // for rolling deploys: fast-default 'sentropic' so old + new pods both satisfy NOT NULL during
  // the roll. `tenantId` is NOT the alias `workspaceId` — G1b wires `resolveTenant`; NO alias here.
  tenantId: text('tenant_id').notNull().default('sentropic').references(() => tenants.id),
  gateConfig: jsonb('gate_config'), // nullable; gate sequence config per workspace. null = free gates (backward-compatible)
  hiddenAt: timestamp('hidden_at', { withTimezone: false }), // nullable; timestamp when workspace was hidden
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  typeIdx: index('workspaces_type_idx').on(table.type),
  ownerUserIdIdx: index('workspaces_owner_user_id_idx').on(table.ownerUserId),
  tenantIdIdx: index('workspaces_tenant_id_idx').on(table.tenantId),
}));

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  name: text('name').notNull(),
  status: text('status').default('completed'), // 'draft', 'enriching', 'completed'
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
  // Business fields moved to JSONB to avoid schema churn (similar to use_cases.data)
  // Suggested structure (non-exhaustive):
  // - industry, size, products, processes, challenges, objectives, technologies
  // - kpis: string (markdown)
  // - references: { title, url, excerpt? }[]
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
});

export const folders = pgTable('folders', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  name: text('name').notNull(),
  description: text('description'),
  organizationId: text('organization_id').references(() => organizations.id),
  matrixConfig: text('matrix_config'),
  executiveSummary: text('executive_summary'), // JSON string with 4 sections: { introduction, analyse, recommandation, synthese_executive }
  status: text('status').default('completed'), // 'generating', 'completed'
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
});

export const initiatives = pgTable('initiatives', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  folderId: text('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').references(() => organizations.id),
  status: text('status').default('completed'), // 'draft', 'generating', 'detailing', 'completed'
  model: text('model'), // Model used for generation (e.g., 'gpt-5', 'gpt-4.1-nano') - nullable, uses default from settings
  // BR-04: initiative lifecycle columns
  antecedentId: text('antecedent_id'), // self-FK for lineage (parent initiative)
  maturityStage: text('maturity_stage'), // e.g. 'G0', 'G2', 'G5', 'G7'. Nullable (null = no gating)
  gateStatus: text('gate_status'), // 'pending' | 'approved' | 'rejected'. Nullable
  templateSnapshotId: text('template_snapshot_id'), // template version at creation for traceability
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`)
}, (table) => ({
  antecedentIdFk: foreignKey({
    columns: [table.antecedentId],
    foreignColumns: [table.id],
    name: 'initiatives_antecedent_id_fk',
  }),
  antecedentIdIdx: index('initiatives_antecedent_id_idx').on(table.antecedentId),
  maturityStageIdx: index('initiatives_maturity_stage_idx').on(table.maturityStage),
  gateStatusIdx: index('initiatives_gate_status_idx').on(table.gateStatus),
}));

// Backward-compatible alias for code that still references useCases
export const useCases = initiatives;

export const settings = pgTable('settings', {
  key: text('key').notNull(),
  userId: text('user_id'),
  value: text('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  keyIdx: index('settings_key_idx').on(table.key),
  userIdIdx: index('settings_user_id_idx').on(table.userId),
  userKeyIdx: index('settings_user_key_idx').on(table.userId, table.key),
}));

export const businessConfig = pgTable('business_config', {
  id: text('id').primaryKey(),
  sectors: text('sectors'),
  processes: text('processes')
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  provider: text('provider'),
  profile: text('profile'),
  userId: text('user_id'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  expiresAt: text('expires_at')
});

export const jobQueue = pgTable('job_queue', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'use_case_list' | 'use_case_detail'
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed'
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  data: text('data').notNull(), // JSON string
  result: text('result'), // JSON string
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
}, (table) => ({
  statusStartedAtIdx: index('job_queue_status_started_at_idx').on(table.status, table.startedAt),
}));

// WebAuthn Authentication Tables
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  displayName: text('display_name'),
  role: text('role').notNull().default('guest'), // 'admin_app' | 'admin_org' | 'editor' | 'guest'
  accountStatus: text('account_status').notNull().default('active'),
  approvalDueAt: timestamp('approval_due_at', { withTimezone: false }),
  approvedAt: timestamp('approved_at', { withTimezone: false }),
  // Self-FK: define via table callback below to avoid TS self-referential initializer inference issues.
  approvedByUserId: text('approved_by_user_id'),
  disabledAt: timestamp('disabled_at', { withTimezone: false }),
  disabledReason: text('disabled_reason'),
  emailVerified: boolean('email_verified').notNull().default(false), // Email verification required before WebAuthn registration
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  approvedByUserIdFk: foreignKey({
    columns: [table.approvedByUserId],
    foreignColumns: [table.id],
  }),
}));

export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: text('id').primaryKey(),
  credentialId: text('credential_id').notNull().unique(), // base64url-encoded
  publicKeyCose: text('public_key_cose').notNull(), // base64url-encoded COSE public key
  counter: integer('counter').notNull().default(0),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deviceName: text('device_name').notNull(),
  transportsJson: text('transports_json'), // JSON-encoded array
  uv: boolean('uv').notNull().default(false), // user verification
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: false })
}, (table) => ({
  userIdIdx: index('webauthn_credentials_user_id_idx').on(table.userId),
}));

export const userSessions = pgTable('user_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionTokenHash: text('session_token_hash').notNull().unique(),
  refreshTokenHash: text('refresh_token_hash').unique(),
  deviceName: text('device_name'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  mfaVerified: boolean('mfa_verified').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  userIdIdx: index('user_sessions_user_id_idx').on(table.userId),
  expiresAtIdx: index('user_sessions_expires_at_idx').on(table.expiresAt),
}));

// BR-41c authorization foundation. These records identify an enrolled Cowork
// device and authorize a later, separate Lot 4 execution path; they never run
// screen capture or input actions themselves.
export const coworkDevices = pgTable('cowork_devices', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deviceName: text('device_name'),
  publicKey: text('public_key').notNull(),
  publicKeyFingerprint: text('public_key_fingerprint').notNull(),
  capabilities: jsonb('capabilities').$type<import('../services/cowork/device-capabilities').CoworkDeviceCapabilities>().notNull().default(sql`'{}'::jsonb`),
  status: text('status').notNull().default('active'),
  enrolledAt: timestamp('enrolled_at', { withTimezone: false }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: false }),
}, (table) => ({
  userStatusIdx: index('cowork_devices_user_status_idx').on(table.userId, table.status),
  fingerprintIdx: index('cowork_devices_fingerprint_idx').on(table.publicKeyFingerprint),
}));

export const coworkDevicePresence = pgTable('cowork_device_presence', {
  deviceId: text('device_id')
    .primaryKey()
    .references(() => coworkDevices.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  connectedAt: timestamp('connected_at', { withTimezone: false }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  userStatusIdx: index('cowork_device_presence_user_status_idx').on(table.userId, table.status),
}));

export const coworkDeviceLeases = pgTable('cowork_device_leases', {
  id: text('id').primaryKey(),
  deviceId: text('device_id')
    .notNull()
    .references(() => coworkDevices.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  turnRef: text('turn_ref').notNull(),
  nonce: text('nonce').notNull(),
  scope: jsonb('scope').$type<Record<string, unknown> | null>(),
  status: text('status').notNull().default('issued'),
  issuedAt: timestamp('issued_at', { withTimezone: false }).notNull().defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: false }),
  consumedAt: timestamp('consumed_at', { withTimezone: false }),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
}, (table) => ({
  deviceStatusIdx: index('cowork_device_leases_device_status_idx').on(table.deviceId, table.status),
  expiresIdx: index('cowork_device_leases_expires_idx').on(table.expiresAt),
  nonTerminalDeviceTurnUnique: uniqueIndex('cowork_device_leases_device_turn_unique')
    .on(table.deviceId, table.turnRef)
    .where(sql`${table.status} IN ('issued', 'acknowledged')`),
}));

export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull().unique(), // base64url-encoded
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // nullable for registration
  type: text('type').notNull(), // 'registration' | 'authentication'
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  expiresAtIdx: index('webauthn_challenges_expires_at_idx').on(table.expiresAt),
  userIdIdx: index('webauthn_challenges_user_id_idx').on(table.userId),
}));

export const magicLinks = pgTable('magic_links', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  email: text('email').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }), // nullable for new users
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  expiresAtIdx: index('magic_links_expires_at_idx').on(table.expiresAt),
  emailIdx: index('magic_links_email_idx').on(table.email),
}));

export const emailVerificationCodes = pgTable('email_verification_codes', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull(), // SHA-256 hash of the 6-digit code
  email: text('email').notNull(),
  verificationToken: text('verification_token').unique(), // Token returned after code verification, used for registration
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  expiresAtIdx: index('email_verification_codes_expires_at_idx').on(table.expiresAt),
  emailIdx: index('email_verification_codes_email_idx').on(table.email),
  verificationTokenIdx: index('email_verification_codes_verification_token_idx').on(table.verificationToken),
}));

// BR-39r L4: single-use invitation tokens (invitation → direct device enrollment).
// Token value is opaque high-entropy with prefix `sit_`; only the SHA-256 hash is stored.
// Consumed ATOMICALLY at registration (UPDATE ... WHERE consumed_at IS NULL AND expires_at>now).
export const authInviteTokens = pgTable('auth_invite_tokens', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(), // SHA-256 hash of the opaque `sit_` token
  email: text('email').notNull(),
  clientId: text('client_id'), // nullable: invite may not be bound to a specific RP
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: false }), // nullable until consumed (single-use)
  consumedByUserId: text('consumed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  expiresAtIdx: index('auth_invite_tokens_expires_at_idx').on(table.expiresAt),
}));

// BR-39e Lot 0: social/enterprise federation substrate.
// `identities` links a stable external identity `(provider, provider_subject)` to exactly one
// Sentropic user (D6). `provider_subject` is the STABLE upstream subject (Google `sub`, GitHub
// numeric id, MS `oid`, Apple `sub`, FB id) — NEVER the email. `email_at_link` is audit-only (D13);
// `token_secret` stays null in v1 (broker drops the provider token, D1). FK ON DELETE CASCADE from
// `users` implements GDPR erasure of the linked profile (D14).
export const identities = pgTable('identities', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'google'|'github'|'microsoft'|'apple'|'facebook'
  providerSubject: text('provider_subject').notNull(), // STABLE subject, NOT the email
  emailAtLink: text('email_at_link'), // provider-asserted email at link time (audit only, D13)
  emailVerifiedByProvider: boolean('email_verified_by_provider').notNull().default(false),
  providerTenant: text('provider_tenant'), // MS `tid` (null for others); part of the MS subject policy
  tokenSecret: text('token_secret'), // nullable; enc:v1: AES-256-GCM if a provider token is ever stored
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (table) => ({
  // One external identity ↔ exactly one user (D6): duplicate insert is rejected (K-UNIQUE).
  providerSubjectUnique: uniqueIndex('identities_provider_subject_unique').on(table.provider, table.providerSubject),
  userIdIdx: index('identities_user_id_idx').on(table.userId),
}));

// One-time, SERVER-SIDE federation flow-state (D5, CRITICAL). Holds the upstream CSRF `state`, the
// OIDC `nonce`, the PKCE `code_verifier`, and a POINTER (`continuation_token`) to the sealed OAuth
// continuation. Referenced by the opaque `id` (the ONLY value carried through the provider round-trip,
// in a bound HttpOnly cookie). The sealed HMAC `continue` NEVER travels in a browser/provider param —
// it stays here server-side. Consumed verify-and-DELETE (single-use + TTL; K-FLOW / K-STATE).
export const federationFlowStates = pgTable('federation_flow_states', {
  id: text('id').primaryKey(), // opaque pointer carried in the bound cookie
  provider: text('provider').notNull(),
  upstreamState: text('upstream_state').notNull(), // CSRF state sent to the provider
  nonce: text('nonce'), // OIDC nonce (null for pure OAuth2)
  codeVerifier: text('code_verifier'), // PKCE verifier (null where unsupported)
  continuationToken: text('continuation_token'), // POINTER to the sealed OAuth continuation (server-side only)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => ({
  expiresAtIdx: index('federation_flow_states_expires_at_idx').on(table.expiresAt),
}));

export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecretHash: text('client_secret_hash'),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  allowedScopes: text('allowed_scopes').array().notNull(),
  grantTypes: text('grant_types').array().notNull().default(sql`ARRAY['authorization_code']::text[]`),
  responseTypes: text('response_types').array().notNull().default(sql`ARRAY['code']::text[]`),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('client_secret_basic'),
  dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').notNull().default(false),
  requirePkce: boolean('require_pkce').notNull().default(true),
  // BR-39l Lot 2: RFC 8707 resource-indicator allowlist for the authorization_code flow.
  // Additive, default-deny ('{}' = no resource permitted ⇒ invalid_target).
  resourceIndicators: text('resource_indicators').array().notNull().default(sql`'{}'`),
  // BR-39e Lot 4: a client belongs to a tenant (governance). FK to `tenants`, default to the
  // public `sentropic` tenant; ON DELETE set null so removing a tenant orphans (not deletes) clients.
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }).default('sentropic'),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  clientIdIdx: index('oauth_clients_client_id_idx').on(table.clientId),
  ownerUserIdIdx: index('oauth_clients_owner_user_id_idx').on(table.ownerUserId),
  tenantIdIdx: index('oauth_clients_tenant_id_idx').on(table.tenantId),
}));

export const authorizationCodes = pgTable('authorization_codes', {
  code: text('code').primaryKey(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id'),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull(),
  dpopJkt: text('dpop_jkt'),
  nonce: text('nonce'),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  clientIdIdx: index('authorization_codes_client_id_idx').on(table.clientId),
  expiresAtIdx: index('authorization_codes_expires_at_idx').on(table.expiresAt),
  tenantIdIdx: index('authorization_codes_tenant_id_idx').on(table.tenantId),
  userIdIdx: index('authorization_codes_user_id_idx').on(table.userId),
}));

export const oauthTokens = pgTable('oauth_tokens', {
  jti: text('jti').primaryKey(),
  tokenType: text('token_type').notNull(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id'),
  scope: text('scope').notNull(),
  audience: text('audience').notNull(),
  dpopJkt: text('dpop_jkt'),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  clientIdIdx: index('oauth_tokens_client_id_idx').on(table.clientId),
  expiresAtIdx: index('oauth_tokens_expires_at_idx').on(table.expiresAt),
  tenantIdIdx: index('oauth_tokens_tenant_id_idx').on(table.tenantId),
  userIdIdx: index('oauth_tokens_user_id_idx').on(table.userId),
}));

// Consent persistence: a user's approved grant per exact (user_id, client_id, tenant_id). The IdP
// skips the consent screen when the stored scopes are a superset of the requested scopes. No row ⇒
// re-consent (always-consent legacy behavior). Migration 0035.
// ARCH-11 G1a (§1.5, Codex-found cross-tenant consent bypass): the grant is TENANTIZED — a grant in
// org-A must NOT be reused when the same client authorizes in org-B. `tenant_id` is DEFAULT-safe
// ('sentropic') so old-pod inserts during the roll still satisfy NOT NULL; the unique key carries
// the tenant leg. G1a is DATA-only: the getGrant/saveGrant tenant threading is G1c.
export const oauthConsents = pgTable('oauth_consents', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().default('sentropic'),
  scopes: text('scopes').array().notNull().default(sql`'{}'`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  userClientTenantUnique: uniqueIndex('oauth_consents_user_id_client_id_tenant_id_unique').on(
    table.userId,
    table.clientId,
    table.tenantId,
  ),
  userIdIdx: index('oauth_consents_user_id_idx').on(table.userId),
}));

export const oauthDpopProofs = pgTable('oauth_dpop_proofs', {
  jti: text('jti').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  expiresAtIdx: index('oauth_dpop_proofs_expires_at_idx').on(table.expiresAt),
}));

export const revokedTokens = pgTable('revoked_tokens', {
  jti: text('jti').primaryKey(),
  clientId: text('client_id').references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id'),
  revokedAt: timestamp('revoked_at', { withTimezone: false }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
}, (table) => ({
  clientIdIdx: index('revoked_tokens_client_id_idx').on(table.clientId),
  expiresAtIdx: index('revoked_tokens_expires_at_idx').on(table.expiresAt),
  tenantIdIdx: index('revoked_tokens_tenant_id_idx').on(table.tenantId),
  userIdIdx: index('revoked_tokens_user_id_idx').on(table.userId),
}));

export const idTokenSigningKeys = pgTable('id_token_signing_keys', {
  kid: text('kid').primaryKey(),
  alg: text('alg').notNull().default('EdDSA'),
  crv: text('crv').notNull().default('Ed25519'),
  publicJwk: jsonb('public_jwk').notNull(),
  privateKeyEncrypted: bytea('private_key_encrypted').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: false }),
}, (table) => ({
  activeIdx: index('id_token_signing_keys_active_idx').on(table.active),
  oneActiveIdx: uniqueIndex('id_token_signing_keys_one_active_idx').on(table.active).where(sql`${table.active} = true`),
}));

export const serviceClients = pgTable('service_clients', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecretHash: text('client_secret_hash').notNull(),
  displayName: text('display_name'),
  allowedScopes: text('allowed_scopes').array().notNull(),
  resourceIndicators: text('resource_indicators').array().notNull().default(sql`'{}'`),
  dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').notNull().default(false),
  // ARCH-11 G1a (§4.1.6): the S2S source of tenant (resolveTenant({clientId}) reads this, NOT
  // oauth_clients.tenant_id). Stays nullable, but gains a DEFAULT so new single-org clients inherit
  // a tenant; existing NULL rows are backfilled to 'sentropic' by migration 0038.
  tenantId: text('tenant_id').default('sentropic'),
  secretRotatedAt: timestamp('secret_rotated_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: false }),
}, (table) => ({
  clientIdIdx: index('service_clients_client_id_idx').on(table.clientId),
  tenantIdIdx: index('service_clients_tenant_id_idx').on(table.tenantId),
}));

export const documentConnectorAccounts = pgTable('document_connector_accounts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('google_drive'),
  status: text('status').notNull().default('disconnected'), // 'connected' | 'disconnected' | 'error'
  accountEmail: text('account_email'),
  accountSubject: text('account_subject'),
  scopes: jsonb('scopes').notNull().default(sql`'[]'::jsonb`),
  tokenSecret: text('token_secret'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: false }),
  connectedAt: timestamp('connected_at', { withTimezone: false }),
  disconnectedAt: timestamp('disconnected_at', { withTimezone: false }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceUserProviderAccountSubjectUnique: uniqueIndex('document_connector_accounts_workspace_user_provider_subject_unique').on(
    table.workspaceId,
    table.userId,
    table.provider,
    table.accountSubject,
  ),
  workspaceIdIdx: index('document_connector_accounts_workspace_id_idx').on(table.workspaceId),
  userIdIdx: index('document_connector_accounts_user_id_idx').on(table.userId),
  statusIdx: index('document_connector_accounts_status_idx').on(table.status),
  providerIdx: index('document_connector_accounts_provider_idx').on(table.provider),
}));

export const llmProviderAccounts = pgTable('llm_provider_accounts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull().default('user'),
  targetProviderId: text('target_provider_id').notNull(),
  transportProviderId: text('transport_provider_id').notNull(),
  externalAccountId: text('external_account_id'),
  accountLabel: text('account_label'),
  status: text('status').notNull().default('active'),
  modelAllowlist: jsonb('model_allowlist').notNull().default(sql`'[]'::jsonb`),
  priority: integer('priority').notNull().default(0),
  weight: integer('weight').notNull().default(1),
  tokenSecret: text('token_secret'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: false }),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: false }),
  connectedAt: timestamp('connected_at', { withTimezone: false }),
  disconnectedAt: timestamp('disconnected_at', { withTimezone: false }),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: false }),
  lastError: text('last_error'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  ownerTransportExternalUnique: uniqueIndex('llm_provider_accounts_owner_transport_external_unique').on(
    table.ownerUserId,
    table.targetProviderId,
    table.transportProviderId,
    table.externalAccountId,
  ).where(sql`${table.externalAccountId} IS NOT NULL`),
  routingIdx: index('llm_provider_accounts_routing_idx').on(
    table.ownerUserId,
    table.targetProviderId,
    table.transportProviderId,
    table.status,
    table.priority,
  ),
  workspaceIdx: index('llm_provider_accounts_workspace_idx').on(table.workspaceId),
  cooldownIdx: index('llm_provider_accounts_cooldown_idx').on(table.cooldownUntil),
}));

export const llmAccountLeases = pgTable('llm_account_leases', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  affinityKey: text('affinity_key').notNull(),
  targetProviderId: text('target_provider_id').notNull(),
  transportProviderId: text('transport_provider_id').notNull(),
  modelId: text('model_id').notNull().default(''),
  accountId: text('account_id')
    .notNull()
    .references(() => llmProviderAccounts.id, { onDelete: 'cascade' }),
  stableSessionId: text('stable_session_id').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
  releasedAt: timestamp('released_at', { withTimezone: false }),
}, (table) => ({
  activeAffinityUnique: uniqueIndex('llm_account_leases_active_affinity_unique').on(
    sql`coalesce(${table.workspaceId}, '')`,
    sql`coalesce(${table.userId}, '')`,
    table.affinityKey,
    table.targetProviderId,
    table.transportProviderId,
    table.modelId,
  ).where(sql`${table.status} = 'active'`),
  accountIdx: index('llm_account_leases_account_idx').on(table.accountId),
}));

export const llmAccountReservations = pgTable('llm_account_reservations', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => llmProviderAccounts.id, { onDelete: 'cascade' }),
  leaseId: text('lease_id')
    .notNull()
    .references(() => llmAccountLeases.id, { onDelete: 'cascade' }),
  requestId: text('request_id'),
  status: text('status').notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: false }),
}, (table) => ({
  activeAccountIdx: index('llm_account_reservations_active_account_idx')
    .on(table.accountId, table.expiresAt)
    .where(sql`${table.status} = 'active'`),
  leaseIdx: index('llm_account_reservations_lease_idx').on(table.leaseId),
}));

export const llmAccountQuotaState = pgTable('llm_account_quota_state', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => llmProviderAccounts.id, { onDelete: 'cascade' }),
  quotaKey: text('quota_key').notNull(),
  status: text('status').notNull().default('unknown'),
  utilizationBasisPoints: integer('utilization_basis_points'),
  remainingCount: integer('remaining_count'),
  resetAt: timestamp('reset_at', { withTimezone: false }),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: false }),
  rawPayload: jsonb('raw_payload').notNull().default(sql`'{}'::jsonb`),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  accountKeyUnique: uniqueIndex('llm_account_quota_state_account_key_unique').on(
    table.accountId,
    table.quotaKey,
  ),
  statusIdx: index('llm_account_quota_state_status_idx').on(
    table.status,
    table.cooldownUntil,
  ),
}));

export type OrganizationRow = typeof organizations.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;
export type InitiativeRow = typeof initiatives.$inferSelect;
export type UseCaseRow = InitiativeRow; // backward-compatible alias
export type SettingsRow = typeof settings.$inferSelect;
export type BusinessConfigRow = typeof businessConfig.$inferSelect;
export type JobQueueRow = typeof jobQueue.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
// Chatbot Tables (Lot A)
export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Workspace scope for this chat session.
  // - For regular users: their own workspace (set at session creation)
  // - For admin_app: can be a shared workspace (read-only) or Admin Workspace
  workspaceId: text('workspace_id').references(() => workspaces.id),
  primaryContextType: text('primary_context_type'), // 'organization' | 'folder' | 'usecase' | 'executive_summary'
  primaryContextId: text('primary_context_id'),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow()
}, (table) => ({
  userIdIdx: index('chat_sessions_user_id_idx').on(table.userId),
  primaryContextIdx: index('chat_sessions_primary_context_idx').on(table.primaryContextType, table.primaryContextId),
  workspaceIdIdx: index('chat_sessions_workspace_id_idx').on(table.workspaceId),
}));

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system' | 'tool'
  content: text('content'), // nullable for tool calls
  contexts: jsonb('contexts'), // array of { contextType, contextId } for message traceability
  attachments: jsonb('attachments'), // array of media/document refs attached to the message
  toolCalls: jsonb('tool_calls'), // array of tool calls OpenAI
  toolCallId: text('tool_call_id'), // ID du tool call si ce message est un résultat d'outil
  reasoning: text('reasoning'), // Tokens de reasoning (pour modèles avec reasoning)
  model: text('model'), // Modèle OpenAI utilisé
  promptId: text('prompt_id'), // ID du prompt utilisé (nullable pour sessions informelles)
  promptVersionId: text('prompt_version_id'), // Version précise du prompt (nullable pour sessions informelles)
  sequence: integer('sequence').notNull(), // Ordre du message dans la conversation
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  sessionIdIdx: index('chat_messages_session_id_idx').on(table.sessionId),
  sequenceIdx: index('chat_messages_sequence_idx').on(table.sessionId, table.sequence),
  promptVersionIdIdx: index('chat_messages_prompt_version_id_idx').on(table.promptVersionId),
}));

export const chatContexts = pgTable('chat_contexts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(), // 'organization' | 'folder' | 'usecase' | 'executive_summary'
  contextId: text('context_id').notNull(), // ID de l'objet modifié
  snapshotBefore: jsonb('snapshot_before'), // État de l'objet avant modification
  snapshotAfter: jsonb('snapshot_after'), // État de l'objet après modification
  modifications: jsonb('modifications'), // Détail des champs modifiés et leurs valeurs
  modifiedAt: timestamp('modified_at', { withTimezone: false }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  sessionIdIdx: index('chat_contexts_session_id_idx').on(table.sessionId),
  contextIdx: index('chat_contexts_context_idx').on(table.contextType, table.contextId),
  contextTypeIdIdx: index('chat_contexts_context_type_id_idx').on(table.contextType, table.contextId),
}));

export const chatStreamEvents = pgTable('chat_stream_events', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => chatMessages.id, { onDelete: 'cascade' }), // nullable pour appels structurés
  streamId: text('stream_id').notNull(), // Identifiant du stream
  eventType: text('event_type').notNull(), // 'content_delta' | 'reasoning_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_result' | 'status' | 'error' | 'done'
  data: jsonb('data').notNull(), // Données de l'événement
  sequence: integer('sequence').notNull(), // Ordre des événements pour ce stream
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  messageIdIdx: index('chat_stream_events_message_id_idx').on(table.messageId),
  streamIdIdx: index('chat_stream_events_stream_id_idx').on(table.streamId),
  sequenceIdx: index('chat_stream_events_sequence_idx').on(table.streamId, table.sequence),
  streamIdSequenceUnique: uniqueIndex('chat_stream_events_stream_id_sequence_unique').on(table.streamId, table.sequence),
  createdAtIdx: index('chat_stream_events_created_at_idx').on(table.createdAt),
}));

export const chatMessageFeedback = pgTable('chat_message_feedback', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  vote: integer('vote').notNull(), // 1 = up, -1 = down
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  messageIdIdx: index('chat_message_feedback_message_id_idx').on(table.messageId),
  userIdIdx: index('chat_message_feedback_user_id_idx').on(table.userId),
  messageUserUnique: uniqueIndex('chat_message_feedback_message_user_unique').on(table.messageId, table.userId),
}));

// Chat tracing (debug/audit): store the exact OpenAI payloads + tool calls per iteration.
// Retention is enforced via periodic purge (7 days by default).
export const chatGenerationTraces = pgTable('chat_generation_traces', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  assistantMessageId: text('assistant_message_id')
    .notNull()
    .references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  phase: text('phase').notNull(), // 'pass1' | 'pass2'
  iteration: integer('iteration').notNull(), // within phase
  model: text('model'),
  toolChoice: text('tool_choice'),
  tools: jsonb('tools'), // array of tool metadata (names etc.)
  openaiMessages: jsonb('openai_messages').notNull(), // exact messages payload sent to OpenAI
  toolCalls: jsonb('tool_calls'), // executed tool calls for this iteration (args + results)
  meta: jsonb('meta'), // sizes, truncation flags, timings
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  sessionIdIdx: index('chat_generation_traces_session_id_idx').on(table.sessionId),
  assistantMessageIdIdx: index('chat_generation_traces_assistant_message_id_idx').on(table.assistantMessageId),
  createdAtIdx: index('chat_generation_traces_created_at_idx').on(table.createdAt),
}));

export const contextModificationHistory = pgTable('context_modification_history', {
  id: text('id').primaryKey(),
  contextType: text('context_type').notNull(), // 'organization' | 'folder' | 'usecase' | 'executive_summary'
  contextId: text('context_id').notNull(), // ID de l'objet modifié
  sessionId: text('session_id').references(() => chatSessions.id, { onDelete: 'set null' }), // nullable si modification non liée à une session
  messageId: text('message_id').references(() => chatMessages.id, { onDelete: 'set null' }), // nullable
  field: text('field').notNull(), // Nom du champ modifié (ex: 'name', 'description', 'data.description')
  oldValue: jsonb('old_value'), // Ancienne valeur
  newValue: jsonb('new_value'), // Nouvelle valeur
  toolCallId: text('tool_call_id'), // ID du tool call si modification via tool
  promptId: text('prompt_id'), // ID du prompt utilisé (obligatoire pour appels structurés, nullable pour sessions informelles)
  promptType: text('prompt_type'), // Type de prompt pour les appels structurés (nullable pour sessions informelles)
  promptVersionId: text('prompt_version_id'), // Version exacte du prompt (obligatoire pour appels structurés, nullable pour sessions informelles)
  jobId: text('job_id').references(() => jobQueue.id, { onDelete: 'set null' }), // Job de génération (appels structurés)
  sequence: integer('sequence').notNull(), // Ordre des modifications pour cet objet
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow()
}, (table) => ({
  contextIdx: index('context_modification_history_context_idx').on(table.contextType, table.contextId),
  sessionIdIdx: index('context_modification_history_session_id_idx').on(table.sessionId),
  sequenceIdx: index('context_modification_history_sequence_idx').on(table.contextType, table.contextId, table.sequence),
}));

// Chatbot Lot B: attach documents to a business context (organization/folder/usecase).
// Storage is external (S3-compatible); DB stores metadata + summary + status.
export const contextDocuments = pgTable('context_documents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id)
    .default(ADMIN_WORKSPACE_ID),
  contextType: text('context_type').notNull(), // 'organization' | 'folder' | 'usecase'
  contextId: text('context_id').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sourceType: text('source_type').notNull().default('local'), // 'local' | 'google_drive' | 'sharepoint' | 'onedrive'
  storageKey: text('storage_key'), // nullable for non-local sources (Decision 5A)
  status: text('status').notNull().default('uploaded'), // 'uploaded' | 'processing' | 'ready' | 'failed'
  // Document metadata / summaries are stored in JSONB to avoid schema churn (like organizations/use_cases)
  // Suggested structure:
  // - summary: string (résumé général)
  // - summaryLang: 'fr' | 'en'
  // - detailedSummary: string (optionnel, ~10k mots)
  // - detailedSummaryLang: 'fr' | 'en'
  // - extracted: { title?: string; pages?: number; words?: number }
  // - prompts: { summaryPromptId?: string; summaryPromptVersionId?: string; detailedPromptId?: string; detailedPromptVersionId?: string }
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  jobId: text('job_id').references(() => jobQueue.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  workspaceIdIdx: index('context_documents_workspace_id_idx').on(table.workspaceId),
  contextIdx: index('context_documents_context_idx').on(table.contextType, table.contextId),
  statusIdx: index('context_documents_status_idx').on(table.status),
  sourceTypeIdx: index('context_documents_source_type_idx').on(table.sourceType),
}));

// Optional: keep history of uploads/summaries per document.
export const contextDocumentVersions = pgTable('context_document_versions', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => contextDocuments.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  documentIdIdx: index('context_document_versions_document_id_idx').on(table.documentId),
  documentVersionUnique: uniqueIndex('context_document_versions_document_id_version_unique').on(table.documentId, table.version),
}));

export type UserRow = typeof users.$inferSelect;
export type WebauthnCredentialRow = typeof webauthnCredentials.$inferSelect;
export type UserSessionRow = typeof userSessions.$inferSelect;
export type WebauthnChallengeRow = typeof webauthnChallenges.$inferSelect;
export type MagicLinkRow = typeof magicLinks.$inferSelect;
export type EmailVerificationCodeRow = typeof emailVerificationCodes.$inferSelect;
export type OauthClientRow = typeof oauthClients.$inferSelect;
export type AuthorizationCodeRow = typeof authorizationCodes.$inferSelect;
export type OauthTokenRow = typeof oauthTokens.$inferSelect;
export type OauthDpopProofRow = typeof oauthDpopProofs.$inferSelect;
export type RevokedTokenRow = typeof revokedTokens.$inferSelect;
export type IdTokenSigningKeyRow = typeof idTokenSigningKeys.$inferSelect;
export type ServiceClientRow = typeof serviceClients.$inferSelect;
export type DocumentConnectorAccountRow = typeof documentConnectorAccounts.$inferSelect;
export type LlmProviderAccountRow = typeof llmProviderAccounts.$inferSelect;
export type LlmAccountLeaseRow = typeof llmAccountLeases.$inferSelect;
export type LlmAccountReservationRow = typeof llmAccountReservations.$inferSelect;
export type LlmAccountQuotaStateRow = typeof llmAccountQuotaState.$inferSelect;
export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ChatContextRow = typeof chatContexts.$inferSelect;
export type ChatStreamEventRow = typeof chatStreamEvents.$inferSelect;
export type ChatGenerationTraceRow = typeof chatGenerationTraces.$inferSelect;
export type ContextModificationHistoryRow = typeof contextModificationHistory.$inferSelect;
export type ContextDocumentRow = typeof contextDocuments.$inferSelect;
export type ContextDocumentVersionRow = typeof contextDocumentVersions.$inferSelect;

// Collaboration tables (Lot 1-5) - Migration will be created at Lot 5
export const workspaceMemberships = pgTable('workspace_memberships', {
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'viewer' | 'commenter' | 'editor' | 'admin'
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  workspaceUserUnique: uniqueIndex('workspace_memberships_workspace_id_user_id_unique').on(table.workspaceId, table.userId),
  workspaceIdIdx: index('workspace_memberships_workspace_id_idx').on(table.workspaceId),
  userIdIdx: index('workspace_memberships_user_id_idx').on(table.userId),
}));

export type WorkspaceMembershipRow = typeof workspaceMemberships.$inferSelect;

// BR-39e: IdP tenancy spine — a `tenant` registry + per-(user,tenant) membership.
// `tenant` models WHICH ORG a human belongs to (distinct from `oauth_clients.tenant_id`,
// which only records which client a token was minted for). The tenant claim (`tid`) is
// derived from a VALIDATED `approved` membership — never a request param.
// See spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md. No `parent_tenant_id` (nested tenants out of v1).
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(), // immutable slug == the `tid` claim (e.g. 'sentropic')
  name: text('name').notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'suspended' | 'offboarded'
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  statusIdx: index('tenants_status_idx').on(table.status),
}));

export type TenantRow = typeof tenants.$inferSelect;

// Per-(user,tenant) membership, mirroring `workspace_memberships`. A human is ONE `users`
// row that can hold several memberships (D0/A: `tenant_id` is NOT on `users`; email stays
// globally unique). Status drives tenant-scoped acceptance (Lot 2).
export const tenantMemberships = pgTable('tenant_memberships', {
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('requested'), // 'invited'|'requested'|'approved'|'rejected'|'suspended'
  role: text('role').notNull().default('member'), // tenant-scoped: 'member' | 'admin'
  approvedByUserId: text('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  requestedAt: timestamp('requested_at', { withTimezone: false }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  tenantUserUnique: uniqueIndex('tenant_memberships_tenant_id_user_id_unique').on(table.tenantId, table.userId),
  tenantIdIdx: index('tenant_memberships_tenant_id_idx').on(table.tenantId),
  userIdIdx: index('tenant_memberships_user_id_idx').on(table.userId),
  statusIdx: index('tenant_memberships_status_idx').on(table.status),
}));

export type TenantMembershipRow = typeof tenantMemberships.$inferSelect;

// Lot 2: Object edition locks (soft locks with TTL, enforced on mutations)
export const objectLocks = pgTable('object_locks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  objectType: text('object_type').notNull(), // 'organization' | 'folder' | 'usecase'
  objectId: text('object_id').notNull(),
  lockedByUserId: text('locked_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  lockedAt: timestamp('locked_at', { withTimezone: false }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  unlockRequestedAt: timestamp('unlock_requested_at', { withTimezone: false }),
  unlockRequestedByUserId: text('unlock_requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  unlockRequestMessage: text('unlock_request_message'),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  objectUnique: uniqueIndex('object_locks_workspace_object_unique').on(table.workspaceId, table.objectType, table.objectId),
  workspaceIdIdx: index('object_locks_workspace_id_idx').on(table.workspaceId),
  expiresAtIdx: index('object_locks_expires_at_idx').on(table.expiresAt),
}));

export type ObjectLockRow = typeof objectLocks.$inferSelect;

// Lot 4: Comments (flat conversations, workspace-scoped)
export const comments = pgTable('comments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(), // 'organization' | 'folder' | 'usecase' | ...
  contextId: text('context_id').notNull(),
  sectionKey: text('section_key'), // optional sub-section key (e.g., 'description', 'matrix.cell.x.y')
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  assignedTo: text('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('open'), // 'open' | 'closed'
  threadId: text('thread_id').notNull(),
  content: text('content').notNull(),
  toolCallId: text('tool_call_id'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('comments_workspace_id_idx').on(table.workspaceId),
  contextIdx: index('comments_context_idx').on(table.contextType, table.contextId),
  threadIdIdx: index('comments_thread_id_idx').on(table.threadId),
  assignedToIdx: index('comments_assigned_to_idx').on(table.assignedTo),
  statusIdx: index('comments_status_idx').on(table.status),
  toolCallIdIdx: index('comments_tool_call_id_idx').on(table.toolCallId),
}));

export type CommentRow = typeof comments.$inferSelect;

// Chrome extension local-tool permissions (per user/workspace/tool/origin).
export const extensionToolPermissions = pgTable('extension_tool_permissions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  origin: text('origin').notNull(),
  policy: text('policy').notNull().default('allow'), // 'allow' | 'deny'
  updatedAt: timestamp('updated_at', { withTimezone: false }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  userWorkspaceIdx: index('extension_tool_permissions_user_workspace_idx').on(table.userId, table.workspaceId),
  toolOriginIdx: index('extension_tool_permissions_tool_origin_idx').on(table.toolName, table.origin),
  userWorkspaceToolOriginUnique: uniqueIndex(
    'extension_tool_permissions_user_workspace_tool_origin_unique',
  ).on(table.userId, table.workspaceId, table.toolName, table.origin),
}));

// BR-03: TODO + steering + workflow core runtime entities
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('plans_workspace_id_idx').on(table.workspaceId),
}));

export const todos = pgTable('todos', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  planId: text('plan_id').references(() => plans.id, { onDelete: 'cascade' }),
  parentTodoId: text('parent_todo_id'),
  title: text('title').notNull(),
  description: text('description'),
  position: integer('position').notNull().default(0),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  closedAt: timestamp('closed_at', { withTimezone: false }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  parentTodoIdFk: foreignKey({
    columns: [table.parentTodoId],
    foreignColumns: [table.id],
    name: 'todos_parent_todo_id_todos_id_fk',
  }),
  workspaceIdIdx: index('todos_workspace_id_idx').on(table.workspaceId),
  planIdIdx: index('todos_plan_id_idx').on(table.planId),
  parentTodoIdIdx: index('todos_parent_todo_id_idx').on(table.parentTodoId),
  ownerUserIdIdx: index('todos_owner_user_id_idx').on(table.ownerUserId),
}));

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  todoId: text('todo_id')
    .notNull()
    .references(() => todos.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  position: integer('position').notNull().default(0),
  status: text('status').notNull().default('todo'),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  assigneeUserId: text('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: false }),
  completedAt: timestamp('completed_at', { withTimezone: false }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('tasks_workspace_id_idx').on(table.workspaceId),
  todoIdIdx: index('tasks_todo_id_idx').on(table.todoId),
  statusIdx: index('tasks_status_idx').on(table.status),
  assigneeUserIdIdx: index('tasks_assignee_user_id_idx').on(table.assigneeUserId),
}));

export const todoDependencies = pgTable('todo_dependencies', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  todoId: text('todo_id')
    .notNull()
    .references(() => todos.id, { onDelete: 'cascade' }),
  dependsOnTodoId: text('depends_on_todo_id')
    .notNull()
    .references(() => todos.id, { onDelete: 'cascade' }),
  dependencyType: text('dependency_type').notNull().default('blocks'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  dependencyUnique: uniqueIndex('todo_dependencies_unique_idx').on(table.todoId, table.dependsOnTodoId),
  workspaceIdIdx: index('todo_dependencies_workspace_id_idx').on(table.workspaceId),
}));

export const taskDependencies = pgTable('task_dependencies', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  dependsOnTaskId: text('depends_on_task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  dependencyType: text('dependency_type').notNull().default('blocks'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  dependencyUnique: uniqueIndex('task_dependencies_unique_idx').on(table.taskId, table.dependsOnTaskId),
  workspaceIdIdx: index('task_dependencies_workspace_id_idx').on(table.workspaceId),
}));


export const agentDefinitions = pgTable('agent_definitions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  sourceLevel: text('source_level').notNull().default('code'),
  lineageRootId: text('lineage_root_id'),
  parentId: text('parent_id'),
  isDetached: boolean('is_detached').notNull().default(false),
  lastParentSyncAt: timestamp('last_parent_sync_at', { withTimezone: false }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  parentIdFk: foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: 'agent_definitions_parent_id_agent_definitions_id_fk',
  }),
  workspaceKeyUnique: uniqueIndex('agent_definitions_workspace_key_unique').on(table.workspaceId, table.key),
  workspaceIdIdx: index('agent_definitions_workspace_id_idx').on(table.workspaceId),
  parentIdIdx: index('agent_definitions_parent_id_idx').on(table.parentId),
}));

export const workflowDefinitions = pgTable('workflow_definitions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  sourceLevel: text('source_level').notNull().default('code'),
  lineageRootId: text('lineage_root_id'),
  parentId: text('parent_id'),
  isDetached: boolean('is_detached').notNull().default(false),
  lastParentSyncAt: timestamp('last_parent_sync_at', { withTimezone: false }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  parentIdFk: foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: 'workflow_definitions_parent_id_workflow_definitions_id_fk',
  }),
  workspaceKeyUnique: uniqueIndex('workflow_definitions_workspace_key_unique').on(table.workspaceId, table.key),
  workspaceIdIdx: index('workflow_definitions_workspace_id_idx').on(table.workspaceId),
  parentIdIdx: index('workflow_definitions_parent_id_idx').on(table.parentId),
}));

export const workflowDefinitionTasks = pgTable('workflow_definition_tasks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  workflowDefinitionId: text('workflow_definition_id')
    .notNull()
    .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  taskKey: text('task_key').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  orderIndex: integer('order_index').notNull().default(0),
  agentDefinitionId: text('agent_definition_id').references(() => agentDefinitions.id, { onDelete: 'set null' }),
  schemaFormat: text('schema_format').notNull().default('json_schema'),
  inputSchema: jsonb('input_schema').notNull().default(sql`'{}'::jsonb`),
  outputSchema: jsonb('output_schema').notNull().default(sql`'{}'::jsonb`),
  sectionKey: text('section_key'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workflowTaskKeyUnique: uniqueIndex('workflow_definition_tasks_unique_key').on(table.workflowDefinitionId, table.taskKey),
  orderIdx: index('workflow_definition_tasks_order_idx').on(table.workflowDefinitionId, table.orderIndex),
  workspaceIdIdx: index('workflow_definition_tasks_workspace_id_idx').on(table.workspaceId),
}));

export const workflowTaskTransitions = pgTable('workflow_task_transitions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  workflowDefinitionId: text('workflow_definition_id')
    .notNull()
    .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  fromTaskKey: text('from_task_key'),
  toTaskKey: text('to_task_key'),
  transitionType: text('transition_type').notNull().default('normal'),
  condition: jsonb('condition').notNull().default(sql`'{}'::jsonb`),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workflowIdIdx: index('workflow_task_transitions_workflow_definition_id_idx').on(table.workflowDefinitionId),
  workspaceIdIdx: index('workflow_task_transitions_workspace_id_idx').on(table.workspaceId),
  fromTaskKeyIdx: index('workflow_task_transitions_from_task_key_idx').on(table.workflowDefinitionId, table.fromTaskKey),
  toTaskKeyIdx: index('workflow_task_transitions_to_task_key_idx').on(table.workflowDefinitionId, table.toTaskKey),
}));

export const guardrails = pgTable('guardrails', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  category: text('category').notNull(),
  title: text('title'),
  instruction: text('instruction').notNull(),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('guardrails_workspace_id_idx').on(table.workspaceId),
  entityIdx: index('guardrails_entity_idx').on(table.entityType, table.entityId),
}));

export const entityLinks = pgTable('entity_links', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceEntityType: text('source_entity_type').notNull(),
  sourceEntityId: text('source_entity_id').notNull(),
  targetObjectType: text('target_object_type').notNull(),
  targetObjectId: text('target_object_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  entityLinkUnique: uniqueIndex('entity_links_unique_idx').on(
    table.workspaceId,
    table.sourceEntityType,
    table.sourceEntityId,
    table.targetObjectType,
    table.targetObjectId,
  ),
  sourceEntityIdx: index('entity_links_source_entity_idx').on(table.sourceEntityType, table.sourceEntityId),
  targetObjectIdx: index('entity_links_target_object_idx').on(table.targetObjectType, table.targetObjectId),
}));

export const executionRuns = pgTable('execution_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  planId: text('plan_id').references(() => plans.id, { onDelete: 'set null' }),
  todoId: text('todo_id').references(() => todos.id, { onDelete: 'set null' }),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  workflowDefinitionId: text('workflow_definition_id').references(() => workflowDefinitions.id, { onDelete: 'set null' }),
  agentDefinitionId: text('agent_definition_id').references(() => agentDefinitions.id, { onDelete: 'set null' }),
  mode: text('mode').notNull().default('manual'),
  status: text('status').notNull().default('pending'),
  startedByUserId: text('started_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: false }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: false }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('execution_runs_workspace_id_idx').on(table.workspaceId),
  statusIdx: index('execution_runs_status_idx').on(table.status),
  taskIdIdx: index('execution_runs_task_id_idx').on(table.taskId),
}));

export const executionEvents = pgTable('execution_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  runId: text('run_id')
    .notNull()
    .references(() => executionRuns.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type'),
  actorId: text('actor_id'),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  sequence: integer('sequence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  runIdSequenceUnique: uniqueIndex('execution_events_run_id_sequence_unique').on(table.runId, table.sequence),
  workspaceIdIdx: index('execution_events_workspace_id_idx').on(table.workspaceId),
  runIdIdx: index('execution_events_run_id_idx').on(table.runId),
  eventTypeIdx: index('execution_events_event_type_idx').on(table.eventType),
}));

export const workflowRunState = pgTable('workflow_run_state', {
  runId: text('run_id')
    .notNull()
    .references(() => executionRuns.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  workflowDefinitionId: text('workflow_definition_id').references(() => workflowDefinitions.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  state: jsonb('state').notNull().default(sql`'{}'::jsonb`),
  version: integer('version').notNull().default(1),
  currentTaskKey: text('current_task_key'),
  currentTaskInstanceKey: text('current_task_instance_key'),
  checkpointedAt: timestamp('checkpointed_at', { withTimezone: false }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  runIdPk: primaryKey({ columns: [table.runId], name: 'workflow_run_state_run_id_pk' }),
  workspaceIdIdx: index('workflow_run_state_workspace_id_idx').on(table.workspaceId),
  statusIdx: index('workflow_run_state_status_idx').on(table.status),
  workflowDefinitionIdIdx: index('workflow_run_state_workflow_definition_id_idx').on(table.workflowDefinitionId),
}));

export const workflowTaskResults = pgTable('workflow_task_results', {
  runId: text('run_id')
    .notNull()
    .references(() => executionRuns.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  workflowDefinitionId: text('workflow_definition_id').references(() => workflowDefinitions.id, { onDelete: 'set null' }),
  taskKey: text('task_key').notNull(),
  taskInstanceKey: text('task_instance_key').notNull().default('main'),
  status: text('status').notNull().default('pending'),
  inputPayload: jsonb('input_payload').notNull().default(sql`'{}'::jsonb`),
  output: jsonb('output').notNull().default(sql`'{}'::jsonb`),
  statePatch: jsonb('state_patch').notNull().default(sql`'{}'::jsonb`),
  attempts: integer('attempts').notNull().default(0),
  lastError: jsonb('last_error'),
  startedAt: timestamp('started_at', { withTimezone: false }),
  completedAt: timestamp('completed_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  taskResultPk: primaryKey({
    columns: [table.runId, table.taskKey, table.taskInstanceKey],
    name: 'workflow_task_results_pk',
  }),
  workspaceIdIdx: index('workflow_task_results_workspace_id_idx').on(table.workspaceId),
  workflowDefinitionIdIdx: index('workflow_task_results_workflow_definition_id_idx').on(table.workflowDefinitionId),
  statusIdx: index('workflow_task_results_status_idx').on(table.status),
  taskKeyIdx: index('workflow_task_results_task_key_idx').on(table.taskKey),
}));

// BR-04: Extended business objects

export const solutions = pgTable('solutions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  initiativeId: text('initiative_id')
    .notNull()
    .references(() => initiatives.id),
  status: text('status').notNull().default('draft'), // 'draft' | 'validated' | 'archived'
  version: integer('version').notNull().default(1),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('solutions_workspace_id_idx').on(table.workspaceId),
  initiativeIdIdx: index('solutions_initiative_id_idx').on(table.initiativeId),
  statusIdx: index('solutions_status_idx').on(table.status),
}));

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  initiativeId: text('initiative_id')
    .notNull()
    .references(() => initiatives.id),
  solutionId: text('solution_id')
    .references(() => solutions.id), // nullable: product may exist without solution
  status: text('status').notNull().default('draft'), // 'draft' | 'active' | 'delivered' | 'archived'
  version: integer('version').notNull().default(1),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('products_workspace_id_idx').on(table.workspaceId),
  initiativeIdIdx: index('products_initiative_id_idx').on(table.initiativeId),
  solutionIdIdx: index('products_solution_id_idx').on(table.solutionId),
  statusIdx: index('products_status_idx').on(table.status),
}));

export const bids = pgTable('bids', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  initiativeId: text('initiative_id')
    .notNull()
    .references(() => initiatives.id),
  status: text('status').notNull().default('draft'), // 'draft' | 'review' | 'finalized' | 'contract'
  version: integer('version').notNull().default(1),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`), // clauses, profils, pricing
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('bids_workspace_id_idx').on(table.workspaceId),
  initiativeIdIdx: index('bids_initiative_id_idx').on(table.initiativeId),
  statusIdx: index('bids_status_idx').on(table.status),
}));

export const bidProducts = pgTable('bid_products', {
  id: text('id').primaryKey(),
  bidId: text('bid_id')
    .notNull()
    .references(() => bids.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`), // unit price, conditions per product in this bid
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  bidProductUnique: uniqueIndex('bid_products_bid_product_unique').on(table.bidId, table.productId),
  bidIdIdx: index('bid_products_bid_id_idx').on(table.bidId),
  productIdIdx: index('bid_products_product_id_idx').on(table.productId),
}));

export const workspaceTypeWorkflows = pgTable('workspace_type_workflows', {
  id: text('id').primaryKey(),
  workspaceType: text('workspace_type').notNull(), // 'ai-priorities' | 'opportunity' | 'code'
  workflowDefinitionId: text('workflow_definition_id')
    .notNull()
    .references(() => workflowDefinitions.id),
  isDefault: boolean('is_default').notNull().default(false),
  triggerStage: text('trigger_stage'), // maturity stage that triggers this workflow (nullable)
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`), // type-specific workflow config overrides
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  typeWorkflowUnique: uniqueIndex('workspace_type_workflows_type_workflow_unique').on(table.workspaceType, table.workflowDefinitionId),
  workspaceTypeIdx: index('workspace_type_workflows_workspace_type_idx').on(table.workspaceType),
  workflowDefinitionIdIdx: index('workspace_type_workflows_workflow_definition_id_idx').on(table.workflowDefinitionId),
}));

export const viewTemplates = pgTable('view_templates', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id), // nullable for system seeds
  workspaceType: text('workspace_type').notNull(),
  objectType: text('object_type').notNull(), // 'initiative' | 'solution' | 'product' | 'bid' | 'organization' | 'dashboard'
  maturityStage: text('maturity_stage'), // nullable
  descriptor: jsonb('descriptor').notNull().default(sql`'{}'::jsonb`), // view template DSL
  version: integer('version').notNull().default(1),
  sourceLevel: text('source_level').notNull().default('code'), // 'code' | 'admin' | 'user'
  parentId: text('parent_id'), // fork/detach lineage
  isDetached: boolean('is_detached').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow(),
}, (table) => ({
  parentIdFk: foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: 'view_templates_parent_id_fk',
  }),
  workspaceIdIdx: index('view_templates_workspace_id_idx').on(table.workspaceId),
  workspaceTypeIdx: index('view_templates_workspace_type_idx').on(table.workspaceType),
  objectTypeIdx: index('view_templates_object_type_idx').on(table.objectType),
  parentIdIdx: index('view_templates_parent_id_idx').on(table.parentId),
}));

export type SolutionRow = typeof solutions.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type BidRow = typeof bids.$inferSelect;
export type BidProductRow = typeof bidProducts.$inferSelect;
/** @alias BidRow — renamed terminology */
export type ProposalRow = BidRow;
/** @alias BidProductRow — renamed terminology */
export type ProposalProductRow = BidProductRow;
export type WorkspaceTypeWorkflowRow = typeof workspaceTypeWorkflows.$inferSelect;
export type ViewTemplateRow = typeof viewTemplates.$inferSelect;

export type ExtensionToolPermissionRow = typeof extensionToolPermissions.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type TodoRow = typeof todos.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TodoDependencyRow = typeof todoDependencies.$inferSelect;
export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type GuardrailRow = typeof guardrails.$inferSelect;
export type WorkflowDefinitionRow = typeof workflowDefinitions.$inferSelect;
export type WorkflowDefinitionTaskRow = typeof workflowDefinitionTasks.$inferSelect;
export type WorkflowTaskTransitionRow = typeof workflowTaskTransitions.$inferSelect;
export type AgentDefinitionRow = typeof agentDefinitions.$inferSelect;
export type EntityLinkRow = typeof entityLinks.$inferSelect;
export type ExecutionRunRow = typeof executionRuns.$inferSelect;
export type ExecutionEventRow = typeof executionEvents.$inferSelect;
export type WorkflowRunStateRow = typeof workflowRunState.$inferSelect;
export type WorkflowTaskResultRow = typeof workflowTaskResults.$inferSelect;
