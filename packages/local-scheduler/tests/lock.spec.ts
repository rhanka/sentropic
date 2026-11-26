import { chmodSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireTaskLock, readTaskLockSummary } from '../src/lock.js';
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
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'S', startTime: '8888' }), killZero: () => 'alive' }))).toBeNull();

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
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => ({ state: 'Z', startTime: '1111' }), readProcThreads: () => 2 }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ killZero: () => 'other' }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ readProcStat: () => null }))).toBeNull();
    expect(acquireTaskLock(stateDir, 't-1', makeDeps({ killZero: () => 'esrch', statfsType: () => 0x794c7630 }))).toBeNull();
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
});
