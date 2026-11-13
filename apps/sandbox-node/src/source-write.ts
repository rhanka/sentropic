import { constants, openSync, closeSync, writeFileSync, mkdirSync, fsyncSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExecutionNodeDevScope } from './contract.js';
import { checkWritePath } from './mounts.js';
import { throwFilesystemError } from './filesystem-errors.js';

/** The sandbox cannot mutate this tree: its OCI workspace bind is read-only. */
export function writeSource(root: string, path: string, bytes: Buffer, scope: ExecutionNodeDevScope): void {
  try {
  if (bytes.length > 1024 * 1024) throw new Error('source write exceeds 1 MiB');
  const relative = checkWritePath(path, scope, root);
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  checkWritePath(path, scope, root);
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  } catch (error) { throwFilesystemError(error); }
}
