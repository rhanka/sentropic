import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const publicFolder = new URL('../../../drizzle/', import.meta.url).pathname;
const controlFolder = `${publicFolder}control`;
const cutover = readFileSync(`${controlFolder}/0014_app_cm_identity_cutover.sql`, 'utf8');
const sourceUrl = process.env.DATABASE_URL!;
let admin: Client;
let database: Client;
let databaseName: string;

beforeEach(async () => {
  // The test owns a database in the isolated test stack, never the source DB.
  if (process.env.NODE_ENV !== 'test') throw new Error('Isolated test environment required');
  databaseName = `a4_migration_${randomUUID().replaceAll('-', '')}`;
  admin = new Client({ connectionString: sourceUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
  const url = new URL(sourceUrl);
  url.pathname = `/${databaseName}`;
  database = new Client({ connectionString: url.toString() });
  await database.connect();
  for (const migration of readMigrationFiles({ migrationsFolder: publicFolder })) {
    for (const statement of migration.sql) await database.query(statement);
  }
  for (const migration of readMigrationFiles({ migrationsFolder: controlFolder }).slice(0, -1)) {
    for (const statement of migration.sql) await database.query(statement);
  }
  await database.query(`INSERT INTO users (id, email, role, account_status, email_verified)
    VALUES ('a4-owner', 'a4-owner@example.test', 'editor', 'active', true)`);
  await database.query(`INSERT INTO workspaces (id, name, owner_user_id, tenant_id)
    VALUES ('a4-owned', 'Owned business data', 'a4-owner', 'sentropic')`);
  await database.query(`INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES ('a4-owned', 'a4-owner', 'admin')`);
  await database.query(`INSERT INTO tenant_memberships (tenant_id, user_id, status, role)
    VALUES ('sentropic', 'a4-owner', 'approved', 'member')`);
});

afterEach(async () => {
  await database?.end();
  if (admin) {
    if (databaseName) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});

async function migrate(failBeforeCommit = false) {
  await database.query('BEGIN');
  try {
    for (const statement of cutover.split('--> statement-breakpoint')) await database.query(statement);
    if (failBeforeCommit) throw new Error('injected cutover failure');
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

describe('A4 single control identity migration', () => {
  it('should refuse SQL-only deletion without the bound CM importer and protected checkpoint', async () => {
    await expect(migrate()).rejects.toThrow('A4 bound import checkpoint required');
    expect((await database.query("SELECT id FROM users WHERE id = 'a4-owner'")).rowCount).toBe(1);
  });

  it('should preserve the D11 checkpoint after deleting legacy identity tables', async () => {
    await migrate();
    const { rows } = await database.query(`SELECT phase, detail FROM control.app_cm_identity_cutover
      WHERE cutover_id = 'a4-identity-cutover'`);
    expect(rows[0]?.phase).toBe('pre-deletion-checkpoint');
    expect(rows[0]?.detail.legacy_counts.users).toBe(1);
    expect(rows[0]?.detail.cm_counts.identity_user_accounts).toBe(1);
    expect((await database.query("SELECT to_regclass('public.users') AS relation")).rows[0].relation).toBeNull();
    expect((await database.query("SELECT name FROM public.workspaces WHERE id = 'a4-owned'")).rows)
      .toEqual([{ name: 'Owned business data' }]);
    expect((await database.query('SELECT workspace_id FROM cm_identity.cm_workspaces')).rows)
      .toContainEqual({ workspace_id: 'a4-owned' });
  });

  it('should roll back identity, business and checkpoint changes when the cutover fails', async () => {
    await expect(migrate(true)).rejects.toThrow('injected cutover failure');
    expect((await database.query("SELECT id FROM users WHERE id = 'a4-owner'")).rowCount).toBe(1);
    expect((await database.query("SELECT owner_user_id FROM workspaces WHERE id = 'a4-owned'")).rows)
      .toEqual([{ owner_user_id: 'a4-owner' }]);
    expect((await database.query("SELECT to_regclass('control.app_cm_identity_cutover') AS relation")).rows[0].relation)
      .toBeNull();
  });

  it('should preserve refresh revocation when a migrated account is disabled', async () => {
    await migrate();
    await database.query(`INSERT INTO oauth_clients (id, client_id, name, redirect_uris)
      VALUES ('a4-client', 'a4-client', 'A4 client', ARRAY['https://client.test/callback'])`);
    await database.query(`INSERT INTO oauth_refresh_tokens
      (id, token_hash, family_id, client_id, user_id, scope, offline_grant_id, issuer, audience,
        acr, amr, auth_time, expires_at, family_expires_at)
      VALUES ('a4-family', repeat('a', 64), 'a4-family', 'a4-client', 'a4-owner', 'offline_access',
        'a4-grant', 'https://idp.test', 'https://client.test', 'urn:test', ARRAY['pwd'],
        now(), now() + interval '1 day', now() + interval '1 day')`);
    await database.query("UPDATE cm_identity.identity_user_accounts SET account_status = 'disabled' WHERE user_id = 'a4-owner'");
    expect((await database.query("SELECT revoked_at IS NOT NULL AS revoked FROM oauth_refresh_tokens WHERE id = 'a4-family'"))
      .rows).toEqual([{ revoked: true }]);
  });
});
