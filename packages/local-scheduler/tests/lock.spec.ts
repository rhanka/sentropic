import { chmodSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireTaskLock, readTaskLockSummary } from '../src/lock.js';
import { captureSnapshot, snapshotsEqual, tryPublishExclusive } from '../src/lock-io.js';
import type { LockSystemDeps } from '../src/lock-types.js';

const workspaceTmpRoot = path.resolve(process.cwd(), '..', '..', '.tmp');
const createdDirs: string[] = [];

function makeExt4StateDir(): string {
  mkdirSync(workspaceTmpRoot, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(path.join(workspaceTmpRoot, 'local-scheduler-test-'));
  chmodSync(dir, 0o700);
  createdDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (createdDirs.length > 0) rmSync(createdDirs.pop()!, { recursive: true, force: true });
  try {
    if (readdirSync(workspaceTmpRoot).length === 0) rmdirSync(workspaceTmpRoot);
  } catch { /* ignore */ }
});

const BOOT_A = '11111111-1111-4111-8111-111111111111';
const BOOT_B = '22222222-2222-4222-8222-222222222222';
function makeDeps(over: Partial<LockSystemDeps> = {}): LockSystemDeps {
  return {
    pid: 5000, hostname: () => 'ws-1', geteuid: () => process.getuid?.() ?? 0, nowMs: () => Date.parse('2026-11-25T12:00:00.000Z'),
    readBootId: () => BOOT_A, readSelfStartTime: () => '9999',
    readProcStat: () => ({ state: 'S', startTime: '9999' }), readProcThreads: () => 1,
    readSelfPidNs: () => 'pid:[4026531836]', readSelfTimeNs: () => 'time:[4026531834]',
    readBootTimeMs: () => Date.parse('2026-11-25T00:00:00.000Z'),
    statfsType: () => 0xef53, killZero: () => 'alive', ...over,
  };
}

function seedLock(stateDir: string, taskId: string, record: Record<string, unknown>): string {
  const locksDir = path.join(stateDir, 'locks');
  mkdirSync(locksDir, { recursive: true, mode: 0o700 });
  const p = path.join(locksDir, `${taskId}.lock`);
  writeFileSync(p, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return p;
}

describe('acquireTaskLock & readTaskLockSummary', () => {
  it('acquires, transitions acquired -> spawning -> running, summarizes, and releases cleanly', () => {
    const stateDir = makeExt4StateDir();
    const h = acquireTaskLock(stateDir, 't-1', makeDeps());
    expect(h).not.toBeNull();
    expect(readTaskLockSummary(stateDir, 't-1')?.phase).toBe('acquired');
    h!.transitionToSpawning();
    expect(readTaskLockSummary(stateDir, 't-1')?.phase).toBe('spawning');
    h!.transitionToRunning(7777);
    const raw = JSON.parse(readFileSync(h!.lockPath, 'utf8'));
    expect(raw.phase).toBe('running');
    expect(raw.childPid).toBe(7777);
    expect(raw.childPgid).toBe(7777);
    expect(raw.nonce).toBe(h!.nonce);
    h!.release();
    expect(readTaskLockSummary(stateDir, 't-1')).toBeNull();
  });

  it('refuses reclaim on foreign pidNs (B-5 #1), foreign timeNs (B-5 #3), spawning same boot (B-5 #4), and alive childPgid', () => {
    const stateDir = makeExt4StateDir();
    const baseRec = {
      v: 1, taskId: 't-1', pid: 4000, pidStartTime: '1111', pidNs: 'pid:[4026539999]', timeNs: 'time:[4026531834]',
      phase: 'running', childPid: 4001, childPgid: 4001, host: 'ws-1', bootId: BOOT_A, nonce: 'n1', acquiredAt: '2026-11-25T10:00:00.000Z',
    };
    const lockPath = seedLock(stateDir, 't-1', baseRec);
    const beforeBytes = readFileSync(lockPath, 'utf8');
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ killZero: () => 'esrch' }))).toBeNull();
    expect(readFileSync(lockPath, 'utf8')).toBe(beforeBytes);

    seedLock(stateDir, 't-1', { ...baseRec, pidNs: 'pid:[4026531836]', timeNs: 'time:[4026539999]' });
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'S', startTime: '8888' }), killZero: (p) => (p > 0 ? 'alive' : 'esrch') }))).toBeNull();
    // Positive control for B-5 #3: matching timeNs reclaims PID reuse
    seedLock(stateDir, 't-1', { ...baseRec, pidNs: 'pid:[4026531836]', timeNs: 'time:[4026531834]' });
    const hTimeOk = acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'S', startTime: '8888' }), killZero: (p) => (p > 0 ? 'alive' : 'esrch') }));
    expect(hTimeOk).not.toBeNull();
    hTimeOk!.release();

    seedLock(stateDir, 't-1', { ...baseRec, pidNs: 'pid:[4026531836]', phase: 'spawning', childPid: null, childPgid: null });
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ killZero: () => 'esrch' }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readBootId: () => BOOT_B }))).not.toBeNull();

    seedLock(stateDir, 't-1', { ...baseRec, pidNs: 'pid:[4026531836]' });
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ killZero: (pid) => (pid > 0 ? 'esrch' : 'alive') }))).toBeNull();
  });

  it('refuses reclaim on malformed bootId (m-31 #1), multi-threaded zombie (m-31 #2), kill error, and unqualified fs', () => {
    const stateDir = makeExt4StateDir();
    const rec = {
      v: 1, taskId: 't-1', pid: 4000, pidStartTime: '1111', pidNs: 'pid:[4026531836]', timeNs: 'time:[4026531834]',
      phase: 'running', childPid: 4001, childPgid: 4001, host: 'ws-1', bootId: BOOT_A, nonce: 'n1', acquiredAt: '2026-11-25T10:00:00.000Z',
    };
    seedLock(stateDir, 't-1', rec);
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readBootId: () => 'not-a-uuid', killZero: () => 'alive' }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'Z', startTime: '1111' }), readProcThreads: () => 2, killZero: (p) => (p > 0 ? 'alive' : 'esrch') }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ killZero: (p) => (p > 0 ? 'other' : 'esrch'), readProcStat: () => ({ state: 'S', startTime: '9999' }) }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => null, killZero: (p) => (p > 0 ? 'alive' : 'esrch') }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ killZero: () => 'esrch', statfsType: () => 0x794c7630 }))).toBeNull();

    // Positive controls for m-31 #2, killZero 'other'->'esrch', and readable /proc/<pid>/stat
    const hZombie1 = acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'Z', startTime: '1111' }), readProcThreads: () => 1, killZero: (p) => (p > 0 ? 'alive' : 'esrch') }));
    expect(hZombie1).not.toBeNull();
    hZombie1!.release();
    seedLock(stateDir, 't-1', rec);
    const hKillEsrch = acquireTaskLock(stateDir, 't-1', makeDeps({ killZero: () => 'esrch', readProcStat: () => ({ state: 'S', startTime: '9999' }) }));
    expect(hKillEsrch).not.toBeNull();
    hKillEsrch!.release();
    seedLock(stateDir, 't-1', rec);
    const hStatOk = acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'S', startTime: '9999' }), killZero: (p) => (p > 0 ? 'alive' : 'esrch') }));
    expect(hStatOk).not.toBeNull();
    hStatOk!.release();
  });

  it('reclaims dead runner, Threads:1 zombie, and opaque pre-boot nlink=1 files on qualified ext4', () => {
    const stateDir = makeExt4StateDir();
    const rec = {
      v: 1, taskId: 't-1', pid: 4000, pidStartTime: '1111', pidNs: 'pid:[4026531836]', timeNs: 'time:[4026531834]',
      phase: 'running', childPid: 4001, childPgid: 4001, host: 'ws-1', bootId: BOOT_A, nonce: 'n1', acquiredAt: '2026-11-25T10:00:00.000Z',
    };
    seedLock(stateDir, 't-1', rec);
    const h1 = acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'Z', startTime: '1111' }), readProcThreads: () => 1, killZero: (pid) => (pid > 0 ? 'alive' : 'esrch') }));
    expect(h1).not.toBeNull();
    h1!.release();

    const lockPath = path.join(stateDir, 'locks', 't-1.lock');
    writeFileSync(lockPath, '{opaque', { mode: 0o600 });
    const oldTime = new Date('2026-11-24T00:00:00.000Z');
    utimesSync(lockPath, oldTime, oldTime);
    const hardlink = path.join(stateDir, 'locks', 'extra-link');
    linkSync(lockPath, hardlink);
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readBootTimeMs: () => Date.now() + 60_000 }))).toBeNull();
    rmSync(hardlink);
    utimesSync(lockPath, oldTime, oldTime);
    const h2 = acquireTaskLock(stateDir, 't-1', makeDeps({ readBootTimeMs: () => Date.now() + 60_000 }));
    expect(h2).not.toBeNull();
    h2!.release();
  });

  it('respects guard-lock <taskId>.lock.reclaim serialization', () => {
    const stateDir = makeExt4StateDir();
    seedLock(stateDir, 't-1', {
      v: 1, taskId: 't-1', pid: 4000, pidStartTime: '1111', pidNs: 'pid:[4026531836]', timeNs: 'time:[4026531834]',
      phase: 'acquired', childPid: null, childPgid: null, host: 'ws-1', bootId: BOOT_A, nonce: 'n1', acquiredAt: '2026-11-25T10:00:00.000Z',
    });
    mkdirSync(path.join(stateDir, 'locks'), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(stateDir, 'locks', 't-1.lock.reclaim'), JSON.stringify({
      v: 1, taskId: 't-1', pid: 4002, pidStartTime: '2222', pidNs: 'pid:[4026531836]', timeNs: 'time:[4026531834]',
      phase: 'acquired', childPid: null, childPgid: null, host: 'ws-1', bootId: BOOT_A, nonce: 'g1', acquiredAt: '2026-11-25T11:00:00.000Z',
    }), { mode: 0o600 });
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({
      killZero: (p) => (p === 4000 ? 'esrch' : 'alive'),
      readProcStat: (p) => ({ state: 'S', startTime: p === 4002 ? '2222' : '9999' }),
    }))).toBeNull();
  });

  it('fails closed on host/namespace nulls, wall-clock jump, foreign uid, fresh opaque, depth>=4, and snapshot mismatch', () => {
    const stateDir = makeExt4StateDir();
    const baseRec = {
      v: 1, taskId: 't-1', pid: 4000, pidStartTime: '1111', pidNs: 'pid:[4026531836]', timeNs: 'time:[4026531834]',
      phase: 'running', childPid: 4001, childPgid: 4001, host: 'ws-1', bootId: BOOT_A, nonce: 'n1', acquiredAt: '2026-11-25T00:00:00.000Z',
    };
    const lockPath = seedLock(stateDir, 't-1', baseRec);
    // Different host, null pidNs, null currentPidNs, null timeNs, wall-clock jump past timeout while alive, foreign uid, null statfs
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ hostname: () => 'ws-2', killZero: () => 'esrch' }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readSelfPidNs: () => null, killZero: () => 'esrch' }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readSelfTimeNs: () => null, readProcStat: () => ({ state: 'S', startTime: '8888' }), killZero: (p) => (p > 0 ? 'alive' : 'esrch') }))).toBeNull();
    const hTimeRestored = acquireTaskLock(stateDir, 't-1', makeDeps({ readSelfTimeNs: () => 'time:[4026531834]', readProcStat: () => ({ state: 'S', startTime: '8888' }), killZero: (p) => (p > 0 ? 'alive' : 'esrch') }));
    expect(hTimeRestored).not.toBeNull();
    hTimeRestored!.release();
    seedLock(stateDir, 't-1', baseRec);
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ nowMs: () => Date.parse('2026-11-26T12:00:00.000Z'), readProcStat: () => ({ state: 'S', startTime: '1111' }) }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ geteuid: () => 65534, killZero: () => 'esrch' }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ statfsType: () => null, killZero: () => 'esrch' }))).toBeNull();

    seedLock(stateDir, 't-1', { ...baseRec, pidNs: null });
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ killZero: () => 'esrch' }))).toBeNull();
    seedLock(stateDir, 't-1', { ...baseRec, timeNs: null });
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'S', startTime: '8888' }), killZero: (p) => (p > 0 ? 'alive' : 'esrch') }))).toBeNull();
    seedLock(stateDir, 't-1', { ...baseRec, timeNs: 'time:[4026531834]' });
    const hRecTimeOk = acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'S', startTime: '8888' }), killZero: (p) => (p > 0 ? 'alive' : 'esrch') }));
    expect(hRecTimeOk).not.toBeNull();
    hRecTimeOk!.release();
    seedLock(stateDir, 't-1', { ...baseRec, bootId: 'not-a-uuid' });
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readBootId: () => BOOT_B, readProcStat: () => ({ state: 'S', startTime: '1111' }) }))).toBeNull();

    // Fresh opaque lock file or null bootTimeMs fails closed
    writeFileSync(lockPath, '{opaque', { mode: 0o600 });
    expect(readTaskLockSummary(stateDir, 't-1')).toBe('unreadable');
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readBootTimeMs: () => Date.now() - 60_000 }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readBootTimeMs: () => null }))).toBeNull();

    // Symlink / wrong taskId summary -> unreadable
    const linkLock = seedLock(stateDir, 't-sym', baseRec);
    rmSync(linkLock);
    symlinkSync('/etc/passwd', linkLock);
    expect(readTaskLockSummary(stateDir, 't-sym')).toBe('unreadable');
    seedLock(stateDir, 't-wrong', { ...baseRec, taskId: 'other' });
    expect(readTaskLockSummary(stateDir, 't-wrong')).toBe('unreadable');

    // Depth >= 4 guard-lock recursion limit fails closed
    const locksDir = path.join(stateDir, 'locks');
    for (const suffix of ['', '.reclaim', '.reclaim.reclaim', '.reclaim.reclaim.reclaim', '.reclaim.reclaim.reclaim.reclaim']) {
      writeFileSync(path.join(locksDir, `t-depth.lock${suffix}`), JSON.stringify({ ...baseRec, taskId: 't-depth', nonce: `n${suffix.length}` }), { mode: 0o600 });
    }
    expect(acquireTaskLock(stateDir, 't-depth', makeDeps({ killZero: () => 'esrch' }))).toBeNull();

    // Snapshot mismatch check aborts if file mutated
    const snapA = captureSnapshot(path.join(locksDir, 't-wrong.lock'), 'other')!;
    seedLock(stateDir, 't-wrong', { ...baseRec, taskId: 'other', nonce: 'n2' });
    const snapB = captureSnapshot(path.join(locksDir, 't-wrong.lock'), 'other')!;
    expect(snapshotsEqual(snapA, snapB)).toBe(false);
  });

  it('reclaims PID reuse + acquired-phase dead runner on xfs/btrfs/f2fs and refuses releasing replaced lock', () => {
    const stateDir = makeExt4StateDir();
    const baseRec = {
      v: 1, taskId: 't-2', pid: 4000, pidStartTime: '1111', pidNs: 'pid:[4026531836]', timeNs: 'time:[4026531834]',
      phase: 'running', childPid: 4001, childPgid: 4001, host: 'ws-1', bootId: BOOT_A, nonce: 'n1', acquiredAt: '2026-11-25T10:00:00.000Z',
    };
    for (const magic of [0x58465342, 0x9123683e, 0xf2f52010]) {
      seedLock(stateDir, 't-2', baseRec);
      const h = acquireTaskLock(stateDir, 't-2', makeDeps({
        statfsType: () => magic,
        readProcStat: () => ({ state: 'S', startTime: '7777' }),
        killZero: (p) => (p > 0 ? 'alive' : 'esrch'),
      }));
      expect(h).not.toBeNull();
      h!.release();
    }

    // Verify guard-lock record invariants (m-32(d): phase acquired, childPgid null) + acquired-phase reclaim
    seedLock(stateDir, 't-2', { ...baseRec, phase: 'acquired', childPid: null, childPgid: null });
    let capturedGuard: Record<string, unknown> | null = null;
    const hAcq = acquireTaskLock(stateDir, 't-2', makeDeps({
      killZero: () => 'esrch',
      statfsType: (dir) => {
        try {
          const g = path.join(dir, 't-2.lock.reclaim');
          capturedGuard = JSON.parse(readFileSync(g, 'utf8'));
        } catch { /* before guard */ }
        return 0xef53;
      },
    }));
    expect(hAcq).not.toBeNull();
    expect(capturedGuard).toMatchObject({ phase: 'acquired', childPid: null, childPgid: null });

    // Releasing handle whose lock file was replaced externally leaves new lock intact
    seedLock(stateDir, 't-2', { ...baseRec, nonce: 'external-owner' });
    hAcq!.release();
    expect(JSON.parse(readFileSync(path.join(stateDir, 'locks', 't-2.lock'), 'utf8')).nonce).toBe('external-owner');
  });

  it('covers m-3 unknown pidStartTime, m-4 tmp/fallback cleanup, m-8 null bootId/Threads, and reclaim snapshot-mismatch abort', () => {
    const stateDir = makeExt4StateDir();
    const baseRec = {
      v: 1, taskId: 't-3', pid: 4000, pidStartTime: '1111', pidNs: 'pid:[4026531836]', timeNs: 'time:[4026531834]',
      phase: 'running', childPid: 4001, childPgid: 4001, host: 'ws-1', bootId: BOOT_A, nonce: 'n1', acquiredAt: '2026-11-25T10:00:00.000Z',
    };

    // m-3: non-decimal pidStartTime ('unknown') fails closed on same boot
    seedLock(stateDir, 't-3', { ...baseRec, pidStartTime: 'unknown' });
    expect(acquireTaskLock(stateDir, 't-3', makeDeps({
      killZero: (p) => (p > 0 ? 'alive' : 'esrch'),
      readProcStat: () => ({ state: 'S', startTime: '12345' }),
    }))).toBeNull();

    // m-8: null current bootId and unreadable /proc/<pid>/status (Threads: null) fail closed
    seedLock(stateDir, 't-3', { ...baseRec, bootId: BOOT_B });
    expect(acquireTaskLock(stateDir, 't-3', makeDeps({
      readBootId: () => null,
      killZero: (p) => (p > 0 ? 'alive' : 'esrch'),
      readProcStat: () => ({ state: 'S', startTime: '1111' }),
    }))).toBeNull();
    seedLock(stateDir, 't-3', baseRec);
    expect(acquireTaskLock(stateDir, 't-3', makeDeps({
      readProcStat: () => ({ state: 'Z', startTime: '1111' }),
      readProcThreads: () => null,
      killZero: (p) => (p > 0 ? 'alive' : 'esrch'),
    }))).toBeNull();

    // m-8: snapshot-mismatch inside reclaim flow aborts cleanly without unlinking mutated lock
    const lockPath = seedLock(stateDir, 't-3', baseRec);
    let bootCalls = 0;
    expect(acquireTaskLock(stateDir, 't-3', makeDeps({
      killZero: () => 'esrch',
      readBootId: () => {
        bootCalls += 1;
        if (bootCalls === 2) writeFileSync(lockPath, JSON.stringify({ ...baseRec, nonce: 'raced' }), { mode: 0o600 });
        return BOOT_A;
      },
    }))).toBeNull();
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).nonce).toBe('raced');

    // m-4: failed write during publication and EXDEV fallback leaves zero leftover .tmp or partial lock files
    const locksDir = path.join(stateDir, 'locks');
    expect(() => acquireTaskLock(stateDir, 't-clean', makeDeps({
      onPublishWrite: () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); },
    }))).toThrow('ENOSPC');
    expect(readdirSync(locksDir).some((f) => f.startsWith('t-clean.lock'))).toBe(false);

    let writeCalls = 0;
    expect(() => tryPublishExclusive(locksDir, path.join(locksDir, 't-fb.lock'), {
      ...baseRec, taskId: 't-fb', pid: 5000, pidStartTime: '9999', pidNs: 'pid:[4026531836]',
      timeNs: 'time:[4026531834]', phase: 'acquired', childPid: null, childPgid: null, nonce: 'fb1',
    }, {
      linkFn: () => { throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); },
      onWrite: () => { if (++writeCalls === 2) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); },
    })).toThrow('ENOSPC');
    expect(readdirSync(locksDir).some((f) => f.startsWith('t-fb.lock'))).toBe(false);
  });
});
