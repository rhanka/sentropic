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
}

interface TableDefinition {
  readonly table: IdentityTableName;
  readonly columns: readonly ColumnDefinition[];
  /** Auto-increment ordinal column name when the table uses one. */
  readonly autoIncrement?: string;
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
];

const columnSql = (definition: ColumnDefinition, dialect: IdentitySchemaDialect, autoIncrement: boolean): string => {
  const parts = [`"${definition.name}"`];
  if (definition.primaryKey && autoIncrement) {
    parts.push(dialect === 'postgres' ? 'bigint GENERATED ALWAYS AS IDENTITY' : 'integer');
  } else {
    parts.push(definition.type);
  }
  if (definition.primaryKey) parts.push('PRIMARY KEY');
  if (definition.unique) parts.push('UNIQUE');
  if (!definition.nullable && !definition.primaryKey) parts.push('NOT NULL');
  return parts.join(' ');
};

/**
 * Idempotent DDL for the A2.1 slice. `schema` names the PostgreSQL control
 * schema; it is ignored on SQLite where tables live in the store file's
 * single schema (local profile, spec r2 §2.9).
 */
export const identitySchemaStatements = (dialect: IdentitySchemaDialect, schema: string): readonly string[] =>
  TABLES.map((definition) => {
    const columns = definition.columns
      .map((column) => columnSql(column, dialect, column.name === definition.autoIncrement))
      .join(', ');
    return `CREATE TABLE IF NOT EXISTS ${identityTable(dialect, dialect === 'postgres' ? schema : null, definition.table)} (${columns})`;
  });
