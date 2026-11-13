import { chmodSync, mkdirSync, mkdtempSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

export const qualificationStorage = '/var/lib/builder/qualification';
export const qualificationDiskMiB = 16;
export const qualificationInodes = 1024;

/** Disk images never belong on /run or in a production tenant's filesystem. */
export function createQualificationDirectory(release: string, kind: 'qd' | 'qi'): string {
  mkdirSync(qualificationStorage, { recursive: true, mode: 0o700 });
  chmodSync(qualificationStorage, 0o700);
  const fs = statfsSync(qualificationStorage, { bigint: true });
  const count = kind === 'qi' ? 4 : 2;
  // 16 MiB quota + 65 MiB ext4 overhead per sandbox, copied base, 16 MiB headroom.
  const required = BigInt(count) * (81n * 1048576n + BigInt(statSync(join(release, 'qualification.erofs')).size)) + 16n * 1048576n;
  if (fs.type === 0x01021994n || fs.bavail * fs.bsize < required || fs.ffree < BigInt(count * 2048)) {
    throw new Error(`qualification storage ${qualificationStorage} requires a disk-backed filesystem, ${required} free bytes and ${count * 2048} free inodes`);
  }
  return mkdtempSync(join(qualificationStorage, `${kind}-`));
}
