/** L-5b — Postgres adapter proof on disposable postgres (spec-v8 §9 5b). State/intent/idempotency stores + stable bindings over an injected pg Pool. Runs only under `make test-artifacts-integration`. */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createPostgresArtifactStore } from '../src/adapters/postgres.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('postgres proof needs DATABASE_URL (make test-artifacts-integration)');
}

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0001_artifacts.sql'),
  'utf8',
);
const SQL_LIFECYCLE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0002_lifecycle.sql'),
  'utf8',
);

const pool = new Pool({ connectionString: DATABASE_URL });
const store = createPostgresArtifactStore(pool);

beforeAll(async () => {
  const setup = new Pool({ connectionString: DATABASE_URL });
  await setup.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await setup.query(SQL);
  await setup.query(SQL_LIFECYCLE);
  await setup.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-1', 'org-1')`);
  await setup.end();
});

afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await pool.end();
});

describe('postgres artifact store', () => {
  it('ensures stable artifact bindings', async () => {
    const a = await store.ensureArtifact({
      storageScopeId: 'scope-1',
      ownerId: 'owner-1',
      bindingName: 'site',
      profile: { title: 'Hello' },
    });
    expect(a.created).toBe(true);
    expect(a.artifactId).toMatch(/^[0-9a-f-]{36}$/);
    const b = await store.ensureArtifact({
      storageScopeId: 'scope-1',
      ownerId: 'owner-1',
      bindingName: 'site',
      profile: { title: 'Hello' },
    });
    expect(b.created).toBe(false);
    expect(b.artifactId).toBe(a.artifactId);
    const other = await store.ensureArtifact({
      storageScopeId: 'scope-1',
      ownerId: 'owner-2',
      bindingName: 'site',
      profile: {},
    });
    expect(other.artifactId).not.toBe(a.artifactId);
  });

  it('converges concurrent ensures on one row', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.ensureArtifact({
          storageScopeId: 'scope-1',
          ownerId: 'owner-race',
          bindingName: 'race',
          profile: {},
        }),
      ),
    );
    expect(new Set(results.map((r) => r.artifactId)).size).toBe(1);
    expect(results.filter((r) => r.created).length).toBe(1);
  });

  it('records and reconciles intents', async () => {
    const first = await store.record('commit-release', { artifactId: 'a-1' });
    const second = await store.record('commit-release', { artifactId: 'a-2' });
    expect(first.state).toBe('pending');
    await store.complete(first.intentId);
    const pending = await store.listPending();
    expect(pending.map((i) => i.intentId)).toEqual([second.intentId]);
    await store.markFailed(second.intentId, 'boom');
    expect(await store.listPending()).toEqual([]);
  });

  it('executes idempotent operations once', async () => {
    let calls = 0;
    const work = async () => {
      calls += 1;
      return { releaseId: 'r-1' };
    };
    const first = await store.execute('k-1', 'h-1', work);
    const second = await store.execute('k-1', 'h-1', work);
    expect(calls).toBe(1);
    expect(first).toEqual({ result: { releaseId: 'r-1' }, replayed: false });
    expect(second.replayed).toBe(true);
    await expect(store.execute('k-1', 'h-2', work)).rejects.toThrow(/conflict/);
  });

  it('promotes the current release with a real CAS race', async () => {
    const ensured = await store.ensureArtifact({
      storageScopeId: 'scope-1',
      ownerId: 'owner-cas',
      bindingName: 'cas',
      profile: {},
    });
    const release = {
      releaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      artifactId: ensured.artifactId,
      manifestDigest: 'ab'.repeat(32),
      manifest: '{"schemaVersion":"artifacts/v1"}',
      state: 'ready' as const,
      createdAt: new Date().toISOString(),
    };
    await store.putRelease(release);
    expect(await store.compareAndSwapCurrent(ensured.artifactId, null, release.releaseId)).toBe(true);
    const lost = await store.compareAndSwapCurrent(ensured.artifactId, null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(lost).toBe(false);
    expect(await store.getCurrentReleaseId(ensured.artifactId)).toBe(release.releaseId);
  });

  it('stores and reads access grants with the owner', async () => {
    const ensured = await store.ensureArtifact({
      storageScopeId: 'scope-1',
      ownerId: 'owner-acl',
      bindingName: 'acl',
      profile: {},
    });
    expect(await store.getArtifactAcl('00000000-0000-4000-8000-000000000000')).toBeUndefined();
    await store.putArtifactAcl(ensured.artifactId, {
      ownerId: 'owner-acl',
      isPublic: true,
      withdrawn: false,
      grants: [{ principalId: 'reader-1', grant: 'read' }],
    });
    const acl = await store.getArtifactAcl(ensured.artifactId);
    expect(acl).toMatchObject({
      ownerId: 'owner-acl',
      storageScopeId: 'scope-1',
      isPublic: true,
      grants: [{ principalId: 'reader-1', grant: 'read' }],
    });
  });

  it('stores and replaces sources', async () => {
    const ensured = await store.ensureArtifact({
      storageScopeId: 'scope-1',
      ownerId: 'owner-src',
      bindingName: 'src',
      profile: {},
    });
    expect(await store.getSource(ensured.artifactId)).toBeUndefined();
    await store.putSource(ensured.artifactId, { kind: 'base-commit', commit: 'abc' });
    await store.putSource(ensured.artifactId, { kind: 'inline-original' });
    expect(await store.getSource(ensured.artifactId)).toEqual({ kind: 'inline-original' });
  });

  it('tracks lifecycle states on real rows', async () => {
    const ensured = await store.ensureArtifact({
      storageScopeId: 'scope-1',
      ownerId: 'owner-life',
      bindingName: 'life',
      profile: {},
    });
    await expect(store.register('00000000-0000-4000-8000-000000000000', 'owner-life')).rejects.toThrow(
      /unknown artifact/,
    );
    await store.register(ensured.artifactId, 'owner-life');
    expect(await store.getOwner(ensured.artifactId)).toBe('owner-life');
    expect(await store.getArtifactState(ensured.artifactId)).toBe('active');
    await store.setArtifactState(ensured.artifactId, 'withdrawn');
    expect(await store.getArtifactState(ensured.artifactId)).toBe('withdrawn');
    await store.setRenewedAt(ensured.artifactId, '2026-01-01T00:00:00.000Z');
    expect(await store.getRenewedAt(ensured.artifactId)).toBe('2026-01-01T00:00:00.000Z');
    await store.putRelease({
      releaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      artifactId: ensured.artifactId,
      manifestDigest: 'dd'.repeat(32),
      manifest: '{"schemaVersion":"artifacts/v1","files":[]}',
      state: 'ready',
      createdAt: new Date().toISOString(),
    });
    await store.addRelease(ensured.artifactId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(await store.listArtifactReleases(ensured.artifactId)).toEqual([
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    ]);
    expect(await store.getReleaseState('dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBe('ready');
    await store.setReleaseState('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'retired');
    expect(await store.getReleaseState('dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBe('retired');
  });

  it('counts holders and pins exactly', async () => {
    expect(await store.count('sha256:aa')).toBe(0);
    expect(await store.isPinned('sha256:aa')).toBe(false);
    await store.addRef('sha256:aa', 'release-r1');
    await store.addRef('sha256:aa', 'release-r1');
    expect(await store.count('sha256:aa')).toBe(1);
    await store.pin('sha256:aa', 'legal-hold');
    expect(await store.isPinned('sha256:aa')).toBe(true);
    await expect(store.pin('sha256:aa', 'legal-hold')).rejects.toThrow(/duplicate/);
    await store.releaseRef('sha256:aa', 'release-r1');
    expect(await store.count('sha256:aa')).toBe(0);
    await expect(store.releaseRef('sha256:aa', 'release-r1')).rejects.toThrow(/not held/);
    await store.unpin('sha256:aa', 'legal-hold');
    expect(await store.isPinned('sha256:aa')).toBe(false);
    await expect(store.unpin('sha256:aa', 'legal-hold')).rejects.toThrow(/not pinned/);
  });

  it('registers blob rows with the release', async () => {
    const ensured = await store.ensureArtifact({
      storageScopeId: 'scope-1',
      ownerId: 'owner-blobs',
      bindingName: 'blobs',
      profile: {},
    });
    const files = [
      { path: 'a.html', digest: 'sha256:aa', size: 1, mimeType: 'text/html' },
      { path: 'b.html', digest: 'sha256:bb', size: 2, mimeType: 'text/html' },
    ];
    const manifest = JSON.stringify({ schemaVersion: 'artifacts/v1', files });
    await store.putRelease({
      releaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      artifactId: ensured.artifactId,
      manifestDigest: 'cc'.repeat(32),
      manifest,
      state: 'ready',
      createdAt: new Date().toISOString(),
    });
    const blobs = await store.listRegisteredBlobs('scope-1');
    expect(blobs).toContain('sha256:aa');
    expect(blobs).toContain('sha256:bb');
  });
});
