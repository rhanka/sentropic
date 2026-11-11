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

function hostWith(placementForSize?: (size: number) => 'db' | 'object') {
  return createArtifactHost({ pool, blobs: createMemoryBlobStore(), quotaBytes: 262144, placementForSize,
    async currentIdentity(client, claims) {
      if (claims.clientId !== 'app') return { readable: false, writable: false };
      const result = await client.query(`SELECT session_id FROM cm_identity.identity_login_sessions WHERE session_id = $1 AND user_id = $2
        AND expires_at::timestamptz > clock_timestamp() FOR SHARE`, [claims.credentialId, claims.subject]);
      return { readable: result.rowCount === 1, writable: result.rowCount === 1 };
    } });
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
      const host = hostWith(withPlacement ? () => 'db' : undefined);
      const bound = await host.bind(identity, 'workspace-a');
      const ensured = await bound.http({ method: 'POST', path: '/ensure',
        body: { bindingName: `report-${randomUUID()}`, idempotencyKey: randomUUID() } });
      const artifactId = (ensured.body as { artifactId: string }).artifactId;
      const published = await bound.http({ method: 'POST', path: '/publish',
        body: { artifactId, idempotencyKey: randomUUID(),
          files: [{ path: 'index.html', mimeType: 'text/html', text: '<h1>db</h1>' }] } });
      expect(published.status).toBe(201);
    };
    await publish(false);
    expect((await pool.query('SELECT placement FROM artifacts.blobs')).rows).toEqual([{ placement: 'object' }]);
    await publish(true);
    expect((await pool.query('SELECT placement FROM artifacts.blobs ORDER BY placement')).rows)
      .toEqual([{ placement: 'db' }, { placement: 'object' }]);
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
});
