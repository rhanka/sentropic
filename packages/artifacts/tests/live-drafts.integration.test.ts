import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresLiveStore } from '../src/adapters/postgres-live.js';
import { draftConformance, liveIdentity } from './fixtures/live-draft-conformance.js';
import { createLiveDraftVault } from '../src/server/live-drafts.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
beforeAll(async () => {
  await pool.query('CREATE SCHEMA IF NOT EXISTS artifacts');
  await pool.query(readFileSync(new URL('../migrations/0011_live_drafts.sql', import.meta.url), 'utf8'));
});
afterAll(async () => { await pool.end(); });
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
