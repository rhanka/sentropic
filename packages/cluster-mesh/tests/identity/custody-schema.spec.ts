import { describe, expect, it } from 'vitest';
import { openPostgresEnv, openSqliteEnv, pgEnabled } from './a20b-helpers.js';

const foreignKeys = [
  ['identity_account_profiles', 'user_id', 'identity_user_accounts', 'user_id', 'RESTRICT'],
  ['identity_webauthn_credentials', 'user_id', 'identity_user_accounts', 'user_id', 'RESTRICT'],
  ['identity_social_links', 'user_id', 'identity_user_accounts', 'user_id', 'RESTRICT'],
  ['identity_single_use_proofs', 'user_id', 'identity_user_accounts', 'user_id', 'RESTRICT'],
  ['identity_email_registration_tickets', 'user_id', 'identity_user_accounts', 'user_id', 'RESTRICT'],
  ['identity_email_registration_tickets', 'code_kind', 'identity_single_use_proofs', 'kind', 'RESTRICT'],
  ['identity_email_registration_tickets', 'code_proof_id', 'identity_single_use_proofs', 'proof_id', 'RESTRICT'],
  ['identity_login_token_bindings', 'session_id', 'identity_login_sessions', 'session_id', 'RESTRICT'],
  ['identity_invitation_digests', 'consumed_by_user_id', 'identity_user_accounts', 'user_id', 'SET NULL'],
  ['identity_invitation_digests', 'tenant_id', 'cm_tenants', 'tenant_id', 'RESTRICT'],
  ['identity_invitation_digests', 'workspace_id', 'cm_workspaces', 'workspace_id', 'RESTRICT'],
  ['identity_deletion_attempts', 'operation_id', 'identity_deletion_operations', 'operation_id', 'RESTRICT'],
] as const;
const booleans = [
  ['identity_account_profiles', 'email_verified'], ['identity_webauthn_credentials', 'uv'],
  ['identity_webauthn_credentials', 'backed_up'], ['identity_login_token_bindings', 'mfa_verified'],
  ['identity_social_links', 'email_verified_by_provider'],
] as const;

describe.each(pgEnabled ? ['postgres', 'sqlite'] : ['sqlite'])('A2.0b schema constraints on %s', (profile) => {
  it('installs every custody foreign key with its exact deletion action', async () => {
    if (profile === 'sqlite') {
      const env = openSqliteEnv();
      expect(env.connection.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 });
      for (const [table, from, target, to, action] of foreignKeys) {
        const rows = env.connection.prepare(`PRAGMA foreign_key_list("${table}")`).all();
        expect(rows).toContainEqual(expect.objectContaining({ from, table: target, to, on_delete: action }));
      }
    } else {
      const env = await openPostgresEnv();
      await env.raw.transaction({ isolation: 'serializable', readOnly: true, deadlineMs: 5000 }, async (session) => {
        for (const [table, from, target, to, action] of foreignKeys) {
          const { rows } = await session.execute({
            text: `SELECT a.attname AS source, b.attname AS target, c.confdeltype AS action
              FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_class r ON r.oid = c.confrelid
              CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(src, dst)
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.src
              JOIN pg_attribute b ON b.attrelid = r.oid AND b.attnum = k.dst
              WHERE c.contype = 'f' AND n.nspname = $1 AND t.relname = $2 AND r.relname = $3`,
            values: [env.schema, table, target],
          });
          expect(rows).toContainEqual({ source: from, target: to, action: action === 'RESTRICT' ? 'r' : 'n' });
        }
      });
    }
  });

  it('uses native PostgreSQL booleans and checked SQLite integers', async () => {
    if (profile === 'sqlite') {
      const env = openSqliteEnv();
      for (const [table, column] of booleans) {
        expect(env.connection.prepare(`PRAGMA table_info("${table}")`).all())
          .toContainEqual(expect.objectContaining({ name: column, type: 'INTEGER' }));
        const row = env.connection.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table) as { sql: string };
        expect(row.sql).toContain(`CHECK ("${column}" IN (0,1))`);
      }
    } else {
      const env = await openPostgresEnv();
      await env.raw.transaction({ isolation: 'serializable', readOnly: true, deadlineMs: 5000 }, async (session) => {
        for (const [table, column] of booleans) {
          const { rows } = await session.execute({
            text: 'SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3',
            values: [env.schema, table, column],
          });
          expect(rows).toEqual([{ data_type: 'boolean' }]);
        }
      });
    }
  });
});
