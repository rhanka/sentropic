import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresArtifactStore } from '../src/adapters/postgres.js';
import { createPostgresGitBindingStore } from '../src/adapters/postgres-git-bindings.js';
import { gitBinding, gitWrite } from './fixtures/git-binding-conformance.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const directory = new URL('../migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(f => f.endsWith('.sql')).sort();
const apply = async (file: string) => {
  await pool.query(readFileSync(new URL(file, directory), 'utf8'));
  await pool.query('INSERT INTO rollback_host_journal(name) VALUES ($1)', [file]);
};
beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  // A host-owned journal survives application rollback along with the schema.
  await pool.query('CREATE TEMP TABLE rollback_host_journal(name TEXT PRIMARY KEY)');
  for (const file of migrations.filter(f => f < '0010')) await apply(file);
});
afterAll(async () => { await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE'); await pool.end(); });

describe('0010 application rollback with retained additive schema', () => {
  it('should preserve releases, publication, binding history, provenance and the journal', async () => {
    await pool.query("INSERT INTO artifacts.storage_scopes(id,org_id) VALUES ('scope-a','scope-a')");
    const oldStore = createPostgresArtifactStore(pool);
    const { artifactId } = await oldStore.ensureArtifact({ storageScopeId: 'scope-a', ownerId: 'alice',
      bindingName: 'rollback', profile: {} });
    const oldRelease = { releaseId: '44444444-4444-4444-8444-444444444444', artifactId,
      manifestDigest: 'old-manifest', manifest: JSON.stringify({ files: [{ digest: `sha256:${'ab'.repeat(32)}`, size: 1 }] }),
      createdAt: '2026-11-05T00:00:00.000Z', state: 'ready' as const,
      authorPrincipalId: null, parentReleaseId: null, revertedFromReleaseId: null };
    await oldStore.putRelease(oldRelease);
    expect(await oldStore.compareAndSwapCurrent(artifactId, null, oldRelease.releaseId)).toBe(true);
    // The forward application needs every Git-era migration, 0010 included.
    for (const file of migrations.filter(f => f >= '0010')) await apply(file);
    const bindings = createPostgresGitBindingStore(pool);
    const binding = gitBinding(artifactId);
    await bindings.reserveAttachIntent({ storageScopeId: 'scope-a', artifactId, actorId: 'alice', idempotencyKey: 'attach',
      commandHash: 'attach', repoId: 'repo-a', branch: binding.branch, baseCommitSha: 'a'.repeat(40),
      createdAt: '2026-11-05T00:00:00.000Z' });
    await bindings.write({ ...gitWrite(binding), event: { action: 'attach', branchCreated: true } });
    // Quiesce Git writes before restoring the previous non-Git application.
    await bindings.write({ ...gitWrite({ ...binding, state: 'detached', version: 2, generation: 2 }, 'detach'),
      expectedVersion: 1, event: { action: 'detach' } });
    const gitReleaseId = '55555555-5555-4555-8555-555555555555';
    await pool.query(`INSERT INTO artifacts.releases(id,artifact_id,manifest_digest,manifest,git_commit)
      VALUES ($1,$2,'git-manifest','{}',$3)`, [gitReleaseId, artifactId, 'a'.repeat(40)]);
    await pool.query(`INSERT INTO artifacts.git_release_index(release_id,artifact_id,storage_scope_id,
      repo_id,branch,commit_sha,manifest_digest,candidate_digest,executor,verification,receipt_id,job_id,created_at)
      VALUES ($1,$2,'scope-a','repo-a','artifact/shared/demo',$3,'git-manifest','candidate',
        'caller','sha-verified','receipt','job',now())`, [gitReleaseId, artifactId, 'a'.repeat(40)]);
    const retained = async () => ({
      binding: await bindings.get('scope-a', artifactId), events: await bindings.events('scope-a', artifactId),
      receipts: (await pool.query('SELECT * FROM artifacts.idempotency_keys ORDER BY key')).rows,
      index: (await pool.query('SELECT * FROM artifacts.git_release_index')).rows,
      provenance: (await pool.query('SELECT git_commit FROM artifacts.releases WHERE id=$1', [gitReleaseId])).rows,
      intents: (await pool.query('SELECT * FROM artifacts.git_attach_intents')).rows,
      journal: (await pool.query('SELECT name FROM rollback_host_journal ORDER BY name')).rows,
    });
    const beforeRollback = await retained();

    // These release methods are unchanged from the pre-0010 application; no Git ports are injected.
    // No DDL, schema reset or journal rewind occurs across this rollback boundary.
    const restored = createPostgresArtifactStore(pool);
    expect(await restored.getRelease(oldRelease.releaseId)).toEqual(oldRelease);
    expect(await restored.getCurrentReleaseId(artifactId)).toBe(oldRelease.releaseId);
    const next = { ...oldRelease, releaseId: '66666666-6666-4666-8666-666666666666', manifestDigest: 'new-manifest' };
    await restored.putRelease(next);
    expect(await restored.compareAndSwapCurrent(artifactId, oldRelease.releaseId, next.releaseId)).toBe(true);
    expect(await restored.compareAndSwapCurrent(artifactId, oldRelease.releaseId, oldRelease.releaseId)).toBe(false);
    expect(await restored.getRelease(next.releaseId)).toEqual(next);
    expect(await restored.getCurrentReleaseId(artifactId)).toBe(next.releaseId);
    expect(await restored.getRelease(oldRelease.releaseId)).toEqual(oldRelease);
    expect((await pool.query('SELECT git_commit FROM artifacts.releases WHERE id=$1', [next.releaseId])).rows)
      .toEqual([{ git_commit: null }]);
    expect(await retained()).toEqual(beforeRollback);
    expect(beforeRollback.journal).toHaveLength(migrations.length);
    expect(beforeRollback.intents).toHaveLength(1);
    expect(beforeRollback.events[0]).toMatchObject({ action: 'attach', branchCreated: true });
    for (const table of ['git_binding_events', 'git_release_index']) {
      for (const sql of [`UPDATE artifacts.${table} SET artifact_id=artifact_id`,
        `DELETE FROM artifacts.${table}`, `TRUNCATE artifacts.${table}`]) {
        await expect(pool.query(sql)).rejects.toThrow(/append-only/);
      }
    }
  });
});
