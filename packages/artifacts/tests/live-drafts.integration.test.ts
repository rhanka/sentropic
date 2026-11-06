import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresLiveStore } from '../src/adapters/postgres-live.js';
import { draftConformance, liveIdentity } from './fixtures/live-draft-conformance.js';
import { createLiveDraftVault } from '../src/server/live-drafts.js';
import { liveWitness } from './fixtures/live-world.js';
import { createPostgresGitBindingStore } from '../src/adapters/postgres-git-bindings.js';
import { gitWrite } from './fixtures/git-binding-conformance.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.query('CREATE SCHEMA IF NOT EXISTS artifacts');
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(new URL(file, directory), 'utf8'));
  }
});
afterAll(async () => { await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE'); await pool.end(); });
draftConformance('Postgres retained encrypted drafts', async () => {
  await pool.query('TRUNCATE artifacts.live_drafts, artifacts.live_draft_objects, artifacts.live_commands, artifacts.live_commit_quota');
  return createPostgresLiveStore(pool);
});
it('should persist only ciphertext and authenticate cross-scope tampering', async () => {
  const store = createPostgresLiveStore(pool);
  const keys = { current: async () => ({ version: 'k1', key: Buffer.alloc(32, 9) }),
    resolve: async () => Buffer.alloc(32, 9) };
  const vault = createLiveDraftVault({ store, keys });
  const identity = { ...liveIdentity, artifactId: '22222222-2222-4222-8222-222222222222' };
  await vault.write({ identity, expectedRevision: null, baseHeadSha: 'a'.repeat(40), baseTreeSha: 'b'.repeat(40),
    liveTreeSha: 'c'.repeat(40), overlay: [{ path: 'ui/page.ts', text: 'secret draft content', mode: '100644' }],
    command: { actorId: 'alice', key: 'tamper', hash: 'tamper', operation: 'live_write' } });
  for (const table of ['live_drafts', 'live_draft_objects', 'live_commands']) {
    expect(JSON.stringify((await pool.query(`SELECT * FROM artifacts.${table}`)).rows)).not.toContain('secret draft content');
  }
  await pool.query(`UPDATE artifacts.live_drafts SET record=jsonb_set(record,'{expiresAt}',to_jsonb('2099-01-01T00:00:00.000Z'::text))
    WHERE artifact_id=$1`, [identity.artifactId]);
  await expect(vault.read(identity)).rejects.toMatchObject({ kind: 'git_live_draft_unavailable' });
});
it('should atomically advance the SG1 binding, clear the draft and replay across Postgres adapters', async () => {
  const w = liveWitness({ store: createPostgresLiveStore(pool) });
  await pool.query(`INSERT INTO artifacts.storage_scopes(id,org_id) VALUES ('scope-a','scope-a') ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO artifacts.artifacts(id,storage_scope_id,owner_id,binding_name)
    VALUES ($1,'scope-a','alice','live') ON CONFLICT DO NOTHING`, [w.binding.artifactId]);
  await pool.query('DELETE FROM artifacts.git_bindings WHERE artifact_id=$1', [w.binding.artifactId]);
  await createPostgresGitBindingStore(pool).write(gitWrite(w.binding, 'live-attach'));
  await pool.query('DELETE FROM artifacts.live_drafts WHERE artifact_id=$1', [w.binding.artifactId]);
  const written = await w.write({ files: [{ path: 'ui/a.ts', text: 'durable commit' }], deletes: ['ui/b.ts'] });
  const args = { expectedHeadSha: written.baseHeadSha, message: 'Commit exact live tree', idempotencyKey: 'pg-commit',
    files: [{ path: 'ui/a.ts', text: 'durable commit' }], deletes: ['ui/b.ts'] };
  const committed = await w.call('git_commit', args);
  expect((await createPostgresGitBindingStore(pool).get('scope-a', w.binding.artifactId))?.headCommitSha).toBe(committed.commitSha);
  expect((await w.status()).dirty).toBe(false);
  const reopened = liveWitness({ store: createPostgresLiveStore(pool) });
  expect(await reopened.call('git_commit', args)).toMatchObject({ commitSha: committed.commitSha, replayed: true });
  expect(reopened.git.commit).not.toHaveBeenCalled();
});
