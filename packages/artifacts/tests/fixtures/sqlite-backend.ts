/**
 * U1 — SQLite conformance backend shared by the unit lane
 * (`tests/sqlite-conformance.test.ts`) and the integration lane
 * (`tests/adapter-conformance.integration.test.ts`). Each `open()` gets a
 * fresh temp directory (fresh database file + fresh blob root); `reopen()`
 * closes the connection and reopens the same file (restart durability).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSqliteActivationStore,
  createSqliteArtifactStore,
  createSqliteCommitExecutor,
  createSqliteWriter,
  normalizeSql,
  openSqliteDatabase,
  type SqliteDatabase,
} from '../../src/adapters/sqlite.js';
import { createSqliteManagementUnit } from '../../src/adapters/sqlite-management.js';
import { createLocalBlobStore } from '../../src/adapters/local-blob.js';
import type { ConformanceBackend, ConformanceHandle } from './adapter-conformance.js';
import type { ActivationConformanceHost } from './activation-conformance.js';

const dirs: string[] = [];
export function cleanupSqliteDirs(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
const mktemp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'artifacts-sqlite-u1-'));
  dirs.push(dir);
  return dir;
};

/** Wrap a database so COMMIT executes and then loses its acknowledgement. */
export function withCommitAckLoss(db: SqliteDatabase): SqliteDatabase {
  return {
    exec(sql: string): void {
      db.exec(sql);
      if (/^\s*COMMIT/i.test(sql)) throw new Error('simulated COMMIT acknowledgement loss');
    },
    prepare(sql: string) { return db.prepare(sql); },
    close() { db.close(); },
  };
}

export function makeSqliteHandle(dir: string): ConformanceHandle {
  const db = openSqliteDatabase(join(dir, 'artifacts.db'));
  const writer = createSqliteWriter(db);
  db.exec(`INSERT OR IGNORE INTO storage_scopes (id, org_id) VALUES ('scope-1', 'org-1')`);
  const blobRoot = join(dir, 'blobs');
  let commitTestReady = false;
  return {
    store: createSqliteArtifactStore(db, writer),
    executor: createSqliteCommitExecutor(db, writer),
    makeUnit: (conn) => createSqliteManagementUnit(conn),
    async makeBlobStore() {
      return {
        blobs: createLocalBlobStore(blobRoot),
        verifiesDigest: true,
        cleanup: async () => { rmSync(blobRoot, { recursive: true, force: true }); },
      };
    },
    async setupCommitTest() {
      if (commitTestReady) return;
      db.exec(`ATTACH DATABASE ':memory:' AS commit_test`);
      db.exec('CREATE TABLE IF NOT EXISTS commit_test.policy_revision (id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL)');
      db.exec(`INSERT OR IGNORE INTO commit_test.policy_revision (id, revision) VALUES (1, 'rev-1')`);
      db.exec('CREATE TABLE IF NOT EXISTS commit_test.approvals (actor_id TEXT PRIMARY KEY, approved INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL)');
      db.exec(`INSERT OR REPLACE INTO commit_test.approvals (actor_id, approved, expires_at_ms) VALUES ('actor-1', 1, 9999999999999)`);
      db.exec('CREATE TABLE IF NOT EXISTS commit_test.quotas (quota_key TEXT PRIMARY KEY, total INTEGER NOT NULL, used INTEGER NOT NULL)');
      db.exec(`INSERT OR REPLACE INTO commit_test.quotas (quota_key, total, used) VALUES ('q-main', 100, 0)`);
      db.exec('CREATE TABLE IF NOT EXISTS commit_test.effects (scope_id TEXT NOT NULL, internal_key TEXT NOT NULL)');
      commitTestReady = true;
    },
    async countCommitTest(table, where = '', params = []) {
      const { sql, args } = normalizeSql(`SELECT COUNT(*) AS n FROM commit_test.${table}${where}`, params);
      const row = db.prepare(sql).get(...args) as { n: number | bigint };
      return Number(row.n);
    },
    async countOperationKeys(scopeId, internalKey) {
      const row = db.prepare('SELECT COUNT(*) AS n FROM operation_keys WHERE storage_scope_id = ? AND internal_key = ?')
        .get(scopeId, internalKey) as { n: number | bigint };
      return Number(row.n);
    },
    async countReceipts(scopeId, internalKey) {
      const row = db.prepare('SELECT COUNT(*) AS n FROM operation_receipts WHERE storage_scope_id = ? AND internal_key = ?')
        .get(scopeId, internalKey) as { n: number | bigint };
      return Number(row.n);
    },
    async reopen() {
      try { db.close(); } catch { /* already closed by the caller */ }
      return makeSqliteHandle(dir);
    },
    async close() {
      db.close();
    },
  };
}

export function createSqliteBackend(): ConformanceBackend {
  return {
    name: 'sqlite',
    async open() {
      return makeSqliteHandle(mktemp());
    },
  };
}

export function createSqliteActivationHost(dir?: string): ActivationConformanceHost & { close(): void } {
  const own = dir === undefined;
  const target = dir ?? mktemp();
  const db = openSqliteDatabase(join(target, 'activation.db'));
  const writer = createSqliteWriter(db);
  return {
    createStore: (namespace) => createSqliteActivationStore({ db, writer, namespace }),
    wait: async (ms) => { await new Promise((resolve) => setTimeout(resolve, ms)); },
    inspectTicket: async (namespace, ticketId) => {
      const row = db.prepare(
        `SELECT issued_ms AS issuedAt, json_extract(payload, '$.expiresAt') AS expiresAt,
                CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) AS now
         FROM activation_tickets WHERE namespace = ? AND json_extract(payload, '$.ticketId') = ?`,
      ).get(namespace, ticketId) as { issuedAt: number; expiresAt: number; now: number };
      return { issuedAt: Number(row.issuedAt), expiresAt: Number(row.expiresAt), now: Number(row.now) };
    },
    createStoreWithCommitAckLoss: (namespace) => {
      const lossy = withCommitAckLoss(db);
      return createSqliteActivationStore({ db: lossy, writer: createSqliteWriter(lossy), namespace });
    },
    close() { db.close(); if (own) rmSync(target, { recursive: true, force: true }); },
  };
}
