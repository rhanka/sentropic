// SQL-L1: memory-store SQLite connection factory — PRAGMA enforcement and
// the Stage-0 extension gate. Temp-file databases under the OS temp dir:
// never inside worktrees or Git. The verified sqlite-vec load itself runs
// in s0-qualify.mjs on the qualified container image with the pinned tool.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { CanonicalOwnershipError } from '../../../src/storage/instance-ownership.js';
import {
  openSqliteDatabase,
  SQLITE_MEMORY_BUSY_TIMEOUT_MS,
  type SqliteDatabaseReceipt,
} from '../../../src/storage/sqlite/connection.js';

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'cm-sqlite-l1-'));
const valueOf = (row: Record<string, unknown> | undefined, key: string): string =>
  String(row === undefined ? '' : row[key] ?? Object.values(row)[0]);

describe('SQLite-L1 memory connection profile', () => {
  it('should enforce WAL, NORMAL, foreign keys, busy timeout and trusted schema', () => {
    const dir = tempDir();
    try {
      const { db, receipt } = openSqliteDatabase({ path: join(dir, 'store.db') });
      try {
        assert.equal(receipt.journalMode, 'wal');
        assert.equal(receipt.synchronous, 1);
        assert.equal(receipt.foreignKeys, 1);
        assert.equal(receipt.busyTimeoutMs, SQLITE_MEMORY_BUSY_TIMEOUT_MS);
        assert.equal(receipt.trustedSchema, 0);
        assert.equal(receipt.extensionLoading, 'disabled');
        assert.equal(receipt.vecVersion, undefined);
        assert.match(receipt.engineVersion, /^\d+\.\d+\.\d+$/);
        assert.equal(valueOf(db.prepare('PRAGMA journal_mode').get() as Record<string, unknown>, 'journal_mode'), 'wal');
        assert.equal(valueOf(db.prepare('PRAGMA synchronous').get() as Record<string, unknown>, 'synchronous'), '1');
        assert.equal(valueOf(db.prepare('PRAGMA foreign_keys').get() as Record<string, unknown>, 'foreign_keys'), '1');
        assert.equal(valueOf(db.prepare('PRAGMA busy_timeout').get() as Record<string, unknown>, 'busy_timeout'), String(SQLITE_MEMORY_BUSY_TIMEOUT_MS));
        assert.equal(valueOf(db.prepare('PRAGMA trusted_schema').get() as Record<string, unknown>, 'trusted_schema'), '0');
        db.exec('CREATE TABLE probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
        db.prepare('INSERT INTO probe(id, value) VALUES(1, ?)').run('first');
        assert.equal((db.prepare('SELECT value FROM probe WHERE id = 1').get() as { value: string }).value, 'first');
        assert.ok(existsSync(join(dir, 'store.db-wal')), 'WAL sidecar must exist after the first write');
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should enforce foreign keys on this connection', () => {
    const dir = tempDir();
    try {
      const { db } = openSqliteDatabase({ path: join(dir, 'fk.db') });
      try {
        db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY)');
        db.exec('CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))');
        assert.throws(() => db.prepare('INSERT INTO child(id, parent_id) VALUES(1, 404)').run(), /FOREIGN KEY constraint failed/);
        db.prepare('INSERT INTO parent(id) VALUES(7)').run();
        db.prepare('INSERT INTO child(id, parent_id) VALUES(1, 7)').run();
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should reapply the profile when reopening an existing store', () => {
    const dir = tempDir();
    try {
      const first = openSqliteDatabase({ path: join(dir, 'reopen.db') });
      first.db.exec('CREATE TABLE kept(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      first.db.prepare('INSERT INTO kept(id, value) VALUES(1, ?)').run('durable');
      first.db.close();
      const second = openSqliteDatabase({ path: join(dir, 'reopen.db') });
      try {
        const receipt: SqliteDatabaseReceipt = second.receipt;
        assert.equal(receipt.journalMode, 'wal');
        assert.equal(receipt.synchronous, 1);
        assert.equal(receipt.foreignKeys, 1);
        assert.equal(receipt.busyTimeoutMs, SQLITE_MEMORY_BUSY_TIMEOUT_MS);
        assert.equal(receipt.trustedSchema, 0);
        assert.equal((second.db.prepare('SELECT value FROM kept WHERE id = 1').get() as { value: string }).value, 'durable');
      } finally {
        second.db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should refuse non-durable or unusable paths', () => {
    assert.throws(() => openSqliteDatabase({ path: ':memory:' }), (error: unknown) => {
      assert.ok(error instanceof CanonicalOwnershipError);
      assert.equal(error.code, 'open-refused');
      return true;
    });
    assert.throws(() => openSqliteDatabase({ path: '' }), (error: unknown) => {
      assert.ok(error instanceof CanonicalOwnershipError);
      assert.equal(error.code, 'open-refused');
      return true;
    });
    assert.throws(() => openSqliteDatabase({ path: '/nonexistent-sql-l1-parent/store.db' }), (error: unknown) => {
      assert.ok(error instanceof CanonicalOwnershipError);
      assert.equal(error.code, 'open-refused');
      return true;
    });
  });

  it('should refuse loudly when the requested sqlite-vec extension cannot load', () => {
    const dir = tempDir();
    try {
      const path = join(dir, 'vec-missing.db');
      assert.throws(() => openSqliteDatabase({ path, vecExtensionPath: join(dir, 'absent-vec0.so') }), (error: unknown) => {
        assert.ok(error instanceof CanonicalOwnershipError);
        assert.equal(error.code, 'open-refused');
        assert.match(error.message, /sqlite-vec extension load refused/);
        return true;
      });
      const { db } = openSqliteDatabase({ path });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should keep extension loading hard-closed without a vec extension request', () => {
    const dir = tempDir();
    try {
      const { db } = openSqliteDatabase({ path: join(dir, 'closed-gate.db') });
      try {
        assert.throws(() => db.loadExtension(join(dir, 'any-vec0.so')), (error: unknown) => {
          assert.equal((error as NodeJS.ErrnoException).code, 'ERR_INVALID_STATE');
          return true;
        });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
