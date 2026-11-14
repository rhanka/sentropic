/**
 * CMF-S2 — composite placement on Postgres (additive, env-gated).
 * Mode parsing refuses unknown modes; the placements reader defaults
 * existing rows to `object`; publication promotes to `db`; the composite
 * round-trips bytes and coordinates deletes.
 */
import { seedCmArtifactIdentity } from '../utils/cm-artifact-fixture';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GetPublicAccessBlockCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { createArtifactHostJobs, createLazyArtifactBlobs, createPrivateArtifactStorage } from '../../src/services/artifacts/lifecycle';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresDbBlobStore } from '@sentropic/artifacts/adapters/db-blob';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import { listBlobKeysPaged } from '@sentropic/artifacts/server/blob-bridge';
import { createGcService, createMemoryRefcountStore, createPostgresDeletionClaimStore } from '@sentropic/artifacts/server/gc';
import { createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
import { createPostgresCommitExecutor } from '@sentropic/artifacts/adapters/postgres-commit';
import { createPostgresGcService } from '@sentropic/artifacts/server/gc';
import { migrateCmFixtureDatabase as runMigrations } from '../utils/cm-fresh-database';
import { createArtifactHost } from '../../src/services/artifacts/composition';
import { createPlacementBlobStore, createPostgresBlobPlacements,
  parseBlobInlineMaxBytes, parseBlobPlacementMode } from '../../src/services/artifacts/blob-placement';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let pool: Pool;
let connectionEnds: Promise<void>[];
let databaseName: string;
const identity = { subject: 'alice', tenantId: 'tenant-a', clientId: 'app', credentialId: 'session-a' };

function keyFor(bytes: Uint8Array): string {
  return `artifacts/scope-p/blobs/sha256/${createHash('sha256').update(bytes).digest('hex')}`;
}

beforeEach(async () => {
  databaseName = `cmfs2_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  pool = new Pool({ connectionString: url.toString() });
  connectionEnds = [];
  pool.on('connect', (client) => {
    connectionEnds.push(new Promise<void>((resolve) => client.once('end', resolve)));
  });
  await runMigrations(pool);
  await seedCmArtifactIdentity(pool, { otherUsers: ['bob'] });
});

afterEach(async () => {
  await pool.end();
  await Promise.all(connectionEnds);
  await admin.query(`DROP DATABASE "${databaseName}"`);
});

afterAll(() => admin.end());

function hostWith(placementForSize?: (size: number) => 'db' | 'object', mode: 'db' | 's3' | 'db+s3' = 'db') {
  const s3 = createMemoryBlobStore();
  const blobs = createPlacementBlobStore({ pool, s3, mode, inlineMaxBytes: 64 });
  return { host: createArtifactHost({ pool, blobs, quotaBytes: 262144, placementForSize,
    async currentIdentity(client, claims) {
      if (claims.clientId !== 'app') return { readable: false, writable: false };
      const result = await client.query(`SELECT session_id FROM cm_identity.identity_login_sessions WHERE session_id = $1 AND user_id = $2
        AND expires_at::timestamptz > clock_timestamp() FOR SHARE`, [claims.credentialId, claims.subject]);
      return { readable: result.rowCount === 1, writable: result.rowCount === 1 };
    } }), s3 };
}

describe('composite blob placement', () => {
  it.each([['db', 'db'], ['s3', 's3'], ['db', 's3'], ['s3', 'db']] as const)(
    'cleans expired %s preparations in %s mode under the owning lock', async (placement, mode) => {
    const bounded = new Pool({ connectionString: pool.options.connectionString,
      options: '-c lock_timeout=200ms -c statement_timeout=2000ms' });
    try {
      const s3 = createMemoryBlobStore();
      const blobs = createPlacementBlobStore({ pool: bounded, s3, mode, inlineMaxBytes: 8 });
      const bytes = new TextEncoder().encode(`expired ${placement} in ${mode}`);
      const key = keyFor(bytes);
      await (placement === 'db' ? createPostgresDbBlobStore(bounded) : s3).putBlob(key, bytes);
      const store = createPostgresArtifactStore(bounded);
      const intent = await store.record('commit-release', { artifactId: 'artifact', attemptId: 'expired',
        invocationId: 'expired', releaseId: 'expired', blobKeys: [key],
        preparedAtMs: Date.now() - 20000, cleanupDeadlineMs: Date.now() - 10000 });
      const jobs = createArtifactHostJobs({ pool: bounded, blobs, authorize: async () => true,
        page: async prefix => ({ keys: await s3.listKeys(prefix) }) });
      await jobs.cleanup();
      expect(await blobs.getBlob(key)).toBeUndefined();
      expect((await store.get(intent.intentId))?.payload.cleanupState).toBe('failed-cleaned');
    } finally { await bounded.end(); }
  });

  it('resumes a deletion whose successful S3 response was lost and permits republication', async () => {
    const db = createPostgresDbBlobStore(pool);
    const s3 = createMemoryBlobStore();
    const bytes = new TextEncoder().encode('lost delete response');
    const key = keyFor(bytes);
    await db.putBlob(key, bytes);
    await s3.putBlob(key, bytes);
    let lost = true;
    const { createCompositeBlobStore } = await import('@sentropic/artifacts/adapters/composite-blob');
    const blobs = createCompositeBlobStore({ db, s3: { ...s3, async deleteBlob(candidate) {
      await s3.deleteBlob(candidate);
      if (lost) { lost = false; throw new Error('response lost'); }
    } }, mode: 'db', inlineMaxBytes: 8, placements: { getPlacement: async () => undefined } });
    const jobs = createArtifactHostJobs({ pool, blobs, authorize: async () => true, page: async () => ({ keys: [] }) });
    expect((await jobs.collect('scope-p')).failures).toHaveLength(1);
    expect(await blobs.listKeys('artifacts/scope-p/blobs/sha256/')).toEqual([]);
    const restarted = createArtifactHostJobs({ pool, blobs, authorize: async () => true, page: async () => ({ keys: [] }) });
    expect((await restarted.collect('other-scope')).deleted).toEqual([]);
    expect((await restarted.collect('scope-p')).deleted).toEqual([key]);
    expect((await pool.query("SELECT state FROM artifacts.object_intents WHERE kind = 'delete-blob'")).rows)
      .toEqual([{ state: 'done' }]);
    const refs = createPostgresArtifactStore(pool);
    const { createPostgresClaimGuardedRefs } = await import('@sentropic/artifacts/server/gc');
    await createPostgresClaimGuardedRefs(refs, createPostgresCommitExecutor(pool))
      .pin(`sha256:${key.split('/').pop()}`, 'republish');
    await blobs.putBlob(key, bytes);
    expect(await blobs.getBlob(key)).toEqual(bytes);
  });

  it('pages exact and partial DB prefixes after earlier keys in the same scope', async () => {
    const db = createPostgresDbBlobStore(pool);
    const keys: string[] = [];
    for (let i = 0; i < 12; i++) {
      const bytes = new TextEncoder().encode(`prefix ${i}`);
      await db.putBlob(keyFor(bytes), bytes);
      keys.push(keyFor(bytes));
    }
    keys.sort();
    for (const prefix of [keys[11]!, keys[11]!.slice(0, -1)]) {
      expect((await listBlobKeysPaged(db, prefix, { maxItems: 1, maxEncodedBytes: 1000 })).keys).toEqual([keys[11]]);
    }
  });

  it.each(['db', 's3'] as const)('keeps a failed %s erasure pending until host GC retries', async failingSide => {
    const db = createPostgresDbBlobStore(pool);
    const s3 = createMemoryBlobStore();
    const bytes = new TextEncoder().encode('durable partial erasure');
    const key = keyFor(bytes);
    await db.putBlob(key, bytes);
    await s3.putBlob(key, bytes);
    const side = failingSide === 'db' ? db : s3;
    let denied = true;
    const failing = { ...side, async deleteBlob(candidate: string) {
      if (denied) throw new Error('AccessDenied');
      await side.deleteBlob(candidate);
    } };
    const { createCompositeBlobStore } = await import('@sentropic/artifacts/adapters/composite-blob');
    const blobs = createCompositeBlobStore({ db: failingSide === 'db' ? failing : db,
      s3: failingSide === 's3' ? failing : s3, mode: 'db+s3', inlineMaxBytes: 8,
      placements: { getPlacement: async () => undefined } });
    const jobs = createArtifactHostJobs({ pool, blobs, authorize: async () => true,
      page: async () => { throw new Error('unexpected legacy enumeration'); } });
    const failed = await jobs.collect('scope-p');
    expect(failed.deleted).toEqual([]);
    expect(failed.failures).toEqual([{ key, error: 'Error: AccessDenied' }]);
    expect((await pool.query("SELECT state FROM artifacts.object_intents WHERE kind = 'delete-blob'")).rows).toEqual([{ state: 'pending' }]);
    denied = false;
    expect((await jobs.collect('scope-p')).deleted).toEqual([key]);
    expect((await pool.query("SELECT state FROM artifacts.object_intents WHERE kind = 'delete-blob'")).rows).toEqual([{ state: 'done' }]);
  });

  it('bounds S3 calls through both host wrappers and resumes by key', async () => {
    const prefix = 'artifacts/scope-p/blobs/sha256/';
    const keys = [1, 2, 3, 4, 5].map(n => `${prefix}${String(n).padStart(64, '0')}`);
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetPublicAccessBlockCommand) return { PublicAccessBlockConfiguration: {
        BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } };
      if (!(command instanceof ListObjectsV2Command)) throw new Error('unexpected S3 command');
      const remaining = keys.filter(key => key > (command.input.StartAfter ?? prefix));
      const page = remaining.slice(0, command.input.MaxKeys ?? remaining.length);
      return { Contents: page.map(Key => ({ Key })), IsTruncated: page.length < remaining.length };
    });
    const storage = await createPrivateArtifactStorage({ bucket: 'private-artifacts', client: { send } as unknown as S3Client });
    const store = createPlacementBlobStore({ pool, s3: createLazyArtifactBlobs(async () => storage), mode: 's3', inlineMaxBytes: 8 });
    const first = await listBlobKeysPaged(store, prefix, { maxItems: 2, maxEncodedBytes: 10000 });
    expect(first.keys).toEqual(keys.slice(0, 2));
    expect(first.continuation).toBeDefined();
    expect(send.mock.calls.filter(([command]) => command instanceof ListObjectsV2Command)).toHaveLength(1);
    expect((send.mock.calls[1]![0] as ListObjectsV2Command).input).toMatchObject({ MaxKeys: 3, StartAfter: undefined });
    const second = await listBlobKeysPaged(store, prefix, { maxItems: 2, maxEncodedBytes: 10000, continuation: first.continuation });
    expect(second.keys).toEqual(keys.slice(2, 4));
    expect(send.mock.calls.filter(([command]) => command instanceof ListObjectsV2Command)).toHaveLength(2);
    expect((send.mock.calls[2]![0] as ListObjectsV2Command).input).toMatchObject({ MaxKeys: 3, StartAfter: keys[1] });
  });

  it.each(['s3', 'db'] as const)('host maintenance collects old placements in %s mode', async mode => {
    const db = createPostgresDbBlobStore(pool);
    const s3 = createMemoryBlobStore();
    const a = new TextEncoder().encode('old db placement');
    const b = new TextEncoder().encode('old s3 placement');
    await db.putBlob(keyFor(a), a);
    await s3.putBlob(keyFor(b), b);
    const blobs = createPlacementBlobStore({ pool, s3, mode, inlineMaxBytes: 8 });
    const jobs = createArtifactHostJobs({ pool, blobs, batchSize: 1, authorize: async () => true,
      page: async () => { throw new Error('S3-only enumeration bypasses composite'); } });
    const first = await jobs.collect('scope-p');
    expect(first.failures).toEqual([]);
    expect(first.deleted).toHaveLength(1);
    expect(first.cursor).toBeDefined();
    const second = await jobs.collect('scope-p', first.cursor);
    expect(second.failures).toEqual([]);
    expect([...first.deleted, ...second.deleted].sort()).toEqual([keyFor(a), keyFor(b)].sort());
    expect(await db.getBlob(keyFor(a))).toBeUndefined();
    expect(await s3.getBlob(keyFor(b))).toBeUndefined();
  });

  it('collects inside the real owning transaction without reacquiring on another connection', async () => {
    const bytes = new TextEncoder().encode('gc real begin');
    const key = keyFor(bytes);
    const db = createPostgresDbBlobStore(pool);
    const s3 = createMemoryBlobStore();
    await db.putBlob(key, bytes);
    await s3.putBlob(key, bytes);
    // Bound a regression instead of hanging the suite on the second connection.
    const lockedPool = new Pool({ connectionString: pool.options.connectionString,
      options: '-c lock_timeout=200ms -c statement_timeout=2000ms' });
    try {
      const store = createPlacementBlobStore({ pool: lockedPool, s3, mode: 's3', inlineMaxBytes: 8 });
      const gc = createPostgresGcService(createPostgresCommitExecutor(lockedPool), () => createMemoryRefcountStore());
      expect(await gc.collect(store, 'artifacts/scope-p/blobs/sha256/')).toEqual({ deleted: [key], retained: [], failures: [] });
      expect(await db.getBlob(key)).toBeUndefined();
      expect(await s3.getBlob(key)).toBeUndefined();
    } finally { await lockedPool.end(); }
  });

  it('parses placement env with fail-closed defaults', () => {
    expect(parseBlobPlacementMode(undefined)).toBe('s3');
    expect(parseBlobPlacementMode('')).toBe('s3');
    expect(parseBlobPlacementMode('db')).toBe('db');
    expect(parseBlobPlacementMode('db+s3')).toBe('db+s3');
    expect(() => parseBlobPlacementMode('tape')).toThrow(/invalid artifact blob placement mode/);
    expect(parseBlobInlineMaxBytes(undefined)).toBe(65536);
    expect(() => parseBlobInlineMaxBytes('0')).toThrow(/invalid artifact blob inline max bytes/);
    expect(() => parseBlobInlineMaxBytes('huge')).toThrow(/invalid artifact blob inline max bytes/);
  });

  it('reads unknown placements as missing and existing rows as object', async () => {
    const placements = createPostgresBlobPlacements(pool);
    expect(await placements.getPlacement(keyFor(new TextEncoder().encode('nope')))).toBeUndefined();
    await expect(placements.getPlacement('artifacts/scope-p/blobs/sha256/zzz')).rejects.toThrow(/invalid blob key/);
    await pool.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-p', 'tenant-a')`);
    await pool.query(`INSERT INTO artifacts.blobs (storage_scope_id, digest, size)
      VALUES ('scope-p', 'sha256:${'cd'.repeat(32)}', 3)`);
    expect(await placements.getPlacement(`artifacts/scope-p/blobs/sha256/${'cd'.repeat(32)}`)).toBe('object');
  });

  it('promotes published blobs to db only with an explicit placement', async () => {
    const publish = async (withPlacement: boolean) => {
      const { host, s3 } = hostWith(withPlacement ? () => 'db' : undefined, withPlacement ? 'db' : 's3');
      const bound = await host.bind(identity, 'workspace-a');
      const ensured = await bound.http({ method: 'POST', path: '/ensure',
        body: { bindingName: `report-${randomUUID()}`, idempotencyKey: randomUUID() } });
      const artifactId = (ensured.body as { artifactId: string }).artifactId;
      const text = `<h1>placement ${withPlacement ? 'db' : 'object'}</h1>`;
      const published = await bound.http({ method: 'POST', path: '/publish',
        body: { artifactId, idempotencyKey: randomUUID(),
          files: [{ path: 'index.html', mimeType: 'text/html', text }] } });
      expect(published.status).toBe(201);
      return { text, s3 };
    };
    const objectCase = await publish(false);
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual([{ placement: 'object' }]);
    // s3 mode writes object bytes to the object side, never to blob_bytes.
    expect((await pool.query('SELECT count(*)::int AS n FROM artifacts.blob_bytes')).rows).toEqual([{ n: 0 }]);
    const dbCase = await publish(true);
    expect((await pool.query('SELECT placement FROM artifacts.blobs ORDER BY placement')).rows)
      .toEqual([{ placement: 'db' }, { placement: 'object' }]);
    // db mode writes through the placement store into blob_bytes.
    const dbRows = (await pool.query('SELECT digest FROM artifacts.blob_bytes')).rows;
    expect(dbRows).toHaveLength(1);
    void objectCase;
    void dbCase;
  });

  it('publishes small inline to db and large to s3 in db+s3 mode', async () => {
    const { host } = hostWith((size) => (size <= 64 ? 'db' : 'object'), 'db+s3');
    const bound = await host.bind(identity, 'workspace-a');
    const ensured = await bound.http({ method: 'POST', path: '/ensure',
      body: { bindingName: `report-${randomUUID()}`, idempotencyKey: randomUUID() } });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const smallText = 'small inline blob';
    const largeText = `large-${'x'.repeat(200)}`;
    const published = await bound.http({ method: 'POST', path: '/publish',
      body: { artifactId, idempotencyKey: randomUUID(),
        files: [{ path: 'small.html', mimeType: 'text/html', text: smallText },
          { path: 'large.html', mimeType: 'text/html', text: largeText }] } });
    expect(published.status).toBe(201);
    const placements = (await pool.query('SELECT placement FROM artifacts.blobs ORDER BY placement')).rows;
    expect(placements).toEqual([{ placement: 'db' }, { placement: 'object' }]);
    // Small blob landed in blob_bytes, large did not.
    const dbCount = (await pool.query('SELECT count(*)::int AS n FROM artifacts.blob_bytes')).rows;
    expect(dbCount).toEqual([{ n: 1 }]);
  });

  it('round-trips db bytes and coordinates deletes across sides', async () => {
    const s3 = createMemoryBlobStore();
    const store = createPlacementBlobStore({ pool, s3, mode: 'db', inlineMaxBytes: 8 });
    const bytes = new TextEncoder().encode('db bytes');
    const key = keyFor(bytes);
    await store.putBlob(key, bytes);
    expect(await createPostgresDbBlobStore(pool).getBlob(key)).toEqual(bytes);
    expect(await store.getBlob(key)).toEqual(bytes);
    expect(await store.listKeys('artifacts/scope-p/blobs/sha256/')).toEqual([key]);
    await store.deleteBlob(key);
    expect(await store.getBlob(key)).toBeUndefined();
    await expect(store.deleteBlob(key)).rejects.toThrow(/unknown blob/);
  });

  it('walks db-side keyset pages to the full set without bulk loading', async () => {
    const db = createPostgresDbBlobStore(pool);
    expect(db.listKeysPaged).toBeDefined();
    const prefix = 'artifacts/scope-p/blobs/sha256/';
    const expected: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const bytes = new TextEncoder().encode(`db page ${index} ${randomUUID()}`);
      const key = keyFor(bytes);
      expected.push(key);
      await db.putBlob(key, bytes);
    }
    expected.sort();
    const seen: string[] = [];
    let startAfter: string | undefined;
    for (;;) {
      const result = await db.listKeysPaged!(prefix, startAfter === undefined
        ? { maxItems: 2, maxEncodedBytes: 1_000_000 }
        : { maxItems: 2, maxEncodedBytes: 1_000_000, startAfter });
      expect(result.keys.length).toBeLessThanOrEqual(2);
      seen.push(...result.keys);
      if (!result.hasMore) break;
      startAfter = result.keys[result.keys.length - 1];
    }
    expect(seen).toEqual(expected);
    await expect(db.listKeysPaged!(prefix, {
      maxItems: 2, maxEncodedBytes: 1_000_000, startAfter: `artifacts/other/blobs/sha256/${'f'.repeat(64)}`,
    })).rejects.toThrow(/resume key/);
  });

  it('walks the composite union through sealed continuations across sides', async () => {
    const s3 = createMemoryBlobStore();
    const db = createPostgresDbBlobStore(pool);
    const prefix = 'artifacts/scope-p/blobs/sha256/';
    const expected = new Set<string>();
    for (let index = 0; index < 3; index += 1) {
      const bytes = new TextEncoder().encode(`union db ${index} ${randomUUID()}`);
      const key = keyFor(bytes);
      expected.add(key);
      await db.putBlob(key, bytes);
    }
    for (let index = 0; index < 3; index += 1) {
      const bytes = new TextEncoder().encode(`union s3 ${index} ${randomUUID()}`);
      const key = keyFor(bytes);
      expected.add(key);
      await s3.putBlob(key, bytes);
    }
    const shared = new TextEncoder().encode(`union shared ${randomUUID()}`);
    const sharedKey = keyFor(shared);
    expected.add(sharedKey);
    await db.putBlob(sharedKey, shared);
    await s3.putBlob(sharedKey, shared);
    const store = createPlacementBlobStore({ pool, s3, mode: 'db+s3', inlineMaxBytes: 8 });
    const ordered = [...expected].sort();
    const seen: string[] = [];
    let continuation: string | undefined;
    for (;;) {
      const page = await listBlobKeysPaged(store, prefix, continuation === undefined
        ? { maxItems: 2, maxEncodedBytes: 1_000_000 }
        : { maxItems: 2, maxEncodedBytes: 1_000_000, continuation });
      expect(page.keys.length).toBeLessThanOrEqual(2);
      seen.push(...page.keys);
      if (page.continuation === undefined) break;
      continuation = page.continuation;
    }
    expect(seen).toEqual(ordered);
  });

  it('collects unreferenced blobs from blob_bytes and s3 under the digest lock', async () => {
    const s3 = createMemoryBlobStore();
    const db = createPostgresDbBlobStore(pool);
    const prefix = 'artifacts/scope-p/blobs/sha256/';
    const bytes = new TextEncoder().encode('gc collects both sides');
    const key = keyFor(bytes);
    const digest = `sha256:${key.split('/').pop()}`;
    await db.putBlob(key, bytes);
    await s3.putBlob(key, bytes);
    const store = createPlacementBlobStore({ pool, s3, mode: 'db+s3', inlineMaxBytes: 8 });
    const refs = createMemoryRefcountStore();
    const client = await pool.connect();
    // pg rowCount is `number | null`; the claim store needs a strict count.
    const tx = { query: async <T>(text: string, params: readonly unknown[]) => {
      const result = await client.query(text, [...params]);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    } };
    try {
      const report = await createGcService(refs).collect(store, prefix, createPostgresDeletionClaimStore(tx));
      expect(report.failures).toEqual([]);
      expect(report.deleted).toEqual([key]);
      expect(await db.getBlob(key)).toBeUndefined();
      expect(await s3.getBlob(key)).toBeUndefined();
    } finally {
      client.release();
    }
    // A referenced blob is retained on both sides.
    await db.putBlob(key, bytes);
    await s3.putBlob(key, bytes);
    await refs.addRef(digest, 'release:test');
    const retainedClient = await pool.connect();
    const retainedTx = { query: async <T>(text: string, params: readonly unknown[]) => {
      const result = await retainedClient.query(text, [...params]);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    } };
    try {
      const report = await createGcService(refs).collect(store, prefix, createPostgresDeletionClaimStore(retainedTx));
      expect(report.deleted).toEqual([]);
      expect(report.retained).toEqual([key]);
      expect(await db.getBlob(key)).toEqual(bytes);
      expect(await s3.getBlob(key)).toEqual(bytes);
    } finally {
      retainedClient.release();
    }
  });

  it('collects both copies on delete after a placement migration', async () => {
    const bytes = new TextEncoder().encode('migrated then collected');
    const key = keyFor(bytes);
    const digest = `sha256:${key.split('/').pop()}`;
    const s3 = createMemoryBlobStore();
    const db = createPostgresDbBlobStore(pool);
    await db.putBlob(key, bytes);
    await pool.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-p', 'tenant-a') ON CONFLICT DO NOTHING`);
    await pool.query(`INSERT INTO artifacts.blobs (storage_scope_id, digest, size, placement)
      VALUES ('scope-p', $1, $2, 'db') ON CONFLICT DO NOTHING`, [digest, bytes.length]);
    const composite = createPlacementBlobStore({ pool, s3, mode: 'db', inlineMaxBytes: 8 });
    const { migratePlacement: migrate } = await import('../../src/scripts/cm-placement-migrate');
    const report = await migrate({ pool, composite, db, s3, scope: 'scope-p', to: 'object' });
    expect(report.done).toBe(true);
    expect(await s3.getBlob(key)).toEqual(bytes);
    expect(await db.getBlob(key)).toEqual(bytes);
    const gcStore = createPlacementBlobStore({ pool, s3, mode: 'db+s3', inlineMaxBytes: 8 });
    await gcStore.deleteBlob(key);
    expect(await db.getBlob(key)).toBeUndefined();
    expect(await s3.getBlob(key)).toBeUndefined();
  });
});
