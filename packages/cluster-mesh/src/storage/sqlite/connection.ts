import { spawn } from 'node:child_process';
import { readSync, writeSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { StringDecoder } from 'node:string_decoder';
import { CanonicalOwnershipError } from '../instance-ownership.js';
import { SQLITE_OWNER_SOURCE } from './owner-source.js';

export type SqliteConnection = Pick<DatabaseSync, 'exec' | 'close' | 'function'> & {
  prepare(sql: string): Pick<StatementSync, 'get' | 'all' | 'run'>;
  readonly ownerPid: number;
};

/** Synchronous IPC keeps the existing bounded SQLite call contract. The
 * qualified Node tuple supplies blocking child stdio handles; absence of
 * that runtime support refuses open, never falls back to caller SQLite. */
export const openIsolatedConnection = (path: string): SqliteConnection => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', SQLITE_OWNER_SOURCE, path], {
    stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, NODE_OPTIONS: '' },
  });
  child.on('error', () => { /* synchronous IPC reports transport failure */ });
  type Pipe = { _handle?: { fd: number; setBlocking(blocking: boolean): void } };
  const input = (child.stdout as unknown as Pipe)._handle;
  const output = (child.stdin as unknown as Pipe)._handle;
  if (!input || !output) {
    child.kill();
    throw new CanonicalOwnershipError('open-refused', 'SQLite owner requires blocking IPC handles');
  }
  input.setBlocking(true); output.setBlocking(true);
  const callbacks = new Map<string, (...args: never[]) => unknown>();
  let stopped = false;
  const dispose = (): void => { child.stdin.destroy(); child.stdout.destroy(); child.kill(); };
  const decoder = new StringDecoder('utf8');
  let buffered = '';
  const send = (request: unknown): void => {
    const data = Buffer.from(JSON.stringify(request) + '\n');
    for (let offset = 0; offset < data.length;) offset += writeSync(output.fd, data, offset);
  };
  const receive = (): any => {
    for (;;) {
      while (!buffered.includes('\n')) {
        const data = Buffer.alloc(65536);
        const size = readSync(input.fd, data);
        if (!size) throw new CanonicalOwnershipError('terminal-loss', 'SQLite owner process disconnected');
        buffered += decoder.write(data.subarray(0, size));
      }
      const end = buffered.indexOf('\n');
      const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      const reply = JSON.parse(line);
      if (reply.callback) {
        try { send({ op: 'callback-result', result: callbacks.get(reply.callback)!(...reply.args as never[]) }); }
        catch (error) { send({ op: 'callback-result', error: { message: (error as Error).message } }); }
        continue;
      }
      if (reply.error) throw Object.assign(new Error(reply.error.message), reply.error);
      return reply.result;
    }
  };
  const request = (op: string, sql?: string, args?: unknown[], options?: unknown): any => {
    if (stopped) throw new CanonicalOwnershipError('terminal-loss', 'SQLite owner process is closed');
    try {
      send({ op, sql, args, options });
      return receive();
    } catch (error) {
      if (error instanceof CanonicalOwnershipError || ['EPIPE', 'ECONNRESET', 'EBADF'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        stopped = true; dispose();
        throw new CanonicalOwnershipError('terminal-loss', 'SQLite owner process disconnected');
      }
      throw error;
    }
  };
  try {
    const ownerPid = receive() as number;
    return {
      ownerPid,
      exec: sql => { request('exec', sql); },
      prepare: sql => Object.fromEntries(['get', 'all', 'run'].map(op => [op, (...args: unknown[]) => request(op, sql, args)])) as Pick<StatementSync, 'get' | 'all' | 'run'>,
      function: ((name: string, options: unknown, callback?: (...args: never[]) => unknown) => {
        callbacks.set(name, (callback ?? options) as (...args: never[]) => unknown);
        request('function', name, undefined, callback ? options : {});
      }) as DatabaseSync['function'],
      close: () => {
        try { if (!stopped) request('close'); }
        catch (error) { if (!(error instanceof CanonicalOwnershipError)) throw error; }
        finally { stopped = true; dispose(); }
      },
    };
  } catch (error) {
    child.stdin.destroy(); child.stdout.destroy(); child.kill();
    throw error;
  }
};

/** SQL-L1: memory-store connection profile. Unlike the fenced ownership
 * engine (WAL/FULL/EXCLUSIVE with immediate busy refusal), the memory
 * stores use WAL with synchronous=NORMAL and a bounded busy wait for
 * multi-process access, foreign keys enforced and schema trust off. The
 * extension gate stays observable: SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION
 * is enabled only around the verified sqlite-vec load, then disabled again
 * before the handle is returned. */
export const SQLITE_MEMORY_BUSY_TIMEOUT_MS = 5000;

export interface SqliteDatabaseOptions {
  readonly path: string;
  /** Loadable sqlite-vec extension (vec0). Loading is enabled only around
   * this verified load and disabled again before the handle is returned. */
  readonly vecExtensionPath?: string;
}

export interface SqliteDatabaseReceipt {
  readonly engineVersion: string;
  readonly journalMode: string;
  readonly synchronous: number;
  readonly foreignKeys: number;
  readonly busyTimeoutMs: number;
  readonly trustedSchema: number;
  readonly extensionLoading: 'disabled';
  readonly vecVersion: string | undefined;
}

export interface SqliteDatabase {
  readonly db: DatabaseSync;
  readonly receipt: SqliteDatabaseReceipt;
}

const readMemoryPragma = (db: DatabaseSync, name: string): string => {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  return String(row === undefined ? '' : row[name.toLowerCase()] ?? Object.values(row)[0]);
};

export const openSqliteDatabase = (options: SqliteDatabaseOptions): SqliteDatabase => {
  if (typeof options.path !== 'string' || options.path.length === 0 || options.path === ':memory:') {
    throw new CanonicalOwnershipError('open-refused', 'durable SQLite memory storage requires a file path');
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(options.path, { allowExtension: options.vecExtensionPath !== undefined });
  } catch (error) {
    throw new CanonicalOwnershipError('open-refused', `SQLite memory open refused: ${(error as Error).message}`);
  }
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`PRAGMA busy_timeout = ${SQLITE_MEMORY_BUSY_TIMEOUT_MS}`);
    db.exec('PRAGMA trusted_schema = OFF');
    const journalMode = readMemoryPragma(db, 'journal_mode');
    const synchronous = readMemoryPragma(db, 'synchronous');
    const foreignKeys = readMemoryPragma(db, 'foreign_keys');
    const busyTimeout = readMemoryPragma(db, 'busy_timeout');
    const trustedSchema = readMemoryPragma(db, 'trusted_schema');
    if (journalMode.toLowerCase() !== 'wal') throw new CanonicalOwnershipError('open-refused', `WAL not effective: ${journalMode}`);
    if (synchronous !== '1') throw new CanonicalOwnershipError('open-refused', `NORMAL not effective: ${synchronous}`);
    if (foreignKeys !== '1') throw new CanonicalOwnershipError('open-refused', `foreign keys not effective: ${foreignKeys}`);
    if (busyTimeout !== String(SQLITE_MEMORY_BUSY_TIMEOUT_MS)) throw new CanonicalOwnershipError('open-refused', `busy_timeout not effective: ${busyTimeout}`);
    if (trustedSchema !== '0') throw new CanonicalOwnershipError('open-refused', `trusted_schema OFF not effective: ${trustedSchema}`);
    let vecVersion: string | undefined;
    if (options.vecExtensionPath !== undefined) {
      if (typeof options.vecExtensionPath !== 'string' || options.vecExtensionPath.length === 0) {
        throw new CanonicalOwnershipError('open-refused', 'sqlite-vec extension requires a loadable path');
      }
      try {
        db.enableLoadExtension(true);
        try {
          db.loadExtension(options.vecExtensionPath);
        } finally {
          db.enableLoadExtension(false);
        }
      } catch (error) {
        throw new CanonicalOwnershipError('open-refused', `sqlite-vec extension load refused: ${(error as Error).message}`);
      }
      try {
        vecVersion = String((db.prepare('SELECT vec_version() AS version').get() as { version: unknown }).version ?? '');
      } catch {
        vecVersion = '';
      }
      if (vecVersion.length === 0) throw new CanonicalOwnershipError('open-refused', 'sqlite-vec load not verified: vec_version() unavailable');
      let gateDisabled = false;
      try {
        db.loadExtension(options.vecExtensionPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_INVALID_STATE') gateDisabled = true;
        else throw error;
      }
      if (!gateDisabled) throw new CanonicalOwnershipError('open-refused', 'sqlite extension loading is not disabled after the verified sqlite-vec load');
    }
    return {
      db,
      receipt: {
        engineVersion: String((db.prepare('SELECT sqlite_version() AS version').get() as { version: unknown }).version),
        journalMode,
        synchronous: Number(synchronous),
        foreignKeys: Number(foreignKeys),
        busyTimeoutMs: Number(busyTimeout),
        trustedSchema: Number(trustedSchema),
        extensionLoading: 'disabled',
        vecVersion,
      },
    };
  } catch (error) {
    try { db.close(); } catch { /* closing after a refused open must not mask the refusal */ }
    throw error;
  }
};
