// Lot A4 test helper: raw access to the cm_identity stores for fixture
// seeding/cleanup. The legacy public.users/userSessions/webauthn*/magicLinks/
// emailVerificationCodes/workspaceMemberships/tenantMemberships tables are
// dropped by control migration 0014; tests seed and purge through these.
import { CM_IDENTITY_SCHEMA, cmStoreClient } from '../../src/services/identity/cm-identity';

const q = (table: string) => `"${CM_IDENTITY_SCHEMA}"."${table}"`;

// Tables carrying a user_id column, in FK-safe delete order.
const USER_SCOPED_TABLES: readonly string[] = [
  'identity_login_token_bindings',
  'identity_login_sessions',
  'identity_webauthn_credentials',
  'identity_single_use_proofs',
  'identity_email_registration_tickets',
  'identity_invitation_digests',
  'identity_invitations',
  'identity_social_links',
  'identity_device_codes',
  'identity_deletion_attempts',
  'identity_deletion_operations',
  'identity_revocation_outbox',
  'identity_legacy_connector_tombstones',
  'identity_account_profiles',
  'identity_user_accounts',
  'cm_workspace_members',
  'cm_tenant_memberships',
];

// Tables carrying an email column (proofs/tickets are email-scoped, not user-scoped).
const EMAIL_SCOPED_TABLES: readonly string[] = [
  'identity_single_use_proofs',
  'identity_email_registration_tickets',
];

/** Delete every identity row bound to the given users (any state). */
export async function cmDeleteForUsers(userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  for (const table of USER_SCOPED_TABLES) {
    await cmStoreClient.query(`DELETE FROM ${q(table)} WHERE "user_id" = ANY($1)`, [userIds]);
  }
}

/** Delete email-scoped proofs/tickets for the given emails. */
export async function cmDeleteForEmails(emails: readonly string[]): Promise<void> {
  if (emails.length === 0) return;
  for (const table of EMAIL_SCOPED_TABLES) {
    await cmStoreClient.query(`DELETE FROM ${q(table)} WHERE "email" = ANY($1)`, [emails]);
  }
}

/** Purge the whole cm_identity store (full reset between suites). */
export async function cmPurgeAllIdentity(): Promise<void> {
  const all = [
    ...USER_SCOPED_TABLES,
    ...EMAIL_SCOPED_TABLES,
    'identity_audit_events',
    'cm_workspaces',
    'cm_oauth_consents',
    'cm_service_clients',
    'cm_tenants',
    'cm_identity_conversation_sessions',
    'cm_identity_escalation_entries',
  ];
  const seen = new Set<string>();
  for (const table of all) {
    if (seen.has(table)) continue;
    seen.add(table);
    await cmStoreClient.query(`DELETE FROM ${q(table)}`);
  }
}

/** Count rows in a cm_identity table (assertions: no orphan left behind). */
export async function cmCount(table: string, where = '', values: readonly unknown[] = []): Promise<number> {
  const result = await cmStoreClient.query(
    `SELECT COUNT(*)::int AS n FROM ${q(table)}${where ? ` WHERE ${where}` : ''}`,
    values,
  );
  return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0);
}

/** Raw query against the cm_identity schema (fixture surgery the facades do not expose). */
export async function cmQuery<T = Record<string, unknown>>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await cmStoreClient.query(sql, values as unknown[]);
  return result.rows as T[];
}

/** Quote a cm_identity table reference. */
export function cmTable(table: string): string {
  return q(table);
}
