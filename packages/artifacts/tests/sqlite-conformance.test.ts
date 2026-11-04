/**
 * U1 — SQLite adapter conformance, unit lane (no DATABASE_URL, no minio).
 *
 * Runs the SAME parameterized suites as the Postgres integration lane
 * (`tests/adapter-conformance.integration.test.ts`) against the local
 * SQLite adapters: store, commit coordinator, management unit, blob store,
 * restart durability — plus the 16 UP-T activation vectors through the
 * driver-neutral runner. The SQLite-specific extras (strict blob delete,
 * digest verification) live here because the S3 backend is neither strict
 * nor digest-verifying by design.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createLocalBlobStore } from '../src/adapters/local-blob.js';
import {
  runBlobConformance,
  runCoordinatorConformance,
  runManagementConformance,
  runStoreConformance,
} from './fixtures/adapter-conformance.js';
import { runActivationConformance } from './fixtures/activation-conformance.js';
import { createSqliteActivationHost, createSqliteBackend, cleanupSqliteDirs } from './fixtures/sqlite-backend.js';
import { POSTGRES_ACTIVATION_VECTOR_IDS } from '../src/adapters/postgres-activation-vectors.js';

afterAll(() => cleanupSqliteDirs());

const backend = createSqliteBackend();
runStoreConformance(backend);
runCoordinatorConformance(backend);
runManagementConformance(backend);
runBlobConformance(backend);

describe('sqlite local blob store extras', () => {
  it('deletes strictly', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { createHash } = await import('node:crypto');
    const dir = mkdtempSync(join(tmpdir(), 'artifacts-sqlite-u1-extra-'));
    try {
      const blobs = createLocalBlobStore(join(dir, 'blobs'));
      const content = new Uint8Array([7, 7, 7]);
      const key = `artifacts/scope-1/blobs/sha256/${createHash('sha256').update(content).digest('hex')}`;
      await blobs.putBlob(key, content);
      expect(await blobs.getBlob(key)).toEqual(content);
      await blobs.deleteBlob(key);
      expect(await blobs.getBlob(key)).toBeUndefined();
      await expect(blobs.deleteBlob(key)).rejects.toThrow(/unknown blob/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sqlite activation conformance', () => {
  it('passes every UP-T vector', async () => {
    const host = createSqliteActivationHost();
    try {
      const passed = await runActivationConformance(host);
      expect(passed).toEqual([...POSTGRES_ACTIVATION_VECTOR_IDS]);
    } finally {
      host.close();
    }
  }, 120_000);
});
