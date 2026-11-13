import { constants } from 'node:os';
import { statfsSync } from 'node:fs';
import { ExecutionNodeError } from './errors.js';

export function isEdquot(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, errno } = error as NodeJS.ErrnoException;
  return code === 'EDQUOT' || errno === -constants.errno.EDQUOT;
}

/** Preserve unrelated failures; disk exhaustion has the contractual quota outcome. */
export function throwFilesystemError(error: unknown): never {
  const value = error as NodeJS.ErrnoException | undefined;
  if (isEdquot(error) || value?.code === 'ENOSPC' || value?.errno === -constants.errno.ENOSPC) {
    throw new ExecutionNodeError('tenant_quota_exceeded', 'sandbox disk quota exhausted');
  }
  throw error;
}

/** Admission checks capacity, without reserving it or diagnosing later failures. */
export function tenantFilesystemCommand(path: string, bytes: number, execute: () => void): void {
  const quota = () => new ExecutionNodeError('tenant_quota_exceeded', 'tenant volume capacity exhausted');
  const fs = statfsSync(path, { bigint: true });
  if (fs.bavail * fs.bsize < BigInt(bytes) || fs.ffree === 0n) throw quota();
  try { execute(); }
  catch (error) {
    const child = error as (NodeJS.ErrnoException & { signal?: string; killed?: boolean; stderr?: string | Buffer }) | undefined;
    if (child?.signal || child?.killed || child?.code === 'ETIMEDOUT'
      || child?.errno === -constants.errno.ETIMEDOUT) throw error;
    // Children run in the C locale; exit status alone has no syscall errno.
    if (/No space left on device|Disk quota exceeded/.test(child?.stderr?.toString() ?? '')) throw quota();
    if (isEdquot(error) || child?.code === 'ENOSPC' || child?.errno === -constants.errno.ENOSPC) throw quota();
    // Secondary evidence only: fixed 1 MiB / one inode, independent of image size.
    let full = false;
    try {
      const remaining = statfsSync(path, { bigint: true });
      full = remaining.bavail * remaining.bsize <= 1048576n || remaining.ffree <= 1n;
    } catch { /* no capacity evidence; preserve the command error */ }
    if (full) throw quota();
    throw error;
  }
}
