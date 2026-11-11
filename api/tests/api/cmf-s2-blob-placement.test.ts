/**
 * CMF-S2 — composite placement on Postgres (additive, env-gated).
 * Mode parsing refuses unknown modes; the placements reader defaults
 * existing rows to `object`; publication promotes to `db`; the composite
 * round-trips bytes and coordinates deletes.
 */
import { seedCmArtifactIdentity } from '../utils/cm-artifact-fixture';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresDbBlobStore } from '@sentropic/artifacts/adapters/db-blob';
import { createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
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
