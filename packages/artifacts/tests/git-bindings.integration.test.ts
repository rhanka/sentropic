import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresGitBindingStore } from '../src/adapters/postgres-git-bindings.js';
import { gitBinding, gitBindingConformance, gitWrite } from './fixtures/git-binding-conformance.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(f => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(new URL(file, directory), 'utf8'));
  }
});
afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.end();
});
async function fresh() {
  await pool.query('DROP SCHEMA artifacts CASCADE');
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(f => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(new URL(file, directory), 'utf8'));
  }
  for (const scope of ['scope-a', 'scope-b']) {
    await pool.query('INSERT INTO artifacts.storage_scopes(id,org_id) VALUES ($1,$1)', [scope]);
  }
  for (const [id, scope] of [
    [gitBinding().artifactId, 'scope-a'], ['22222222-2222-4222-8222-222222222222', 'scope-a'],
    ['33333333-3333-4333-8333-333333333333', 'scope-b'],
  ]) {
    await pool.query('INSERT INTO artifacts.artifacts(id,storage_scope_id,owner_id,binding_name) VALUES ($1,$2,$3,$4)',
      [id, scope, 'alice', id]);
  }
  return createPostgresGitBindingStore(pool);
}
gitBindingConformance('Postgres tenant git bindings', fresh);
describe('Postgres durable binding constraints', () => {
  it('should replay from a fresh adapter and reject audit mutation', async () => {
    const store = await fresh();
    await store.write(gitWrite());
    expect((await createPostgresGitBindingStore(pool).write(gitWrite())).replayed).toBe(true);
    for (const sql of ['UPDATE artifacts.git_binding_events SET actor_id = actor_id',
      'DELETE FROM artifacts.git_binding_events', 'TRUNCATE artifacts.git_binding_events']) {
      await expect(pool.query(sql)).rejects.toThrow(/append-only/);
    }
  });
  it('should keep the served release intact after binding detach', async () => {
    const store = await fresh();
    await store.write(gitWrite());
    const release = '44444444-4444-4444-8444-444444444444';
    await pool.query(`INSERT INTO artifacts.releases(id,artifact_id,manifest_digest,manifest)
      VALUES ($1,$2,'digest','{}')`, [release, gitBinding().artifactId]);
    await pool.query('INSERT INTO artifacts.artifact_current(artifact_id,release_id) VALUES ($1,$2)',
      [gitBinding().artifactId, release]);
    await store.write({ ...gitWrite({ ...gitBinding(), state: 'detached', generation: 2, version: 2 }, 'detach'),
      expectedVersion: 1, event: { action: 'detach' } });
    expect((await pool.query('SELECT release_id FROM artifacts.artifact_current')).rows[0].release_id).toBe(release);
  });
});
