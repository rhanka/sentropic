// Identity core storage (lot A2.1): one logical schema, two profiles (spec r2
// §2.9). The hosted PostgreSQL control schema and the local SQLite schema set
// carry the same tables through the existing storage kernel seams — the
// `InjectedPgDriver` protocol and the `node:sqlite` engine — so no new
// connection mechanism or dependency enters the package. Timestamps stay
// ISO-8601 text in both dialects because the frozen record types define them
// as strings; ids are opaque cluster-mesh-owned values, never auto-generated.

export type IdentitySchemaDialect = 'postgres' | 'sqlite';

/** Every table this slice owns; writes live only in this module. */
export const IDENTITY_TABLES = [
  'identity_user_accounts',
  'identity_proofs',
  'identity_invitations',
  'identity_device_codes',
  'identity_login_sessions',
  'identity_audit_events',
  // A2.0b custody extension bundle (1.1.0) and atomic deletion contract (2.0.0).
  'identity_account_profiles',
  'identity_webauthn_credentials',
  'identity_single_use_proofs',
  'identity_email_registration_tickets',
  'identity_invitation_digests',
  'identity_login_token_bindings',
  'identity_social_links',
  'identity_subject_fences',
  'identity_deletion_operations',
  'identity_deletion_attempts',
  'identity_revocation_outbox',
  'identity_import_receipts',
  'identity_custody_schema_versions',
  'connector_revocation_custody',
  'identity_legacy_connector_tombstones',
] as const;

export type IdentityTableName = (typeof IDENTITY_TABLES)[number];

/** Qualified table reference: `"schema"."table"` on PostgreSQL, plain on SQLite. */
export const identityTable = (dialect: IdentitySchemaDialect, schema: string | null, table: IdentityTableName): string =>
  dialect === 'postgres' ? `"${schema}"."${table}"` : `"${table}"`;

interface ColumnDefinition {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly unique?: boolean;
  readonly primaryKey?: boolean;
  readonly check?: string;
  readonly references?: string;
}

interface TableDefinition {
  readonly table: IdentityTableName;
  readonly columns: readonly ColumnDefinition[];
  /** Auto-increment ordinal column name when the table uses one. */
  readonly autoIncrement?: string;
  /** Composite primary key columns when the key spans more than one column. */
  readonly compositePrimaryKey?: readonly string[];
}

const TABLES: readonly TableDefinition[] = [
  {
    table: 'identity_user_accounts',
    columns: [
      { name: 'user_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false, unique: true },
      { name: 'account_status', type: 'text', nullable: false },
      { name: 'global_role', type: 'text', nullable: false },
      { name: 'created_at', type: 'text', nullable: false },
      { name: 'updated_at', type: 'text', nullable: false },
    ],
  },
  {
    table: 'identity_proofs',
    columns: [
      { name: 'proof_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'user_id', type: 'text', nullable: false },
      { name: 'kind', type: 'text', nullable: false },
      { name: 'provider', type: 'text', nullable: true },
      { name: 'expires_at', type: 'text', nullable: true },
      { name: 'consumed_at', type: 'text', nullable: true },
      { name: 'revoked_at', type: 'text', nullable: true },
      { name: 'created_at', type: 'text', nullable: false },
    ],
  },
  {
    table: 'identity_invitations',
    columns: [
      { name: 'invitation_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false },
      { name: 'tenant_id', type: 'text', nullable: true },
      { name: 'workspace_id', type: 'text', nullable: true },
      { name: 'token', type: 'text', nullable: false, unique: true },
      { name: 'status', type: 'text', nullable: false },
      { name: 'expires_at', type: 'text', nullable: false },
      { name: 'consumed_at', type: 'text', nullable: true },
    ],
  },
  {
    table: 'identity_device_codes',
    columns: [
      { name: 'device_code', type: 'text', nullable: false, primaryKey: true },
      { name: 'user_code', type: 'text', nullable: false, unique: true },
      { name: 'device_name', type: 'text', nullable: true },
      { name: 'status', type: 'text', nullable: false },
      { name: 'approved_user_id', type: 'text', nullable: true },
      { name: 'approved_at', type: 'text', nullable: true },
      { name: 'issued_at', type: 'text', nullable: false },
      { name: 'expires_at', type: 'text', nullable: false },
    ],
  },
  {
    table: 'identity_login_sessions',
    columns: [
      { name: 'session_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'user_id', type: 'text', nullable: false },
      { name: 'status', type: 'text', nullable: false },
      { name: 'mfa_state', type: 'text', nullable: false },
      { name: 'created_at', type: 'text', nullable: false },
      { name: 'expires_at', type: 'text', nullable: false },
      { name: 'revoked_at', type: 'text', nullable: true },
      { name: 'refresh_count', type: 'integer', nullable: false },
    ],
  },
  {
    table: 'identity_audit_events',
    autoIncrement: 'ordinal',
    columns: [
      { name: 'at', type: 'text', nullable: false },
      { name: 'kind', type: 'text', nullable: false },
      { name: 'actor_id', type: 'text', nullable: true },
      { name: 'subject_id', type: 'text', nullable: true },
      { name: 'detail', type: 'text', nullable: true },
    ],
  },
  {
    table: 'identity_account_profiles',
    columns: [
      { name: 'user_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'email_verified', type: 'integer', nullable: false, check: '"email_verified" IN (0,1)' },
      { name: 'display_name', type: 'text', nullable: true },
      { name: 'approval_due_at', type: 'text', nullable: true },
      { name: 'approved_at', type: 'text', nullable: true },
      { name: 'approved_by_user_id', type: 'text', nullable: true },
      { name: 'disabled_at', type: 'text', nullable: true },
      { name: 'disabled_reason', type: 'text', nullable: true },
      { name: 'legacy_account_status', type: 'text', nullable: true },
    ],
  },
  {
    table: 'identity_webauthn_credentials',
    columns: [
      { name: 'proof_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'user_id', type: 'text', nullable: false },
      { name: 'credential_id', type: 'text', nullable: false, unique: true },
      { name: 'public_key_cose', type: 'text', nullable: false },
      { name: 'counter', type: 'bigint', nullable: false, check: '"counter" BETWEEN 0 AND 4294967295' },
      { name: 'revision', type: 'bigint', nullable: false, check: '"revision" BETWEEN 0 AND 9007199254740991' },
      { name: 'rp_id', type: 'text', nullable: false },
      { name: 'device_name', type: 'text', nullable: true },
      { name: 'transports_json', type: 'text', nullable: true },
      { name: 'uv', type: 'integer', nullable: false, check: '"uv" IN (0,1)' },
      { name: 'device_type', type: 'text', nullable: true },
      { name: 'backed_up', type: 'integer', nullable: true, check: '"backed_up" IN (0,1)' },
      { name: 'created_at', type: 'text', nullable: false },
      { name: 'last_used_at', type: 'text', nullable: true },
      { name: 'revoked_at', type: 'text', nullable: true },
    ],
  },
  {
    table: 'identity_single_use_proofs',
    compositePrimaryKey: ['kind', 'proof_id'],
    columns: [
      { name: 'kind', type: 'text', nullable: false, check: `"kind" IN ('webauthn_challenge','email_code','magic_link')` },
      { name: 'proof_id', type: 'text', nullable: false },
      { name: 'user_id', type: 'text', nullable: true },
      { name: 'state', type: 'text', nullable: false, check: `"state" IN ('pending','consumed','revoked')` },
      { name: 'revision', type: 'bigint', nullable: false, check: '"revision" BETWEEN 0 AND 9007199254740991' },
      { name: 'created_at', type: 'text', nullable: false },
      { name: 'expires_at', type: 'text', nullable: false },
      { name: 'consumed_at', type: 'text', nullable: true },
      { name: 'revoked_at', type: 'text', nullable: true },
      { name: 'challenge', type: 'text', nullable: true },
      { name: 'challenge_purpose', type: 'text', nullable: true },
      { name: 'rp_id', type: 'text', nullable: true },
      { name: 'allowed_origins_json', type: 'text', nullable: true },
      { name: 'user_verification', type: 'text', nullable: true },
      { name: 'email', type: 'text', nullable: true },
      { name: 'secret_digest', type: 'text', nullable: true },
      { name: 'digest_algorithm', type: 'text', nullable: true },
      { name: 'digest_key_ref', type: 'text', nullable: true },
    ],
  },
  {
    table: 'identity_email_registration_tickets',
    columns: [
      { name: 'code_kind', type: 'text', nullable: false, check: `"code_kind" = 'email_code'` },
      { name: 'code_proof_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false },
      { name: 'token_hash', type: 'text', nullable: false, unique: true },
      { name: 'user_id', type: 'text', nullable: true },
      { name: 'state', type: 'text', nullable: false, check: `"state" IN ('pending','consumed','revoked')` },
      { name: 'revision', type: 'bigint', nullable: false, check: '"revision" BETWEEN 0 AND 9007199254740991' },
      { name: 'created_at', type: 'text', nullable: false },
      { name: 'expires_at', type: 'text', nullable: false },
      { name: 'consumed_at', type: 'text', nullable: true },
      { name: 'revoked_at', type: 'text', nullable: true },
    ],
  },
  {
    table: 'identity_invitation_digests',
    columns: [
      { name: 'invitation_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false },
      { name: 'tenant_id', type: 'text', nullable: true },
      { name: 'workspace_id', type: 'text', nullable: true },
      { name: 'client_id', type: 'text', nullable: true },
      { name: 'token_hash', type: 'text', nullable: false, unique: true },
      { name: 'status', type: 'text', nullable: false, check: `"status" IN ('pending','consumed','revoked')` },
      { name: 'expires_at', type: 'text', nullable: false },
      { name: 'created_at', type: 'text', nullable: true },
      { name: 'consumed_at', type: 'text', nullable: true },
      { name: 'consumed_by_user_id', type: 'text', nullable: true },
      { name: 'revision', type: 'bigint', nullable: false, check: '"revision" BETWEEN 0 AND 9007199254740991' },
    ],
  },
  {
    table: 'identity_login_token_bindings',
    columns: [
      { name: 'session_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'session_token_hash', type: 'text', nullable: false, unique: true },
      { name: 'refresh_token_hash', type: 'text', nullable: true, unique: true },
      { name: 'mfa_verified', type: 'integer', nullable: false, check: '"mfa_verified" IN (0,1)' },
      { name: 'auth_time', type: 'bigint', nullable: false, check: '"auth_time" BETWEEN 0 AND 9007199254740991' },
      { name: 'session_version', type: 'bigint', nullable: false, check: '"session_version" BETWEEN 0 AND 9007199254740991' },
      { name: 'rotation_version', type: 'bigint', nullable: false, check: '"rotation_version" BETWEEN 0 AND 9007199254740991' },
      { name: 'device_name', type: 'text', nullable: true },
      { name: 'ip_address', type: 'text', nullable: true },
      { name: 'user_agent', type: 'text', nullable: true },
      { name: 'last_activity_at', type: 'text', nullable: true },
    ],
  },
  {
    table: 'identity_social_links',
    columns: [
      { name: 'proof_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'user_id', type: 'text', nullable: false },
      { name: 'provider', type: 'text', nullable: false },
      { name: 'provider_subject', type: 'text', nullable: false },
      { name: 'provider_tenant', type: 'text', nullable: true },
      { name: 'email_at_link', type: 'text', nullable: true },
      { name: 'email_verified_by_provider', type: 'integer', nullable: false, check: '"email_verified_by_provider" IN (0,1)' },
      { name: 'linked_at', type: 'text', nullable: false },
      { name: 'last_login_at', type: 'text', nullable: true },
      { name: 'revoked_at', type: 'text', nullable: true },
      { name: 'revision', type: 'bigint', nullable: false, check: '"revision" BETWEEN 0 AND 9007199254740991' },
    ],
  },
  {
    table: 'identity_subject_fences',
    columns: [
      { name: 'user_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'revision', type: 'bigint', nullable: false, check: '"revision" BETWEEN 0 AND 9007199254740991' },
      { name: 'updated_at', type: 'text', nullable: false },
      { name: 'retired_at', type: 'text', nullable: true },
    ],
  },
  {
    table: 'identity_deletion_operations',
    columns: [
      { name: 'operation_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'user_id', type: 'text', nullable: false },
      { name: 'actor_id', type: 'text', nullable: false },
      { name: 'handler_id', type: 'text', nullable: false, check: `"handler_id" IN ('self_account','admin_account')` },
      { name: 'request_digest', type: 'text', nullable: false },
      { name: 'state', type: 'text', nullable: false, check: `"state" IN ('queued','committed')` },
      { name: 'created_at', type: 'text', nullable: false },
      { name: 'committed_at', type: 'text', nullable: true },
      { name: 'committed_receipt_json', type: 'text', nullable: true },
    ],
  },
  {
    table: 'identity_deletion_attempts',
    columns: [
      { name: 'attempt_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'operation_id', type: 'text', nullable: false },
      { name: 'at', type: 'text', nullable: false },
      { name: 'receipt_json', type: 'text', nullable: false },
    ],
  },
  {
    table: 'identity_revocation_outbox',
    columns: [
      { name: 'delivery_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'operation_id', type: 'text', nullable: false },
      { name: 'step', type: 'text', nullable: false },
      { name: 'subject_id', type: 'text', nullable: false },
      { name: 'target_kind', type: 'text', nullable: false },
      { name: 'target_ref', type: 'text', nullable: false },
      { name: 'state', type: 'text', nullable: false, check: `"state" IN ('pending','delivered')` },
      { name: 'created_at', type: 'text', nullable: false },
      { name: 'next_attempt_at', type: 'text', nullable: false },
      { name: 'custody_ref', type: 'text', nullable: true },
      { name: 'delivered_at', type: 'text', nullable: true },
      { name: 'claim_owner', type: 'text', nullable: true },
      { name: 'lease_until', type: 'text', nullable: true },
      { name: 'claim_version', type: 'bigint', nullable: false, check: '"claim_version" BETWEEN 0 AND 9007199254740991' },
      { name: 'attempt_count', type: 'bigint', nullable: false, check: '"attempt_count" BETWEEN 0 AND 9007199254740991' },
    ],
  },
  {
    table: 'identity_import_receipts',
    columns: [
      { name: 'migration_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'source_snapshot_ref', type: 'text', nullable: false },
      { name: 'source_snapshot_digest', type: 'text', nullable: false },
      { name: 'manifest_digest', type: 'text', nullable: false },
      { name: 'contract_version', type: 'text', nullable: false },
      { name: 'imported_at', type: 'text', nullable: false },
      { name: 'receipt_json', type: 'text', nullable: false },
    ],
  },
  {
    table: 'identity_custody_schema_versions',
    columns: [
      { name: 'migration_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'contract_version', type: 'text', nullable: false },
      { name: 'asset_sha256', type: 'text', nullable: false },
      { name: 'applied_at', type: 'text', nullable: false },
    ],
  },
  {
    table: 'connector_revocation_custody',
    columns: [
      { name: 'custody_ref', type: 'text', nullable: false, primaryKey: true },
      { name: 'delivery_id', type: 'text', nullable: false, unique: true },
      { name: 'connector_account_id', type: 'text', nullable: false },
      { name: 'provider', type: 'text', nullable: false },
      { name: 'envelope_version', type: 'text', nullable: false, check: `"envelope_version" = '1'` },
      { name: 'key_ref', type: 'text', nullable: false },
      { name: 'nonce', type: 'text', nullable: false },
      { name: 'ciphertext', type: 'text', nullable: false },
      { name: 'auth_tag', type: 'text', nullable: false },
      { name: 'created_at', type: 'text', nullable: false },
    ],
  },
  {
    table: 'identity_legacy_connector_tombstones',
    columns: [
      { name: 'source_event_id', type: 'text', nullable: false, primaryKey: true },
      { name: 'connector_account_id', type: 'text', nullable: false },
      { name: 'provider', type: 'text', nullable: false },
      { name: 'subject_id', type: 'text', nullable: true },
      { name: 'disposition', type: 'text', nullable: false, check: `"disposition" IN ('queued','unresolved','acknowledged')` },
      { name: 'delivery_id', type: 'text', nullable: true, unique: true },
      { name: 'evidence_ref', type: 'text', nullable: true },
      { name: 'imported_at', type: 'text', nullable: false },
    ],
  },
];

const columnSql = (definition: ColumnDefinition, dialect: IdentitySchemaDialect, autoIncrement: boolean): string => {
  const parts = [`"${definition.name}"`];
  if (definition.primaryKey && autoIncrement) {
    parts.push(dialect === 'postgres' ? 'bigint GENERATED ALWAYS AS IDENTITY' : 'integer');
  } else {
    parts.push(dialect === 'postgres' && definition.type === 'bigint' ? 'bigint' : definition.type === 'bigint' ? 'INTEGER' : definition.type);
  }
  if (definition.primaryKey) parts.push('PRIMARY KEY');
  if (definition.unique) parts.push('UNIQUE');
  if (!definition.nullable && !definition.primaryKey) parts.push('NOT NULL');
  if (definition.references) parts.push(`REFERENCES ${definition.references}`);
  if (definition.check) parts.push(`CHECK (${definition.check})`);
  return parts.join(' ');
};

/**
 * Idempotent DDL for the A2.1 slice. `schema` names the PostgreSQL control
 * schema; it is ignored on SQLite where tables live in the store file's
 * single schema (local profile, spec r2 §2.9).
 */
export const identitySchemaStatements = (dialect: IdentitySchemaDialect, schema: string): readonly string[] => {
  const qualified = (table: IdentityTableName): string =>
    identityTable(dialect, dialect === 'postgres' ? schema : null, table);
  const tables = TABLES.map((definition) => {
    const columns = definition.columns
      .map((column) => columnSql(column, dialect, column.name === definition.autoIncrement))
      .join(', ');
    const composite = definition.compositePrimaryKey
      ? `, PRIMARY KEY (${definition.compositePrimaryKey.map((name) => `"${name}"`).join(', ')})`
      : '';
    return `CREATE TABLE IF NOT EXISTS ${qualified(definition.table)} (${columns}${composite})`;
  });
  const index = (name: string, table: IdentityTableName, columns: string, unique: boolean, where?: string): string => {
    const indexName = dialect === 'postgres' && schema ? `"${schema}"."${name}"` : `"${name}"`;
    return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${indexName} ON ${qualified(table)} (${columns})${where ? ` WHERE ${where}` : ''}`;
  };
  // A2.0b lookup/disposal indexes; all idempotent.
  const indexes = [
    index('identity_single_use_proofs_email_code_lookup', 'identity_single_use_proofs', '"kind", "email", "digest_algorithm", "digest_key_ref", "secret_digest", "created_at", "proof_id"', false),
    index('identity_single_use_proofs_challenge_lookup', 'identity_single_use_proofs', '"challenge"', true, '"challenge" IS NOT NULL'),
    index('identity_single_use_proofs_magic_lookup', 'identity_single_use_proofs', '"secret_digest"', true, `"kind" = 'magic_link'`),
    index('identity_webauthn_credentials_user', 'identity_webauthn_credentials', '"user_id"', false),
    index('identity_single_use_proofs_user', 'identity_single_use_proofs', '"user_id"', false, '"user_id" IS NOT NULL'),
    index('identity_login_token_bindings_session', 'identity_login_token_bindings', '"session_token_hash"', false),
    index('identity_social_links_user', 'identity_social_links', '"user_id"', false),
    index('identity_social_links_subject', 'identity_social_links', '"provider", "provider_subject"', true),
    index('identity_invitation_digests_email', 'identity_invitation_digests', '"email"', false),
    index('identity_deletion_attempts_operation', 'identity_deletion_attempts', '"operation_id", "at", "attempt_id"', false),
    index('identity_revocation_outbox_operation', 'identity_revocation_outbox', '"operation_id"', false),
    index('identity_revocation_outbox_pending', 'identity_revocation_outbox', '"state", "next_attempt_at", "created_at", "delivery_id"', false),
    index('identity_revocation_outbox_tuple', 'identity_revocation_outbox', '"operation_id", "step", "target_kind", "target_ref"', true),
  ];
  return [...tables, ...indexes];
};
