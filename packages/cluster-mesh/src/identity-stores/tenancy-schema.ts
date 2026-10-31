// Identity core lot A2.2: durable DDL for tenants, memberships, workspaces,
// workspace members, OAuth consents and service clients. One logical schema,
// two profiles: PostgreSQL (hosted control schema) and SQLite (local profile).

export const IDENTITY_A22_TABLES = [
  'cm_tenants',
  'cm_tenant_memberships',
  'cm_workspaces',
  'cm_workspace_members',
  'cm_oauth_consents',
  'cm_service_clients',
] as const;

const COMMON_TABLES = `
CREATE TABLE IF NOT EXISTS cm_tenants (
  tenant_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cm_tenant_memberships (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  tenant_role TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tenant_id)
);
CREATE TABLE IF NOT EXISTS cm_workspaces (
  workspace_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  repo_identity TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  enrolled_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_workspaces_repo_uidx
  ON cm_workspaces (tenant_id, repo_identity) WHERE repo_identity IS NOT NULL;
CREATE TABLE IF NOT EXISTS cm_workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS cm_oauth_consents (
  consent_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS cm_service_clients (
  client_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  bound_at TEXT NOT NULL
);
`;

/**
 * PostgreSQL DDL with an optional schema qualifier for per-test isolation.
 * Tables are schema-qualified; the workspace repo index keeps an unqualified
 * name because PostgreSQL refuses a qualified index name, so it resolves
 * through a transaction-local `search_path` into the same schema.
 */
export function identityA22PostgresDdl(schema?: string): string {
  if (!schema) return COMMON_TABLES;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error(`Invalid identity schema: ${schema}`);
  const qualified = COMMON_TABLES.replaceAll(
    'CREATE TABLE IF NOT EXISTS cm_',
    `CREATE TABLE IF NOT EXISTS "${schema}".cm_`,
  ).replaceAll('ON cm_workspaces (', `ON "${schema}".cm_workspaces (`);
  return `BEGIN;\nSET LOCAL search_path = "${schema}";\n${qualified}\nCOMMIT;`;
}

/** SQLite DDL for the local single-owner profile. */
export const IDENTITY_A22_SQLITE_DDL = COMMON_TABLES;
