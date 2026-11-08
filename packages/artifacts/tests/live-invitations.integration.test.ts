import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresLiveStore } from '../src/adapters/postgres-live.js';
import { invitationWorld } from './fixtures/live-invitation-world.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const directory = new URL('../migrations/', import.meta.url);
const sql = (file: string) => readFileSync(new URL(file, directory), 'utf8');
const MIGRATION = '0013_live_invitations.sql';
const IMMO_0038 = `CREATE TABLE artifacts.live_invitations (invitation_id uuid PRIMARY KEY, storage_scope_id text NOT NULL,
  artifact_id uuid NOT NULL, binding_generation bigint NOT NULL, live_session_id text NOT NULL, invitee_id text NOT NULL,
  grantor_id text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  epoch bigint NOT NULL);
  CREATE INDEX live_invitations_by_binding ON artifacts.live_invitations(storage_scope_id, artifact_id, binding_generation)`;
const indexes = async () => (await pool.query(`SELECT tablename, indexname FROM pg_indexes
  WHERE schemaname='artifacts' AND tablename LIKE 'live_invitation%' ORDER BY 1, 2`)).rows;
const rebuild = async () => {
  await pool.query('DROP TABLE IF EXISTS artifacts.live_invitations, artifacts.live_invitation_epochs');
  await pool.query(sql(MIGRATION));
};

beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.query('CREATE SCHEMA IF NOT EXISTS artifacts');
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) await pool.query(sql(file));
});
afterAll(async () => { await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE'); await pool.end(); });

it('should create both invitation tables with the expected indexes and reapply 0013 idempotently', async () => {
  await pool.query(sql(MIGRATION));
  expect(await indexes()).toEqual([
    { tablename: 'live_invitation_epochs', indexname: 'live_invitation_epochs_pkey' },
    { tablename: 'live_invitations', indexname: 'live_invitations_open_principal_uq' },
    { tablename: 'live_invitations', indexname: 'live_invitations_pkey' },
    { tablename: 'live_invitations', indexname: 'live_invitations_session_idx' }]);
});

it('should fail 0013 over the foreign immo 0038 live_invitations table and leave it untouched', async () => {
  await pool.query('DROP TABLE artifacts.live_invitations');
  await pool.query(IMMO_0038);
  await expect(pool.query(sql(MIGRATION))).rejects.toThrow();
  expect((await indexes()).filter(row => row.tablename === 'live_invitations').map(row => row.indexname))
    .toEqual(['live_invitations_by_binding', 'live_invitations_pkey']);
  await rebuild();
});

it('should fail the 0013 guard on any foreign column or index of either table', async () => {
  for (const drift of ['ALTER TABLE artifacts.live_invitations ADD COLUMN invitee_id text',
    'ALTER TABLE artifacts.live_invitation_epochs ALTER COLUMN epoch TYPE integer',
    'ALTER TABLE artifacts.live_invitations ALTER COLUMN accepted_at SET NOT NULL',
    'CREATE INDEX live_invitations_by_binding ON artifacts.live_invitations(storage_scope_id, artifact_id, binding_generation)',
    `DROP INDEX artifacts.live_invitations_session_idx;
     CREATE INDEX live_invitations_session_idx ON artifacts.live_invitations(storage_scope_id)`,
    `DROP INDEX artifacts.live_invitations_open_principal_uq; CREATE INDEX live_invitations_open_principal_uq
     ON artifacts.live_invitations(storage_scope_id, artifact_id, binding_generation, live_session_id, principal_id)`]) {
    await pool.query(drift);
    await expect(pool.query(sql(MIGRATION))).rejects.toThrow(/live invitations schema mismatch/);
    await rebuild();
  }
});

it('should persist invitations, epochs and replays through the postgres-live adapter', async () => {
  const v = invitationWorld({ store: createPostgresLiveStore(pool) });
  await pool.query(`INSERT INTO artifacts.storage_scopes(id,org_id) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [v.identity.storageScopeId]);
  await pool.query(`INSERT INTO artifacts.artifacts(id,storage_scope_id,owner_id,binding_name) VALUES ($1,$2,'alice','live')
    ON CONFLICT DO NOTHING`, [v.identity.artifactId, v.identity.storageScopeId]);
  const sid = await v.start();
  const bob = await v.invite(sid, 'bob'), carol = await v.invite(sid, 'carol');
  expect(await v.accept('bob', bob.invitationId)).toMatchObject({ status: 'active', epoch: 1 });
  expect(await v.revoke('alice', carol.invitationId)).toMatchObject({ status: 'revoked', epoch: 2 });
  expect(await v.invite(sid, 'bob')).toMatchObject({ invitationId: bob.invitationId, replayed: true });
  expect(v.onRevoked).toHaveBeenCalledTimes(1);
  const reopened = invitationWorld({ store: createPostgresLiveStore(pool) }).w.service;
  expect(await reopened.liveViewer(v.identity, 'bob')).toEqual({ role: 'invitee',
    invitation: { id: bob.invitationId, epoch: 2, expiresAt: Date.parse(bob.expiresAt) } });
  expect(await reopened.liveInvitationState(v.identity)).toEqual({ epoch: 2, expiresAt: Date.parse(bob.expiresAt) });
  expect((await pool.query(`SELECT principal_id, created_by, status, epoch::int, row_version::int
    FROM artifacts.live_invitations ORDER BY principal_id`)).rows).toEqual([
    { principal_id: 'bob', created_by: 'alice', status: 'active', epoch: 2, row_version: 3 },
    { principal_id: 'carol', created_by: 'alice', status: 'revoked', epoch: 2, row_version: 2 }]);
  await expect(pool.query(`INSERT INTO artifacts.live_invitations VALUES ($1,$2,1,$3,gen_random_uuid(),'bob','alice',
    'pending',2,now() + interval '1 hour',NULL,NULL,now(),1)`, [v.identity.storageScopeId, v.identity.artifactId, sid]))
    .rejects.toThrow(/live_invitations_open_principal_uq/);
});
