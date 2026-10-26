import { chmodSync, existsSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
export class WorkflowStoreError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'WorkflowStoreError'; }
}
export const refuse = (code: string): never => { throw new WorkflowStoreError(code); };
export function supportsRuntime(version: string, args: readonly string[], options: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || [...args, options].some(arg => /sqlite/.test(arg))) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return (major === 22 && minor >= 13) || (major === 23 && minor >= 4) || major === 24;
}
export async function openDriver(path: string): Promise<DatabaseSync> {
  if (!supportsRuntime(process.versions.node, process.execArgv, process.env.NODE_OPTIONS ?? '') ||
      !isAbsolute(path) || path.includes('\0')) return refuse('STORE_UNAVAILABLE');
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.()) return refuse('STORE_UNAVAILABLE');
  }
  let db: DatabaseSync | undefined;
  try {
    const { DatabaseSync: Driver } = await import('node:sqlite');
    db = new Driver(path);
    chmodSync(path, 0o600);
    db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    return db;
  } catch { db?.close(); return refuse('STORE_UNAVAILABLE'); }
}
