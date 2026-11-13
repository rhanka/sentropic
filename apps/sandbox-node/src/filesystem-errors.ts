import { constants } from 'node:os';
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
