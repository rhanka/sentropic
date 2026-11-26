import {
  closeSync, constants, fsyncSync, linkSync, lstatSync, openSync,
  readFileSync, unlinkSync, writeFileSync, type Stats,
} from 'node:fs';
import { parseLockRecord, type LocalTaskLockRecordV1 } from './lock-types.js';
import { fsyncDirBestEffort } from './state-dir.js';

export interface LockSnapshot {
  readonly raw: Buffer;
  readonly st: Stats;
  readonly record: LocalTaskLockRecordV1 | null;
}

export function captureSnapshot(lockPath: string, taskId: string): LockSnapshot | null {
  try {
    const st = lstatSync(lockPath);
    const raw = readFileSync(lockPath);
    return { raw, st, record: parseLockRecord(raw.toString('utf8'), taskId) };
  } catch {
    return null;
  }
}

export function snapshotsEqual(a: LockSnapshot, b: LockSnapshot): boolean {
  return (
    a.st.dev === b.st.dev && a.st.ino === b.st.ino && a.st.size === b.st.size &&
    a.st.mtimeMs === b.st.mtimeMs && a.st.ctimeMs === b.st.ctimeMs &&
    a.st.uid === b.st.uid && a.st.nlink === b.st.nlink &&
    a.record?.nonce === b.record?.nonce && Buffer.compare(a.raw, b.raw) === 0
  );
}

export function writeExclusiveTmp(tmpPath: string, body: string): void {
  const fd = openSync(tmpPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function tryPublishExclusive(locksDir: string, lockPath: string, record: LocalTaskLockRecordV1): Stats | 'exists' {
  const tmpPath = `${lockPath}.${record.pid}.${record.nonce}.tmp`;
  const body = `${JSON.stringify(record, null, 2)}\n`;
  writeExclusiveTmp(tmpPath, body);
  try {
    try {
      linkSync(tmpPath, lockPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return 'exists';
      if (code === 'EPERM' || code === 'EXDEV' || code === 'ENOTSUP') {
        try {
          writeExclusiveTmp(lockPath, body);
        } catch (fbErr) {
          if ((fbErr as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
          throw fbErr;
        }
      } else {
        throw err;
      }
    }
    fsyncDirBestEffort(locksDir);
    return lstatSync(lockPath);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore tmp cleanup */ }
  }
}

export function releaseOwnedLock(locksDir: string, lockPath: string, taskId: string, nonce: string, dev: number, ino: number): void {
  try {
    const st = lstatSync(lockPath);
    const parsed = parseLockRecord(readFileSync(lockPath, 'utf8'), taskId);
    if (parsed?.nonce === nonce && st.dev === dev && st.ino === ino) {
      unlinkSync(lockPath);
      fsyncDirBestEffort(locksDir);
    }
  } catch { /* lock already absent or replaced */ }
}
