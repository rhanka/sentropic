// SQLite open guard and G3 ownership engine (lot 1). node:sqlite only.
// The engine check runs before WAL; effective parameters are read back,
// never assumed from the requested setting.

import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CanonicalInstanceRegistry, CanonicalOwnershipError, type CanonicalInstanceHandle } from '../instance-ownership.js';

export const SQLITE_MIN_ENGINE = '3.51.3';
export const SQLITE_SCHEMA_VERSION = '1';

const parseEngine = (version: string): [number, number, number] => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new CanonicalOwnershipError('open-refused', `unreadable SQLite engine version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const engineAtLeast = (version: string, floor: string): boolean => {
  const [a, b, c] = parseEngine(version);
  const [x, y, z] = parseEngine(floor);
  return a !== x ? a > x : b !== y ? b > y : c >= z;
};

export interface SqliteBackportQualification {
  readonly version: string;
  readonly imageDigest: string;
  readonly note: string;
}

export interface SqliteOpenOptions {
  readonly path: string;
  readonly storeKey?: string;
  readonly instanceId?: string;
  readonly registry?: CanonicalInstanceRegistry;
  readonly qualifiedBackport?: SqliteBackportQualification;
  /** Owning module: persisted at creation and validated on every reopen so
   * an existing file is never reinterpreted under another module. */
  readonly moduleId?: string;
}

export interface SqliteOpenReceipt {
  readonly nodeVersion: string;
  readonly engineVersion: string;
  readonly realPath: string;
  readonly journalMode: string;
  readonly synchronous: string;
  readonly lockingMode: string;
  readonly instanceId: string;
  readonly storageEpoch: string;
  readonly schemaVersion: string;
  readonly openedAt: string;
  /** Kernel lock-liveness posture: `procfs` verifies the POSIX WRITE lock
   * on Linux before every guarded call; `unavailable` keeps only the
   * ownership-row check on platforms without /proc/locks. */
  readonly lockLiveness: 'procfs' | 'unavailable';
}

export interface SqliteEngine {
  readonly db: DatabaseSync;
  readonly handle: CanonicalInstanceHandle;
  readonly receipt: SqliteOpenReceipt;
  assertOwnership(): void;
  close(): void;
}

// Process-wide open registry, keyed by canonical path. POSIX locks do not
// exclude two opens from the same process, so SQLite alone cannot refuse a
// second live holder here; cross-process exclusion stays with EXCLUSIVE.
// Entries from another pid are fork copies and are superseded.
const OPEN_ENGINES = new Map<string, number>();

const canonicalPathOf = (path: string): string => {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    try {
      return `${realpathSync(dirname(resolved))}/${basename(resolved)}`;
    } catch {
      throw new CanonicalOwnershipError('open-refused', `SQLite parent directory is not usable: ${path}`);
    }
  }
};

const isBusyError = (error: unknown): boolean => /busy|locked/i.test((error as Error)?.message ?? '');

interface StoreFileIdentity {
  readonly dev: number;
  readonly ino: number;
}

const storeFileIdentityOf = (path: string): StoreFileIdentity => {
  try {
    const identity = statSync(path);
    return { dev: identity.dev, ino: identity.ino };
  } catch {
    throw new CanonicalOwnershipError('terminal-loss', `SQLite store file is not usable: ${path}`);
  }
};

// Kernel lock liveness without touching the database file: reading
// /proc/locks opens procfs only, never the store, so the probe cannot
// disturb the POSIX locks it verifies. SQLite keeps a WRITE lock on the
// store inode while EXCLUSIVE is held; a foreign close of another fd on
// the same inode drops every POSIX lock of this process, and the
// connection would otherwise keep serving cached state.
const lockLineFor = (line: string, pid: number, ino: number): boolean => {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 7 || fields[4] !== String(pid)) return false;
  const target = (fields[5] ?? '').split(':');
  if (target.length !== 3 || target[2] !== String(ino)) return false;
  return fields[3] === 'WRITE' || fields[3] === 'RW';
};

const holdsPosixWriteLock = (locks: string, pid: number, ino: number): boolean =>
  locks.split('\n').some((line) => lockLineFor(line, pid, ino));

const readPragma = (db: DatabaseSync, name: string): string => {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  const value = row === undefined ? undefined : row[name.toLowerCase()] ?? Object.values(row)[0];
  return String(value);
};

const SQLITE_MODULE_KEY = 'sqlite_module_id';

const gateModuleIdentity = (db: DatabaseSync, moduleId: string | undefined): void => {
  if (moduleId === undefined) return;
  if (moduleId.length === 0) throw new CanonicalOwnershipError('open-refused', 'sqlite open requires a non-empty moduleId');
  const row = db.prepare('SELECT value FROM cm_meta WHERE key = ?').get(SQLITE_MODULE_KEY) as
    | { value: string }
    | undefined;
  if (row !== undefined) {
    if (row.value !== moduleId) {
      throw new CanonicalOwnershipError('open-refused', `SQLite store owned by module ${row.value}: refused for ${moduleId}`);
    }
    return;
  }
  const scopesTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cm_scopes'").get() as
    | { name: string }
    | undefined;
  const populated =
    scopesTable !== undefined &&
    (db.prepare('SELECT COUNT(*) AS count FROM cm_scopes').get() as { count: number }).count > 0;
  if (populated) throw new CanonicalOwnershipError('open-refused', 'SQLite store has state without a recorded owning module');
  db.prepare('INSERT INTO cm_meta(key, value) VALUES(?, ?)').run(SQLITE_MODULE_KEY, moduleId);
};

export const openSqliteEngine = (options: SqliteOpenOptions): SqliteEngine => {
  if (typeof options.path !== 'string' || options.path.length === 0 || options.path === ':memory:') {
    throw new CanonicalOwnershipError('open-refused', 'durable SQLite storage requires a file path');
  }
  const registry = options.registry ?? new CanonicalInstanceRegistry();
  const storeKey = options.storeKey ?? `sqlite:${options.path}`;
  const canonicalPath = canonicalPathOf(options.path);
  if (OPEN_ENGINES.get(canonicalPath) === process.pid) {
    throw new CanonicalOwnershipError('instance-busy', `SQLite store already open in this process: ${canonicalPath}`);
  }
  OPEN_ENGINES.set(canonicalPath, process.pid);
  const db = new DatabaseSync(options.path);
  try {
    let engineVersion: string;
    let journalMode: string;
    let lockingMode: string;
    try {
      db.exec('PRAGMA busy_timeout = 0');
      engineVersion = String((db.prepare('SELECT sqlite_version() AS version').get() as { version: unknown }).version);
      const qualified =
        engineAtLeast(engineVersion, SQLITE_MIN_ENGINE) ||
        (options.qualifiedBackport !== undefined &&
          options.qualifiedBackport.version === engineVersion &&
          options.qualifiedBackport.imageDigest.length > 0 &&
          options.qualifiedBackport.note.length > 0);
      if (!qualified) throw new CanonicalOwnershipError('open-refused', `refused engine ${engineVersion}: minimum is ${SQLITE_MIN_ENGINE}`);
      db.exec('PRAGMA locking_mode = EXCLUSIVE');
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = FULL');
      journalMode = readPragma(db, 'journal_mode');
      const synchronous = readPragma(db, 'synchronous');
      lockingMode = readPragma(db, 'locking_mode');
      if (journalMode.toLowerCase() !== 'wal') throw new CanonicalOwnershipError('open-refused', `WAL not effective: ${journalMode}`);
      if (synchronous !== '2') throw new CanonicalOwnershipError('open-refused', `FULL not effective: ${synchronous}`);
      if (lockingMode.toLowerCase() !== 'exclusive') throw new CanonicalOwnershipError('open-refused', `EXCLUSIVE not effective: ${lockingMode}`);
      db.exec('CREATE TABLE IF NOT EXISTS cm_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      db.exec('CREATE TABLE IF NOT EXISTS cm_ownership(id INTEGER PRIMARY KEY CHECK(id = 1), instance_id TEXT NOT NULL, epoch TEXT NOT NULL)');
      gateModuleIdentity(db, options.moduleId);
    } catch (error) {
      if (error instanceof CanonicalOwnershipError) throw error;
      if (isBusyError(error)) throw new CanonicalOwnershipError('instance-busy', `live holder present: ${(error as Error).message}`);
      throw error;
    }
    let won: { instanceId: string; epoch: number };
    try { db.exec('BEGIN IMMEDIATE'); } catch (error) {
      if (isBusyError(error)) throw new CanonicalOwnershipError('instance-busy', `live holder present: ${(error as Error).message}`);
      throw error;
    }
    try {
      const row = db.prepare('SELECT instance_id AS instanceId, epoch FROM cm_ownership WHERE id = 1').get() as
        | { instanceId: string; epoch: string } | undefined;
      won = row === undefined
        ? { instanceId: options.instanceId ?? `instance-${randomUUID()}`, epoch: 1 }
        : { instanceId: options.instanceId ?? String(row.instanceId), epoch: Number(row.epoch) + 1 };
      db.prepare('INSERT INTO cm_ownership(id, instance_id, epoch) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET instance_id = excluded.instance_id, epoch = excluded.epoch').run(won.instanceId, String(won.epoch));
      db.prepare("INSERT INTO cm_meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO NOTHING").run(SQLITE_SCHEMA_VERSION);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw error;
    }
    let handle: CanonicalInstanceHandle;
    try { handle = registry.acquire(storeKey, String(won.epoch)); } catch (error) { db.close(); throw error; }
    if (handle.instanceId !== won.instanceId) {
      db.prepare('UPDATE cm_ownership SET instance_id = ? WHERE id = 1').run(handle.instanceId);
      won = { instanceId: handle.instanceId, epoch: won.epoch };
    }
    const lockLiveness = process.platform === 'linux' ? ('procfs' as const) : ('unavailable' as const);
    const fileId = storeFileIdentityOf(canonicalPath);
    const receipt: SqliteOpenReceipt = Object.freeze({ nodeVersion: process.version, engineVersion,
      realPath: canonicalPath, journalMode: journalMode.toLowerCase(), synchronous: 'FULL',
      lockingMode: lockingMode.toLowerCase(), instanceId: won.instanceId, storageEpoch: String(won.epoch),
      schemaVersion: SQLITE_SCHEMA_VERSION, openedAt: new Date().toISOString(), lockLiveness });
    let closed = false;
    const assertOwnership = (): void => {
      if (closed) throw new CanonicalOwnershipError('terminal-loss', 'sqlite engine is closed');
      // File identity first: a replace/rename invalidates every cached read.
      const identity = storeFileIdentityOf(canonicalPath);
      if (identity.dev !== fileId.dev || identity.ino !== fileId.ino) {
        registry.markTerminal(handle);
        throw new CanonicalOwnershipError('terminal-loss', 'ownership lost: store file was replaced');
      }
      // Kernel lock liveness before trusting the connection's cached state:
      // a foreign close drops the POSIX lock while SQLite still believes it
      // holds EXCLUSIVE. stat/procs reads never open the store file.
      if (lockLiveness === 'procfs') {
        let locks: string | null = null;
        try { locks = readFileSync('/proc/locks', 'utf8'); } catch { locks = null; }
        if (locks === null || !holdsPosixWriteLock(locks, process.pid, fileId.ino)) {
          registry.markTerminal(handle);
          throw new CanonicalOwnershipError('terminal-loss', 'ownership lost: POSIX lock is no longer held');
        }
      }
      const current = db.prepare('SELECT instance_id AS instanceId, epoch FROM cm_ownership WHERE id = 1').get() as
        | { instanceId: string; epoch: string } | undefined;
      if (current?.instanceId !== won.instanceId || current?.epoch !== String(won.epoch)) {
        registry.markTerminal(handle);
        throw new CanonicalOwnershipError('terminal-loss', 'ownership lost: epoch superseded');
      }
      registry.verify(handle);
    };
    return {
      db,
      handle,
      receipt,
      assertOwnership,
      close: (): void => {
        if (closed) return;
        closed = true;
        registry.release(handle);
        OPEN_ENGINES.delete(canonicalPath);
        db.close();
      },
    };
  } catch (error) {
    if (OPEN_ENGINES.get(canonicalPath) === process.pid) OPEN_ENGINES.delete(canonicalPath);
    try { db.close(); } catch { /* close best effort */ }
    throw error;
  }
};
