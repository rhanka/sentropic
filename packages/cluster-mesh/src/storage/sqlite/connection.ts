import { spawn } from 'node:child_process';
import { readSync, writeSync } from 'node:fs';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
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
    send({ op, sql, args, options });
    return receive();
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
      close: () => { try { request('close'); } finally { child.stdin.destroy(); child.stdout.destroy(); child.kill(); } },
    };
  } catch (error) {
    child.stdin.destroy(); child.stdout.destroy(); child.kill();
    throw error;
  }
};
