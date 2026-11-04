/**
 * U1 — local SQLite adapter set, entry point (`@sentropic/artifacts/sqlite`).
 *
 * Durable local equivalent of the Postgres adapters, over the repo-standard
 * `node:sqlite` driver (same driver as cluster-mesh identity; no new native
 * dependency). One connection per database file plus one serialized writer:
 * every mutation runs through `SqliteWriter`, and multi-statement units run
 * inside a single `BEGIN IMMEDIATE` transaction. SQLite then serializes
 * writers — stronger isolation than the Postgres READ COMMITTED units, with
 * the same observable port behaviour; there is no second behaviour. The
 * 0004 terminal guards are enforced in adapter code because all writes are
 * serialized (check-then-write is atomic). The root and portable entries
 * never import this module: only the `./sqlite` subpath pulls in node:sqlite.
 *
 * Schema mapping: SQLite has no schemas, so Postgres `artifacts.<t>` /
 * `artifact_host.<t>` map to plain `<t>` in the single file (DDL owned by
 * this adapter: sql/sqlite/0001_artifacts.sql, sql/sqlite/0002_activation.sql).
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { CommitExecutor } from '../server/commit/types.js';
import type { PostgresArtifactStore } from './postgres.js';
import type { SqliteDatabase } from './sqlite-sql.js';

export type { SqliteDatabase, SqliteStatement } from './sqlite-sql.js';
export { normalizeSql, runQuery } from './sqlite-sql.js';

/** Serialized writer over the single connection (async mutex, not reentrant). */
export interface SqliteWriter {
  /** Run work holding the writer; concurrent callers queue behind it. */
  run<T>(work: () => T): Promise<T>;
  /** run + BEGIN IMMEDIATE … COMMIT (ROLLBACK on throw): one atomic unit. */
  tx<T>(work: () => T): Promise<T>;
  /** Acquire the writer across awaits; the returned function releases it. */
  acquire(): Promise<() => void>;
}

const DDL_ARTIFACTS = readFileSync(new URL('../../sql/sqlite/0001_artifacts.sql', import.meta.url), 'utf8');
const DDL_ACTIVATION = readFileSync(new URL('../../sql/sqlite/0002_activation.sql', import.meta.url), 'utf8');

/** Open (creating if needed) a durable local database file and apply the DDL. */
export function openSqliteDatabase(path: string): SqliteDatabase {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(DDL_ARTIFACTS);
  db.exec(DDL_ACTIVATION);
  return db;
}

/** Create the serialized writer over one database connection. */
export function createSqliteWriter(db: SqliteDatabase): SqliteWriter {
  let tail: Promise<void> = Promise.resolve();
  const acquire = (): Promise<() => void> => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const previous = tail;
    tail = previous.then(() => gate);
    return previous.then(() => release);
  };
  return {
    acquire,
    async run<T>(work: () => T): Promise<T> {
      const release = await acquire();
      try { return work(); } finally { release(); }
    },
    async tx<T>(work: () => T): Promise<T> {
      const release = await acquire();
      try {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = work();
          db.exec('COMMIT');
          return result;
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch { /* transaction already gone */ }
          throw error;
        }
      } finally { release(); }
    },
  };
}

export type SqliteArtifactStore = PostgresArtifactStore;

import { createSqliteArtifactStore } from './sqlite-store.js';
import { createSqliteCommitExecutor } from './sqlite-commit.js';
export { createSqliteArtifactStore, createSqliteCommitExecutor };
export { createSqliteManagementUnit } from './sqlite-management.js';
export { createSqliteActivationStore, type SqliteActivationStore } from './sqlite-activation.js';
export { createLocalBlobStore } from './local-blob.js';

/** One-call wiring: open a file, create the writer, build store + executor. */
export function openSqliteArtifacts(path: string): {
  db: SqliteDatabase;
  writer: SqliteWriter;
  store: SqliteArtifactStore;
  executor: CommitExecutor;
  close(): void;
} {
  const db = openSqliteDatabase(path);
  const writer = createSqliteWriter(db);
  return {
    db,
    writer,
    store: createSqliteArtifactStore(db, writer),
    executor: createSqliteCommitExecutor(db, writer),
    close() { db.close(); },
  };
}
