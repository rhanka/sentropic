import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret } from '../../../src/services/secret-crypto';
import { prepareCmFixtureCutover } from '../../utils/cm-fresh-database';

const publicFolder = new URL('../../../drizzle/', import.meta.url).pathname;
const controlFolder = `${publicFolder}control`;
const cutover = readFileSync(`${controlFolder}/0015_app_cm_identity_cutover.sql`, 'utf8');
const sourceUrl = process.env.DATABASE_URL!;
let admin: Client;
let database: PoolClient;
let databasePool: Pool;
let databaseName: string;
let restoreFixture: (() => Promise<void>) | undefined;

beforeEach(async () => {
  // The test owns a database in the isolated test stack, never the source DB.
  if (process.env.NODE_ENV !== 'test') throw new Error('Isolated test environment required');
  databaseName = `a4_migration_${randomUUID().replaceAll('-', '')}`;
  admin = new Client({ connectionString: sourceUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
  const url = new URL(sourceUrl);
  url.pathname = `/${databaseName}`;
  databasePool = new Pool({ connectionString: url.toString() });
  database = await databasePool.connect();
  // Apply migrations through the real runner (journal bookkeeping included) up
  // to the cutover itself, which migrate() applies statement by statement.
  restoreFixture = await prepareCmFixtureCutover(databasePool, ['0015_app_cm_identity_cutover']);
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
  await restoreFixture?.();
  restoreFixture = undefined;
  database?.release();
  await databasePool?.end();
  if (admin) {
    if (databaseName) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});

async function migrate(failBeforeCommit = false, boundImport = true, purpose: 'rehearsal' | 'cutover' = 'rehearsal') {
  // Import through the same real runner used by control migrations, with no SQL
  // fabrication of the CM receipt, schema attestations or D11 checkpoint.
  const fixture = boundImport ? await (await import('../../utils/cm-cutover-test-config'))
    .createCmCutoverTestConfiguration(database, undefined, purpose) : null;
  await database.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    if (fixture) await (await import('../../../src/services/identity/cm-cutover-import'))
      .importAppCmIdentityInTransaction(database, fixture.config);
    for (const statement of cutover.split('--> statement-breakpoint')) await database.query(statement);
    if (failBeforeCommit) throw new Error('injected cutover failure');
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  } finally { await fixture?.dispose(); }
}

describe('A4 single control identity migration', () => {
  it.each([
    ['webauthn_challenge', `INSERT INTO webauthn_challenges (id, challenge, user_id, type, expires_at)
      VALUES ('challenge', 'challenge', 'a4-owner', 'authentication', now() + interval '1 day')`],
    ['email_code', `INSERT INTO email_verification_codes (id, email, code_hash, expires_at)
      VALUES ('code', 'a4-owner@example.test', repeat('a', 64), now() + interval '1 day')`],
    ['email_ticket', `INSERT INTO email_verification_codes (id, email, code_hash, verification_token, used, expires_at)
      VALUES ('ticket', 'a4-owner@example.test', repeat('a', 64), 'foreign-seed-ticket', true, now() + interval '1 day')`],
    ['email_ticket', `INSERT INTO email_verification_codes (id, email, code_hash, verification_token, used, expires_at)
      VALUES ('unused-ticket', 'a4-owner@example.test', repeat('a', 64), 'foreign-seed-ticket', false, now() + interval '1 day')`],
    ['magic_link', `INSERT INTO magic_links (id, email, user_id, token_hash, expires_at)
      VALUES ('magic', 'a4-owner@example.test', 'a4-owner', repeat('b', 64), now() + interval '1 day')`],
    ['login_session', `INSERT INTO user_sessions (id, user_id, session_token_hash, expires_at)
      VALUES ('login', 'a4-owner', repeat('c', 64), now() + interval '1 day')`],
    ['login_refresh_token', `INSERT INTO user_sessions (id, user_id, session_token_hash, refresh_token_hash, expires_at)
      VALUES ('refresh', 'a4-owner', repeat('d', 64), repeat('e', 64), now() + interval '1 day')`],
  ].flatMap(([kind, insert]) => (['rehearsal', 'cutover'] as const).map(purpose => [kind, purpose, insert] as const)))(
    'should invalidate %s during %s and retain its count', async (kind, purpose, insert) => {
    await database.query(insert);
    await migrate(false, true, purpose);
    for (const table of ['identity_single_use_proofs', 'identity_email_registration_tickets', 'identity_login_sessions', 'identity_login_token_bindings']) {
      expect((await database.query(`SELECT count(*)::int AS count FROM cm_identity.${table}`)).rows)
        .toEqual([{ count: 0 }]);
    }
    const { rows } = await database.query('SELECT detail FROM control.app_cm_identity_cutover');
    expect(rows[0].detail.invalidatedProofCounts[kind]).toBe(1);
    expect(rows[0].detail.importReceipt.invalidatedProofCounts[kind]).toBe(1);
    expect(rows[0].detail.purpose).toBe(purpose);
    expect(JSON.stringify(rows[0].detail)).not.toContain('foreign-seed-ticket');
    expect(rows[0].detail.importReceipt.identitiesPreserved).toBe(true);
  });

  it('should refuse an unknown source token column before dropping identity tables', async () => {
    await database.query('ALTER TABLE email_verification_codes ADD COLUMN unknown_token text');
    await expect(migrate()).rejects.toMatchObject({ code: 'identity_import_invalid' });
    expect((await database.query("SELECT id FROM users WHERE id = 'a4-owner'")).rowCount).toBe(1);
  });

  it.each(['recoverable', 'missing', 'unreadable'] as const)(
    'accounts for every historical connector event with %s source capability', async kind => {
      const secret = kind === 'recoverable' ? encryptSecret(JSON.stringify({ refreshToken: 'synthetic-legacy-token' }))
        : kind === 'missing' ? null : 'unreadable-source-fixture';
      await database.query(`INSERT INTO document_connector_accounts
        (id, workspace_id, user_id, provider, status, token_secret)
        VALUES ('connector-a', 'a4-owned', 'a4-owner', 'google_drive', 'connected', $1)`, [secret]);
      for (const [seq, id] of ['legacy-a', 'legacy-b'].entries()) {
        await database.query(`INSERT INTO control.event_outbox
          (id, aggregate_type, aggregate_id, seq, envelope, channel, status)
          VALUES ($1, 'connector_account', 'connector-a', $2, $3, 'connector_grant_events', 'dispatched')`,
        [id, seq + 1, JSON.stringify({ type: 'connector.grant.orphaned', accountId: 'connector-a', provider: 'google_drive' })]);
      }
      await migrate();
      const accounting = (await database.query(`SELECT source_event_id, subject_id, disposition, delivery_id
        FROM cm_identity.identity_legacy_connector_tombstones ORDER BY source_event_id`)).rows;
      expect(accounting.map(row => row.source_event_id)).toEqual(['legacy-a', 'legacy-b']);
      expect(accounting.every(row => row.subject_id === 'a4-owner'
        && row.disposition === (kind === 'recoverable' ? 'queued' : 'unresolved'))).toBe(true);
      if (kind === 'recoverable') expect(new Set(accounting.map(row => row.delivery_id)).size).toBe(2);
      else expect(accounting.every(row => row.delivery_id === null)).toBe(true);
      expect((await database.query('SELECT delivery_id FROM cm_identity.identity_revocation_outbox')).rowCount)
        .toBe(kind === 'recoverable' ? 2 : 0);
      expect((await database.query('SELECT custody_ref FROM control.connector_revocation_custody')).rowCount)
        .toBe(kind === 'recoverable' ? 2 : 0);
      expect((await database.query(`SELECT id FROM control.event_outbox WHERE id IN ('legacy-a', 'legacy-b')`)).rowCount).toBe(2);
    });

  it('should refuse SQL-only deletion without the bound CM importer and protected checkpoint', async () => {
    await expect(migrate(false, false)).rejects.toThrow('A4 bound import checkpoint required');
    expect((await database.query("SELECT id FROM users WHERE id = 'a4-owner'")).rowCount).toBe(1);
  });

  it('should preserve the D11 checkpoint after deleting legacy identity tables', async () => {
    await migrate();
    const { rows } = await database.query(`SELECT phase, detail FROM control.app_cm_identity_cutover
      WHERE cutover_id = 'a4-identity-cutover'`);
    expect(rows[0]?.phase).toBe('pre-deletion-checkpoint');
    expect(rows[0]?.detail.sourceInventory.users.count).toBe(1);
    expect(rows[0]?.detail.importReceipt).toMatchObject({ identitiesPreserved: true,
      verificationMaterialPreserved: true, lifecyclePreserved: true });
    expect((await database.query('SELECT user_id FROM cm_identity.identity_user_accounts')).rows)
      .toEqual([{ user_id: 'a4-owner' }]);
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
    await database.query(`INSERT INTO oauth_clients (id, client_id, name, redirect_uris, allowed_scopes)
      VALUES ('a4-client', 'a4-client', 'A4 client', ARRAY['https://client.test/callback'], ARRAY['offline_access'])`);
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
