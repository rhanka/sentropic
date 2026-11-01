import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ensure } from './seat-admission.ts';
import type { SeatState } from './seat-admission.ts';
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Only the single writer owns this directory. A stale lock fences recovery.
export class DurableStore<T = SeatState> {
  path: string; tail: Promise<unknown> = Promise.resolve();
  constructor(path: string) { this.path = path; }
  async read(): Promise<T> {
    try {
      const stat = await lstat(this.path);
      ensure(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= 10 * 1024 * 1024, 'state-corrupt');
      const envelope = JSON.parse(await readFile(this.path, 'utf8'));
      ensure(envelope.version === 1 && envelope.digest === digest(envelope.state)
        && envelope.state?.version === 1, 'state-corrupt');
      return envelope.state;
    } catch (error) {
      throw new Error((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'state-unavailable' : 'state-corrupt');
    }
  }
  async write(state: T) {
    const temporary = `${this.path}.${randomUUID()}`;
    const fd = await open(temporary, 'wx', 0o600);
    try {
      await fd.writeFile(JSON.stringify({ version: 1, digest: digest(state), state })); await fd.sync();
    } finally { await fd.close(); }
    await rename(temporary, this.path);
    const dir = await open(dirname(this.path), 'r'); try { await dir.sync(); } finally { await dir.close(); }
  }
  async exclusive<R>(operation: () => Promise<R>): Promise<R> {
    const work = this.tail.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      let lock;
      try { lock = await open(`${this.path}.lock`, 'wx', 0o600); }
      catch { throw new Error('state-writer-busy'); }
      try { return await operation(); }
      finally { await lock.close(); await unlink(`${this.path}.lock`); }
    });
    this.tail = work; return work;
  }
  async bootstrap(state: T) {
    return this.exclusive(async () => {
      try { await lstat(this.path); } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') { await this.write(state); return; }
        throw e;
      }
      throw new Error('state-already-initialized');
    });
  }
  async transact<R>(operation: (state: T) => R | Promise<R>): Promise<R> {
    return this.exclusive(async () => {
      const state = await this.read(); const result = await operation(state);
      await this.write(state); return result;
    });
  }
}
