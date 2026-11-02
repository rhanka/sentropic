/**
 * U1 — ONE parameterized conformance suite run against BOTH production
 * backends in a single integration lane: Postgres (store + commit executor
 * + management unit over DATABASE_URL, S3 blob store over minio) and SQLite
 * (local file adapters + local blob store). Behaviour parity is proven by
 * the same `tests/fixtures/adapter-conformance.ts` runners executing green
 * on both. Runs only under `make test-artifacts-integration`.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPostgresArtifactStore } from '../src/adapters/postgres.js';
import { createPostgresCommitExecutor } from '../src/adapters/postgres-commit.js';
import { createPostgresManagementUnit } from '../src/adapters/postgres-management.js';
import { createS3BlobStore } from '../src/adapters/s3.js';
import {
  runBlobConformance,
  runCoordinatorConformance,
  runManagementConformance,
  runStoreConformance,
  type ConformanceBackend,
  type ConformanceHandle,
} from './fixtures/adapter-conformance.js';
import { createSqliteBackend, cleanupSqliteDirs } from './fixtures/sqlite-backend.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('conformance integration needs DATABASE_URL (make test-artifacts-integration)');
}
function s3Env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`conformance integration needs ${name} (make test-artifacts-integration)`);
  }
  return value;
}

const MIGRATIONS = ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql', '0004_terminal_controls.sql', '0005_metadata.sql']
  .map((name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', name), 'utf8'));

const s3 = new S3Client({
  endpoint: s3Env('ARTIFACTS_S3_ENDPOINT'),
  region: s3Env('ARTIFACTS_S3_REGION'),
  credentials: {
    accessKeyId: s3Env('ARTIFACTS_S3_ACCESS_KEY_ID'),
    secretAccessKey: s3Env('ARTIFACTS_S3_SECRET_ACCESS_KEY'),
  },
  forcePathStyle: true,
});

beforeAll(async () => {
  const setup = new Pool({ connectionString: DATABASE_URL });
  await setup.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await setup.query('DROP SCHEMA IF EXISTS commit_test CASCADE');
  for (const sql of MIGRATIONS) await setup.query(sql);
  await setup.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('scope-1', 'org-1')`);
  await setup.query('CREATE SCHEMA commit_test');
  await setup.query('CREATE TABLE commit_test.policy_revision (id INT PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL)');
  await setup.query(`INSERT INTO commit_test.policy_revision (id, revision) VALUES (1, 'rev-1')`);
  await setup.query('CREATE TABLE commit_test.approvals (actor_id TEXT PRIMARY KEY, approved BOOLEAN NOT NULL, expires_at_ms BIGINT NOT NULL)');
  await setup.query(`INSERT INTO commit_test.approvals (actor_id, approved, expires_at_ms) VALUES ('actor-1', true, 9999999999999)`);
  await setup.query('CREATE TABLE commit_test.quotas (quota_key TEXT PRIMARY KEY, total INT NOT NULL, used INT NOT NULL)');
  await setup.query(`INSERT INTO commit_test.quotas (quota_key, total, used) VALUES ('q-main', 100, 0)`);
  await setup.query('CREATE TABLE commit_test.effects (scope_id TEXT NOT NULL, internal_key TEXT NOT NULL)');
  await setup.end();
});

afterAll(async () => {
  cleanupSqliteDirs();
  const setup = new Pool({ connectionString: DATABASE_URL });
  await setup.query('DROP SCHEMA IF EXISTS artifacts CASCADE');
  await setup.query('DROP SCHEMA IF EXISTS commit_test CASCADE');
  await setup.end();
});

/** Postgres backend: a fresh pool per handle (reopen = new connections on the same database). */
const postgresBackend: ConformanceBackend = {
  name: 'postgres',
  async open(): Promise<ConformanceHandle> {
    const pool = new Pool({ connectionString: DATABASE_URL });
    let bucket: string | undefined;
    return {
      store: createPostgresArtifactStore(pool),
      executor: createPostgresCommitExecutor(pool),
      makeUnit: (conn) => createPostgresManagementUnit(conn),
      async makeBlobStore() {
        bucket = `conf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
        return {
          blobs: createS3BlobStore({ client: s3, bucket }),
          verifiesDigest: false,
          cleanup: async () => {
            const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
            const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key as string }));
            if (objects.length > 0) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
            await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
          },
        };
      },
      async setupCommitTest() {
        // Schema and seed rows are installed once in beforeAll; nothing per handle.
      },
      async countCommitTest(table, where = '', params = []) {
        const { rows } = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM commit_test.${table}${where}`, [...params],
        );
        return Number(rows[0]?.n ?? 0);
      },
      async countOperationKeys(scopeId, internalKey) {
        const { rows } = await pool.query<{ n: number }>(
          'SELECT COUNT(*)::int AS n FROM artifacts.operation_keys WHERE storage_scope_id = $1 AND internal_key = $2',
          [scopeId, internalKey],
        );
        return Number(rows[0]?.n ?? 0);
      },
      async countReceipts(scopeId, internalKey) {
        const { rows } = await pool.query<{ n: number }>(
          'SELECT COUNT(*)::int AS n FROM artifacts.operation_receipts WHERE storage_scope_id = $1 AND internal_key = $2',
          [scopeId, internalKey],
        );
        return Number(rows[0]?.n ?? 0);
      },
      async reopen() {
        await pool.end();
        return postgresBackend.open();
      },
      async close() {
        await pool.end();
      },
    };
  },
};

describe('U1 adapter conformance parity', () => {
  runStoreConformance(postgresBackend);
  runCoordinatorConformance(postgresBackend);
  runManagementConformance(postgresBackend);
  runBlobConformance(postgresBackend);
  runStoreConformance(createSqliteBackend());
  runCoordinatorConformance(createSqliteBackend());
  runManagementConformance(createSqliteBackend());
  runBlobConformance(createSqliteBackend());
});
