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

/** Child exit statuses do not carry the errno of truncate/mkfs's failing syscall.
 * Reserve enough tenant blocks for the complete image (including ext4 overhead),
 * and recheck on failure to catch concurrent exhaustion without localized stderr.
 */
export function tenantFilesystemCommand(path: string, bytes: number, execute: () => void): void {
  const exhausted = () => {
    const fs = statfsSync(path, { bigint: true });
    return fs.bavail * fs.bsize < BigInt(bytes) || fs.ffree === 0n;
  };
  const quota = () => new ExecutionNodeError('tenant_quota_exceeded', 'tenant volume capacity exhausted');
  if (exhausted()) throw quota();
  try { execute(); }
  catch (error) {
    // Preserve the original command error if the volume cannot be inspected.
    let full = false;
    try { full = exhausted(); } catch { /* no capacity evidence */ }
    if (full) throw quota();
    throwFilesystemError(error);
  }
}
