import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HostCommand, Bundle } from './bundle.js';

export function validateDiskQuota(mib: number | undefined, inodes: number | undefined): void {
  if (!Number.isSafeInteger(mib) || mib! < 1 || mib! > 16384
    || !Number.isSafeInteger(inodes) || inodes! < 1 || inodes! > 1_000_000) throw new Error('invalid sandbox disk quota');
}

/** Private ext4 filesystem: project 1 covers upper/work/output together. */
export function mountQuotaVolume(bundle: Bundle, mib: number | undefined, inodes: number | undefined, run: HostCommand): string {
  validateDiskQuota(mib, inodes);
  const image = join(bundle.path, 'writable.ext4'), volume = join(bundle.path, 'writable');
  mkdirSync(volume, { recursive: true, mode: 0o700 });
  const overheadMiB = 64 + Math.ceil(inodes! * 256 / 1048576);
  run('truncate', ['-s', `${mib! + overheadMiB}M`, image]);
  run('mkfs.ext4', ['-F', '-q', '-m', '0', '-O', 'quota,project', '-E', 'quotatype=prjquota', image]);
  run('mount', ['-t', 'ext4', '-o', 'loop,prjquota,nosuid,nodev', image, volume]);
  bundle.mounted.push(volume);
  run('chattr', ['-p', '1', '+P', volume]);
  run('setquota', ['-P', '1', '0', String(mib! * 1024), '0', String(inodes), volume]);
  return volume;
}
