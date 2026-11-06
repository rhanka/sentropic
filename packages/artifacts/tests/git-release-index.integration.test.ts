import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresGitReleaseIndexStore } from '../src/adapters/postgres-git-bindings.js';
import { gitBinding } from './fixtures/git-binding-conformance.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(f => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(new URL(file, directory), 'utf8'));
  }
  await pool.query("INSERT INTO artifacts.storage_scopes(id,org_id) VALUES ('scope-a','scope-a')");
  await pool.query(`INSERT INTO artifacts.artifacts(id,storage_scope_id,owner_id,binding_name)
    VALUES ($1,'scope-a','alice','demo')`, [gitBinding().artifactId]);
});
afterAll(async () => { await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE'); await pool.end(); });
describe('release to commit index', () => {
  it('should retain several rebuilds per commit and isolate all reads by scope', async () => {
    const store = createPostgresGitReleaseIndexStore(pool);
    const sha = 'a'.repeat(40);
    const ids = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
    // SG4 owns these writes inside the release transaction, never from caller metadata.
    for (const [i, id] of ids.entries()) {
      await pool.query(`INSERT INTO artifacts.releases(id,artifact_id,manifest_digest,manifest,git_commit)
        VALUES ($1,$2,'manifest','{}',$3)`, [id, gitBinding().artifactId, sha]);
      await pool.query(`INSERT INTO artifacts.git_release_index(release_id,artifact_id,storage_scope_id,
        repo_id,branch,commit_sha,manifest_digest,candidate_digest,executor,verification,receipt_id,job_id,created_at)
        VALUES ($1,$2,'scope-a','repo-a','artifact/shared/demo',$3,'manifest',$4,'caller','sha-verified',$5,$6,now())`,
        [id, gitBinding().artifactId, sha, `candidate-${i}`, `receipt-${i}`, `job-${i}`]);
    }
    expect(await store.get('scope-a', ids[0])).toMatchObject({ releaseId: ids[0], commitSha: sha,
      verification: 'sha-verified', candidateDigest: 'candidate-0', receiptId: 'receipt-0' });
    expect(await store.get('scope-b', ids[0])).toBeUndefined();
    expect(await store.forCommit('scope-a', gitBinding().artifactId, sha)).toHaveLength(2);
    expect(await store.forCommit('scope-a', gitBinding().artifactId, 'b'.repeat(40))).toEqual([]);
    expect(await store.forCommit('scope-b', gitBinding().artifactId, sha)).toEqual([]);
    for (const sql of ['UPDATE artifacts.git_release_index SET commit_sha=commit_sha',
      'DELETE FROM artifacts.git_release_index', 'TRUNCATE artifacts.git_release_index']) {
      await expect(pool.query(sql)).rejects.toThrow(/append-only/);
    }
    await expect(pool.query(`INSERT INTO artifacts.git_release_index SELECT * FROM artifacts.git_release_index LIMIT 1`))
      .rejects.toThrow(/duplicate key/);
  });
});
