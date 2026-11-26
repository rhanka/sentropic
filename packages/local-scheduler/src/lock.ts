import { lstatSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { LocalTaskLockSummaryV1 } from './health.js';
import { captureSnapshot, releaseOwnedLock, snapshotsEqual, tryPublishExclusive, writeExclusiveTmp } from './lock-io.js';
import { classifyLockReclaimability, defaultLockSystemDeps, safeLstat } from './lock-probes.js';
import { parseLockRecord, type LocalTaskLockRecordV1, type LockSystemDeps } from './lock-types.js';
import { ensurePrivateDir, fsyncDirBestEffort } from './state-dir.js';

export interface TaskLockHandle {
  readonly lockPath: string;
  readonly nonce: string;
  transitionToSpawning(): void;
  transitionToRunning(childPid: number): void;
  release(): void;
}
function buildRecord(taskId: string, deps: LockSystemDeps): LocalTaskLockRecordV1 {
  return {
    v: 1, taskId, pid: deps.pid, pidStartTime: deps.readSelfStartTime() ?? 'unknown',
    pidNs: deps.readSelfPidNs(), timeNs: deps.readSelfTimeNs(), phase: 'acquired',
    childPid: null, childPgid: null, host: deps.hostname(), bootId: deps.readBootId(),
    nonce: randomBytes(16).toString('hex'), acquiredAt: new Date(deps.nowMs()).toISOString(),
  };
}
function acquireInternal(locksDir: string, lockPath: string, taskId: string, deps: LockSystemDeps, depth: number): TaskLockHandle | null {
  let record = buildRecord(taskId, deps);
  const pubHooks = deps.onPublishWrite ? { onWrite: deps.onPublishWrite } : undefined;
  let published = tryPublishExclusive(locksDir, lockPath, record, pubHooks);
  if (published === 'exists') {
    const snap1 = captureSnapshot(lockPath, taskId);
    if (!snap1) {
      published = tryPublishExclusive(locksDir, lockPath, record, pubHooks);
    } else {
      if (classifyLockReclaimability(snap1.record, snap1.st, locksDir, deps) !== 'dead' || depth >= 4) return null;
      const guard = acquireInternal(locksDir, `${lockPath}.reclaim`, taskId, deps, depth + 1);
      if (!guard) return null;
      let reclaimed = false;
      try {
        const snap2 = captureSnapshot(lockPath, taskId);
        if (snap2 && snapshotsEqual(snap1, snap2) && classifyLockReclaimability(snap2.record, snap2.st, locksDir, deps) === 'dead') {
          const qPath = `${lockPath}.quarantine.${record.nonce}`;
          writeExclusiveTmp(qPath, snap2.raw);
          let removeQuarantine = false;
          try {
            fsyncDirBestEffort(locksDir);
            const snap3 = captureSnapshot(lockPath, taskId);
            if (snap3 && snapshotsEqual(snap1, snap3)) {
              deps.onBeforeReclaimUnlink?.({ lockPath, quarantinePath: qPath });
              (deps.unlinkLockFn ?? unlinkSync)(lockPath);
              fsyncDirBestEffort(locksDir);
              reclaimed = true;
            }
            removeQuarantine = true;
          } finally {
            if (removeQuarantine) {
              try { unlinkSync(qPath); } catch { /* ignore quarantine cleanup */ }
            }
          }
        }
      } finally {
        guard.release();
      }
      if (!reclaimed) return null;
      published = tryPublishExclusive(locksDir, lockPath, record, pubHooks);
    }
  }
  if (published === 'exists') return null;
  let ownedGen = { dev: published.dev, ino: published.ino };
  let seq = 0;
  const rewrite = (patch: Partial<LocalTaskLockRecordV1>): void => {
    record = { ...record, ...patch };
    const tmp = `${lockPath}.${record.pid}.${record.nonce}.${++seq}.tmp`;
    writeExclusiveTmp(tmp, `${JSON.stringify(record, null, 2)}\n`);
    try { renameSync(tmp, lockPath); } catch (err) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw err;
    }
    fsyncDirBestEffort(locksDir);
    const st = lstatSync(lockPath);
    ownedGen = { dev: st.dev, ino: st.ino };
  };
  return {
    lockPath, nonce: record.nonce,
    transitionToSpawning: () => rewrite({ phase: 'spawning' }),
    transitionToRunning: (childPid) => rewrite({ phase: 'running', childPid, childPgid: childPid }),
    release: () => releaseOwnedLock(locksDir, lockPath, taskId, record.nonce, ownedGen.dev, ownedGen.ino),
  };
}
/** Acquires the fail-closed namespace-aware single-writer lock for taskId (§2.3). */
export function acquireTaskLock(stateDir: string, taskId: string, deps?: LockSystemDeps): TaskLockHandle | null {
  const locksDir = path.join(stateDir, 'locks');
  ensurePrivateDir(locksDir);
  return acquireInternal(locksDir, path.join(locksDir, `${taskId}.lock`), taskId, deps ?? defaultLockSystemDeps(), 0);
}
export function readTaskLockSummary(stateDir: string, taskId: string): LocalTaskLockSummaryV1 | null | 'unreadable' {
  const lockPath = path.join(stateDir, 'locks', `${taskId}.lock`);
  const st = safeLstat(lockPath);
  if (!st) return null;
  if (st.isSymbolicLink() || !st.isFile()) return 'unreadable';
  try {
    const parsed = parseLockRecord(readFileSync(lockPath, 'utf8'), taskId);
    return parsed ? { pid: parsed.pid, phase: parsed.phase, acquiredAt: parsed.acquiredAt } : 'unreadable';
  } catch {
    return 'unreadable';
  }
}
