import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateKillSwitch, evaluateTaskHealth, parseSchedulerEnvFile,
  type LocalTaskManifestV1, type LocalTaskWitnessV1,
} from '../src/index.js';
import { probeStateDirObservability } from '../src/state-dir.js';

const tmpDirs: string[] = [];
const makeTmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'lsch-health-')); tmpDirs.push(d); return d; };
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const MANIFEST: LocalTaskManifestV1 = {
  v: 1,
  spec: {
    v: 1, taskId: 'h2a-session-archive', owner: 'h2a', description: 'archive',
    schedule: { onCalendar: 'daily', persistent: true, graceMultiplier: 1.5 },
    command: { bin: '/usr/bin/node', args: ['/opt/h2a/bin.js'] },
    timeoutMs: 900_000, killSwitchEnv: 'H2A_ARCHIVE_OFF',
  },
  runner: { bin: '/usr/bin/node', args: ['/opt/h2a/bin.js'] },
  enabled: true, installedAt: '2026-11-20T00:00:00.000Z', enabledAt: '2026-11-24T00:00:00.000Z',
  stateDir: '/var/lib/ls', envFilePath: '/etc/ls/env', expectedIntervalMs: 86_400_000,
  units: { serviceSha256: 'a'.repeat(64), timerSha256: 'b'.repeat(64) },
};
const witness = (over: Partial<LocalTaskWitnessV1> = {}): LocalTaskWitnessV1 => ({
  v: 1, taskId: 'h2a-session-archive', owner: 'h2a', runId: 'r-1', trigger: 'systemd-timer',
  host: 'ws', pid: 100, startedAt: '2026-11-24T01:00:00.000Z', finishedAt: '2026-11-24T01:05:00.000Z',
  durationMs: 300_000, outcome: 'succeeded', exitCode: 0, signal: null,
  consecutiveFailures: 0, lastSuccessAt: '2026-11-24T01:05:00.000Z', lastSuccessRunId: 'r-1', ...over,
});

describe('parseSchedulerEnvFile & evaluateKillSwitch', () => {
  it('parses comments, blank lines, quotes, and ignores malformed lines', () => {
    const parsed = parseSchedulerEnvFile('# c1\n; c2\n\nA="hello $WORLD"\nB=\'val\'\nBAD LINE\n1INVALID=x\nC=plain\n');
    expect(parsed).toEqual({ A: 'hello $WORLD', B: 'val', C: 'plain' });
  });
  it('evaluates global > task > alias kill-switch precedence', () => {
    const spec = { taskId: 'h2a-session-archive', killSwitchEnv: 'H2A_ARCHIVE_OFF' };
    expect(evaluateKillSwitch({ H2A_ARCHIVE_OFF: 'false', SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF: '0' }, spec)).toBeNull();
    expect(evaluateKillSwitch({ SENTROPIC_LOCAL_SCHEDULER_OFF: '1', H2A_ARCHIVE_OFF: '1' }, spec)).toEqual({ scope: 'global', name: 'SENTROPIC_LOCAL_SCHEDULER_OFF' });
    expect(evaluateKillSwitch({ SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF: 'yes', H2A_ARCHIVE_OFF: '1' }, spec)).toEqual({ scope: 'task', name: 'SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF' });
    expect(evaluateKillSwitch({ H2A_ARCHIVE_OFF: 'true' }, spec)).toEqual({ scope: 'alias', name: 'H2A_ARCHIVE_OFF' });
  });
});

describe('probeStateDirObservability', () => {
  it('covers all 5 observability rules (m-32(b))', () => {
    const dir = makeTmp();
    const hostPass = { platform: 'linux' as const, readLink: () => 'pid:[4026531836]', statUid: () => 0, readText: (p: string) => (p.endsWith('comm') ? 'systemd\n' : '0::/init.scope\n') };
    const hostFail = { ...hostPass, readLink: () => 'pid:[4026539999]' };
    expect(probeStateDirObservability(dir, hostFail)).toEqual({ observable: true });
    expect(probeStateDirObservability(path.join(dir, 'missing'), hostPass)).toEqual({ observable: true });
    expect(probeStateDirObservability(path.join(dir, 'missing'), hostFail)).toEqual({ observable: false, reason: 'absent-outside-host-namespace' });

    const regFile = path.join(dir, 'file');
    writeFileSync(regFile, 'x');
    expect(probeStateDirObservability(regFile, hostPass)).toEqual({ observable: false, reason: 'not-a-directory' });
    expect(probeStateDirObservability(path.join(regFile, 'child'), hostPass)).toEqual({ observable: false, reason: 'not-a-directory' });
    const linkPath = path.join(dir, 'link');
    symlinkSync(dir, linkPath);
    expect(probeStateDirObservability(linkPath, hostPass)).toEqual({ observable: false, reason: 'not-a-directory' });
    if (process.getuid?.() !== 0) {
      const noRead = path.join(dir, 'chmod0');
      mkdirSync(noRead);
      chmodSync(noRead, 0o000);
      expect(probeStateDirObservability(noRead, hostPass)).toEqual({ observable: false, reason: 'inaccessible' });
      chmodSync(noRead, 0o700);
    }
  });
});

describe('evaluateTaskHealth truth table', () => {
  it('covers unobservable, not_installed, disabled, corrupt, pending, healthy, skew', () => {
    expect(evaluateTaskHealth({ stateDirObservable: false, manifest: null, witness: null, nowIso: '2026-11-24T02:00:00.000Z' }).status).toBe('unobservable');
    expect(evaluateTaskHealth({ manifest: null, witness: null, nowIso: '2026-11-24T02:00:00.000Z' }).status).toBe('not_installed');
    expect(evaluateTaskHealth({ manifest: 'corrupt', witness: null, nowIso: '2026-11-24T02:00:00.000Z' }).status).toBe('witness_corrupt');
    expect(evaluateTaskHealth({ manifest: { ...MANIFEST, enabled: false }, witness: null, nowIso: '2026-11-24T02:00:00.000Z' }).status).toBe('disabled');
    expect(evaluateTaskHealth({ manifest: MANIFEST, witness: 'corrupt', nowIso: '2026-11-24T02:00:00.000Z' }).status).toBe('witness_corrupt');
    expect(evaluateTaskHealth({ manifest: MANIFEST, witness: null, nowIso: '2026-11-25T00:00:00.000Z' }).status).toBe('pending_first_run');
    expect(evaluateTaskHealth({ manifest: MANIFEST, witness: null, nowIso: '2026-11-26T00:00:00.000Z' }).status).toBe('schedule_missed');
    expect(evaluateTaskHealth({ manifest: MANIFEST, witness: witness(), nowIso: '2026-11-25T00:00:00.000Z' }).status).toBe('healthy');
    expect(evaluateTaskHealth({ manifest: MANIFEST, witness: witness(), nowIso: '2026-11-24T00:00:00.000Z' }).status).toBe('clock_skew');
  });

  it('covers pause/m-16/m-28(b)/m-30/m-32(f) failures, interruptions, and hints', () => {
    const activePause = evaluateTaskHealth({
      manifest: MANIFEST,
      witness: witness({ outcome: 'skipped_disabled', killSwitch: { scope: 'alias', name: 'H2A_ARCHIVE_OFF' }, finishedAt: '2026-11-26T00:00:00.000Z', lastSuccessAt: '2026-11-24T01:05:00.000Z' }),
      persistedKillSwitch: { scope: 'alias', name: 'H2A_ARCHIVE_OFF' },
      nowIso: '2026-11-26T06:00:00.000Z',
    });
    expect(activePause.status).toBe('paused');
    expect(activePause.severity).toBe('warning');

    const stalePause = evaluateTaskHealth({
      manifest: MANIFEST,
      witness: witness({ outcome: 'skipped_disabled', killSwitch: { scope: 'alias', name: 'H2A_ARCHIVE_OFF' }, finishedAt: '2026-11-24T02:00:00.000Z' }),
      persistedKillSwitch: { scope: 'alias', name: 'H2A_ARCHIVE_OFF' },
      nowIso: '2026-11-26T00:00:00.000Z',
    });
    expect(stalePause.status).toBe('schedule_missed');
    expect(stalePause.severity).toBe('critical');
    expect(stalePause.hints.some((h) => h.includes('the timer may be stopped'))).toBe(true);

    const singleFailWithin = evaluateTaskHealth({
      manifest: MANIFEST, witness: witness({ outcome: 'failed', consecutiveFailures: 1, exitCode: 1 }),
      readerEnvKillSwitch: { scope: 'alias', name: 'H2A_ARCHIVE_OFF' },
      envFileProtectedOverrides: ['PATH', 'SENTROPIC_LOCAL_SCHEDULER_STATE_DIR'],
      lock: { pid: 99, phase: 'running', acquiredAt: '2026-11-24T01:00:00.000Z' },
      lastSkip: { v: 1, runId: 's1', at: '2026-11-24T02:00:00.000Z', pid: 101, outcome: 'skipped_locked' },
      nowIso: '2026-11-24T06:00:00.000Z',
    });
    expect(singleFailWithin.status).toBe('failing');
    expect(singleFailWithin.severity).toBe('warning');
    expect(singleFailWithin.hints.some((h) => h.includes('does not pause'))).toBe(true);
    expect(singleFailWithin.hints.some((h) => h.includes('held by pid 99'))).toBe(true);
    expect(singleFailWithin.hints.some((h) => h.includes('remove PATH'))).toBe(true);

    expect(evaluateTaskHealth({ manifest: MANIFEST, witness: witness({ outcome: 'failed', consecutiveFailures: 1, exitCode: 1 }), nowIso: '2026-11-26T00:00:00.000Z' }).severity).toBe('critical');
    expect(evaluateTaskHealth({ manifest: MANIFEST, witness: witness({ outcome: 'timed_out', consecutiveFailures: 1, exitCode: null }), nowIso: '2026-11-24T06:00:00.000Z' }).opsReason).toBe('deadline-exceeded');
    expect(evaluateTaskHealth({ manifest: MANIFEST, witness: witness({ outcome: 'interrupted', signal: 'SIGTERM' }), nowIso: '2026-11-24T06:00:00.000Z' }).status).toBe('interrupted');
    expect(evaluateTaskHealth({ manifest: MANIFEST, witness: witness({ outcome: 'interrupted', signal: 'SIGTERM' }), nowIso: '2026-11-26T00:00:00.000Z' }).status).toBe('schedule_missed');
  });

  it('covers remaining verdict, severity, re-enable reset, non-downgrade, and hint branches', () => {
    const pausedOk = evaluateTaskHealth({
      manifest: MANIFEST,
      witness: witness({ outcome: 'skipped_disabled', killSwitch: { scope: 'global', name: 'SENTROPIC_LOCAL_SCHEDULER_OFF' }, finishedAt: '2026-11-24T12:00:00.000Z' }),
      persistedKillSwitch: { scope: 'global', name: 'SENTROPIC_LOCAL_SCHEDULER_OFF' },
      nowIso: '2026-11-25T00:00:00.000Z',
    });
    expect(pausedOk).toMatchObject({ status: 'paused', severity: 'ok', hints: [] });
    expect(pausedOk.message).toContain('paused since 2026-11-24T12:00:00.000Z by SENTROPIC_LOCAL_SCHEDULER_OFF');

    expect(evaluateTaskHealth({
      manifest: MANIFEST, witness: witness({ outcome: 'refused_policy', refusal: 'allowlist', consecutiveFailures: 1, exitCode: null }),
      nowIso: '2026-11-24T06:00:00.000Z',
    })).toMatchObject({ status: 'failing', severity: 'critical', opsReason: 'job-failed' });

    expect(evaluateTaskHealth({
      manifest: MANIFEST, witness: witness({ outcome: 'failed', consecutiveFailures: 2, exitCode: 1 }),
      nowIso: '2026-11-24T06:00:00.000Z',
    })).toMatchObject({ status: 'failing', severity: 'critical', opsReason: 'job-failed' });

    expect(evaluateTaskHealth({
      manifest: MANIFEST, witness: witness({ outcome: 'succeeded' }), nowIso: '2026-11-26T00:00:00.000Z',
    })).toMatchObject({ status: 'schedule_missed', severity: 'critical', opsReason: 'schedule-missed' });

    expect(evaluateTaskHealth({
      manifest: MANIFEST,
      witness: witness({ finishedAt: '2026-11-24T01:05:00.000Z', lastSuccessAt: '2026-11-24T10:00:00.000Z' }),
      nowIso: '2026-11-24T02:00:00.000Z',
      clockSkewToleranceMs: 60_000,
    })).toMatchObject({ status: 'clock_skew', severity: 'warning', opsReason: 'stale' });

    expect(evaluateTaskHealth({
      manifest: { ...MANIFEST, enabledAt: '2026-11-26T00:00:00.000Z' },
      witness: witness({ finishedAt: '2026-11-20T01:05:00.000Z', lastSuccessAt: '2026-11-20T01:05:00.000Z' }),
      nowIso: '2026-11-26T12:00:00.000Z',
    })).toMatchObject({ status: 'healthy', severity: 'ok' });

    const readerKs = { scope: 'alias' as const, name: 'H2A_ARCHIVE_OFF' };
    for (const [st, w] of [
      ['failing', witness({ outcome: 'failed', consecutiveFailures: 2, exitCode: 1 })],
      ['schedule_missed', null],
      ['clock_skew', witness()],
      ['witness_corrupt', 'corrupt' as const],
    ] as const) {
      const nowIso = st === 'clock_skew' ? '2026-11-24T00:00:00.000Z' : '2026-11-26T00:00:00.000Z';
      const v = evaluateTaskHealth({ manifest: MANIFEST, witness: w, readerEnvKillSwitch: readerKs, nowIso });
      expect(v.status).toBe(st);
      expect(v.hints.some((h) => h.includes('does not pause'))).toBe(true);
    }

    const unreadableLock = evaluateTaskHealth({
      manifest: MANIFEST,
      witness: witness({ finishedAt: '2026-11-24T01:05:00.000Z' }),
      persistedKillSwitch: { scope: 'task', name: 'SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF' },
      lock: 'unreadable',
      lastSkip: { v: 1, runId: 's2', at: '2026-11-24T02:00:00.000Z', pid: 102, outcome: 'skipped_locked' },
      nowIso: '2026-11-24T06:00:00.000Z',
    });
    expect(unreadableLock.hints.some((h) => h.includes('next scheduled tick will pause'))).toBe(true);
    expect(unreadableLock.hints.some((h) => h.includes('unreadable lock file'))).toBe(true);

    const suppressedSkip = evaluateTaskHealth({
      manifest: MANIFEST,
      witness: witness({ finishedAt: '2026-11-24T03:00:00.000Z' }),
      lock: { pid: 99, phase: 'running', acquiredAt: '2026-11-24T01:00:00.000Z' },
      lastSkip: { v: 1, runId: 's3', at: '2026-11-24T02:00:00.000Z', pid: 103, outcome: 'refused_policy', refusal: 'sandbox' },
      nowIso: '2026-11-24T06:00:00.000Z',
    });
    expect(suppressedSkip.hints).toEqual([]);
  });
});
