import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresGitBindingStore } from '../src/adapters/postgres-git-bindings.js';
import type { GitBindingStore } from '../src/server/git-contracts.js';
import { reconcilePendingBuild } from '../src/live-host/reconcile.js';
import { JOB, reconcileJobStore, reconcileStatusClient, SCOPE, SHA } from './fixtures/live-host-reconcile.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// The Postgres parent row keys artifacts by UUID; the host-side job fake takes any string.
const PG_ARTIFACT = '11111111-1111-4111-8111-111111111111';
const key = { scopeId: SCOPE, artifactId: PG_ARTIFACT, jobId: JOB };
const failed = { jobId: JOB, state: 'build_failed' as const, code: 'pg_failed', reason: 'pg reason' };

async function freshBindings(): Promise<GitBindingStore> {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(f => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(new URL(file, directory), 'utf8'));
  }
  await pool.query('INSERT INTO artifacts.storage_scopes(id,org_id) VALUES ($1,$1)', [SCOPE]);
  await pool.query('INSERT INTO artifacts.artifacts(id,storage_scope_id,owner_id,binding_name) VALUES ($1,$2,$3,$4)',
    [PG_ARTIFACT, SCOPE, 'alice', PG_ARTIFACT]);
  const bindings = createPostgresGitBindingStore(pool);
  await bindings.write({ binding: { artifactId: PG_ARTIFACT, storageScopeId: SCOPE, repoId: 'repo-a',
    branch: 'artifact/shared/demo', channel: 'shared', personalPrincipalId: null, subPath: '',
    baseCommitSha: 'a'.repeat(40), headCommitSha: SHA, releaseCommitSha: null, autoPublish: false, executor: 'sandbox',
    pendingJobId: null, pendingCommitSha: null, state: 'attached', generation: 1, version: 1, attachedBy: 'alice',
    attachedAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' },
    expectedVersion: null, actorId: 'alice', idempotencyKey: `attach-${PG_ARTIFACT}`, commandHash: `attach-${PG_ARTIFACT}`,
    event: { action: 'attach', afterSha: SHA } });
  await bindings.write({ binding: { artifactId: PG_ARTIFACT, storageScopeId: SCOPE, repoId: 'repo-a',
    branch: 'artifact/shared/demo', channel: 'shared', personalPrincipalId: null, subPath: '',
    baseCommitSha: 'a'.repeat(40), headCommitSha: SHA, releaseCommitSha: null, autoPublish: false, executor: 'sandbox',
    pendingJobId: JOB, pendingCommitSha: SHA, state: 'build_pending', generation: 1, version: 2, attachedBy: 'alice',
    attachedAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' },
    expectedVersion: 1, actorId: 'alice', idempotencyKey: `publish-${PG_ARTIFACT}-${JOB}`,
    commandHash: `publish-${PG_ARTIFACT}-${JOB}`,
    event: { action: 'publish', beforeSha: undefined, afterSha: SHA, invocationId: 'test' } });
  return bindings;
}

async function bindingRow() {
  const { rows } = await pool.query(`SELECT state, state_detail, version FROM artifacts.git_bindings
    WHERE storage_scope_id=$1 AND artifact_id=$2`, [SCOPE, PG_ARTIFACT]);
  return rows[0] as { state: string; state_detail: string | null; version: number };
}

beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
});
afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.end();
});

describe('live-host pending build reconcile on the Postgres binding adapter', () => {
  it('fails the binding with the code stamped on stateDetail, verified in SQL', async () => {
    const bindings = await freshBindings();
    const id = JSON.stringify([SCOPE, PG_ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const out = await reconcilePendingBuild({ jobs: store,
      status: reconcileStatusClient({ [JOB]: failed }).client, bindings }, key);
    expect(out).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'updated' });
    expect(await bindingRow()).toEqual({ state: 'build_failed', state_detail: 'pg_failed', version: 3 });
    expect((await bindings.events(SCOPE, PG_ARTIFACT)).map(event => event.action))
      .toEqual(['attach', 'publish', 'publish']);
  });

  it('writes anew on Postgres when the same jobId is re-pended and fails again', async () => {
    const bindings = await freshBindings();
    const id = JSON.stringify([SCOPE, PG_ARTIFACT, JOB]);
    const { store, rows } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const options = { jobs: store, status: reconcileStatusClient({ [JOB]: failed }).client, bindings };
    expect((await reconcilePendingBuild(options, key)).outcome).toBe('job-build-failed');
    expect(await bindingRow()).toEqual({ state: 'build_failed', state_detail: 'pg_failed', version: 3 });
    const repended = (await bindings.get(SCOPE, PG_ARTIFACT))!;
    await bindings.write({ binding: { ...repended, state: 'build_pending', version: repended.version + 1,
      updatedAt: repended.updatedAt },
      expectedVersion: repended.version, actorId: 'alice', idempotencyKey: 'repend-1', commandHash: 'repend-1',
      event: { action: 'inbound', invocationId: 'repend' } });
    rows.set(id, { state: 'building', updatedAtMs: 0 });
    const second = await reconcilePendingBuild(options, key);
    expect(second).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'updated' });
    // A stale replay would have left version 4 pending; the second failure wrote version 5.
    expect(await bindingRow()).toEqual({ state: 'build_failed', state_detail: 'pg_failed', version: 5 });
  });
});
