import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Single service writer; atomic replacement and parent fsync precede listening. */
export function nextNodeEpoch(root = '/var/lib/builder'): number {
  const path = join(root, 'node-epoch');
  const previous = existsSync(path) ? Number(readFileSync(path, 'utf8').trim()) : 0;
  if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) throw new Error('invalid persisted node epoch');
  const epoch = previous + 1;
  writeFileSync(`${path}.next`, `${epoch}\n`, { mode: 0o600 });
  const file = openSync(`${path}.next`, 'r');
  try { fsyncSync(file); } finally { closeSync(file); }
  renameSync(`${path}.next`, path);
  const directory = openSync(root, 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return epoch;
}

export function hostBudget(memTotalBytes: number) {
  const hostMemory = { memTotalBytes, memTotalFloorMiB: Math.floor(memTotalBytes / 1048576),
    hostBaseMiB: 512, agentMemoryMaxMiB: 192, unallocatedMarginMiB: 171,
    zramNominalMiB: 1024, zramMemLimitMiB: 128 } as const;
  return { hostMemory, reservableMiB: Math.min(2944, Math.max(0, hostMemory.memTotalFloorMiB - 875)) };
}
