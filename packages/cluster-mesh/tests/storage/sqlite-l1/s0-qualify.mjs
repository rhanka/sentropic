#!/usr/bin/env node
// SQL-L1 Stage-0 extension gate qualification. Runs on the qualified
// container image via `make cluster-mesh-sqlite-s0-qualify` with the pinned
// sqlite-vec tool on NODE_PATH. Fails loudly on any missing capability:
// an exact S0 receipt requires zero skipped cases. Plain node only; the
// registerHooks loader maps the package's .js specifiers onto .ts sources.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire, registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.js')) {
      try { return next(specifier.slice(0, -3) + '.ts', context); } catch { /* fall through */ }
    }
    return next(specifier, context);
  },
});

const { openSqliteDatabase, SQLITE_MEMORY_BUSY_TIMEOUT_MS } = await import(
  new URL('../../../src/storage/sqlite/connection.ts', import.meta.url).href
);

const require = createRequire(import.meta.url);
const sqliteVec = require('sqlite-vec');
const vecExtensionPath = sqliteVec.getLoadablePath();
assert.ok(typeof vecExtensionPath === 'string' && vecExtensionPath.length > 0, 'sqlite-vec loadable path is required');
assert.ok(existsSync(vecExtensionPath), `sqlite-vec loadable must exist: ${vecExtensionPath}`);

const engineAtLeast = (version, floor) => {
  const [a, b, c] = version.split('.').map(Number);
  const [x, y, z] = floor.split('.').map(Number);
  return a !== x ? a > x : b !== y ? b > y : c >= z;
};

const dir = mkdtempSync(join(tmpdir(), 'cm-sqlite-l1-s0-'));
try {
  const { db, receipt } = openSqliteDatabase({ path: join(dir, 's0.db'), vecExtensionPath });
  try {
    assert.ok(engineAtLeast(receipt.engineVersion, '3.51.3'), `engine floor 3.51.3 not met: ${receipt.engineVersion}`);
    assert.equal(receipt.journalMode, 'wal');
    assert.equal(receipt.synchronous, 1);
    assert.equal(receipt.foreignKeys, 1);
    assert.equal(receipt.busyTimeoutMs, SQLITE_MEMORY_BUSY_TIMEOUT_MS);
    assert.equal(receipt.trustedSchema, 0);
    assert.equal(receipt.extensionLoading, 'disabled');
    assert.match(receipt.vecVersion ?? '', /^v\d+\.\d+\.\d+$/, 'verified sqlite-vec version is required');

    // Extension loading stays disabled after the verified load: the only
    // observable DBCONFIG state is the refused load below.
    assert.throws(
      () => db.loadExtension(vecExtensionPath),
      (error) => error?.code === 'ERR_INVALID_STATE',
      'extension gate must be closed after the verified sqlite-vec load',
    );

    // vec0 stays usable with the gate closed (the module registration
    // outlives the load that installed it).
    db.exec('CREATE VIRTUAL TABLE vec_probe USING vec0(embedding float[2])');
    db.prepare('INSERT INTO vec_probe(rowid, embedding) VALUES(1, vec_f32(?))').run('[0.1, 0.2]');
    db.prepare('INSERT INTO vec_probe(rowid, embedding) VALUES(2, vec_f32(?))').run('[0.9, 0.8]');
    const match = db.prepare('SELECT rowid FROM vec_probe WHERE embedding MATCH vec_f32(?) ORDER BY distance LIMIT 1').get('[0.1, 0.2]');
    assert.equal(match?.rowid, 1);

    db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))');
    assert.throws(() => db.prepare('INSERT INTO child(id, parent_id) VALUES(1, 404)').run(), /FOREIGN KEY constraint failed/);
    assert.ok(existsSync(join(dir, 's0.db-wal')), 'WAL sidecar must exist after the first write');

    const receiptJson = {
      nodeVersion: process.version,
      engineVersion: receipt.engineVersion,
      sqliteVecVersion: receipt.vecVersion,
      vecExtensionPath,
      journalMode: receipt.journalMode,
      synchronous: receipt.synchronous,
      foreignKeys: receipt.foreignKeys,
      busyTimeoutMs: receipt.busyTimeoutMs,
      trustedSchema: receipt.trustedSchema,
      extensionLoading: receipt.extensionLoading,
      cases: 10,
      skipped: 0,
    };
    console.log(`S0_QUALIFICATION_RECEIPT ${JSON.stringify(receiptJson)}`);
  } finally {
    db.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
