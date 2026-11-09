import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultInstallBudget, INSTALL_CEILING_MS_DEFAULT, INSTALL_STALL_MS_DEFAULT, MAX_TIMEOUT_MS,
  readInstallBudget, runPhase, withinInstallBudget } from '../../../src/services/artifacts/live/deadline';
import { LiveError } from '../../../src/services/artifacts/live/records';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('install budget', () => {
  it('defaults to a 60 s stall watchdog with a 20 min ceiling', () => {
    expect(defaultInstallBudget()).toEqual({ stallMs: 60_000, ceilingMs: 1_200_000 });
    expect(INSTALL_STALL_MS_DEFAULT).toBe(60_000);
    expect(INSTALL_CEILING_MS_DEFAULT).toBe(1_200_000);
    expect(readInstallBudget({})).toEqual(defaultInstallBudget());
  });
  it('reads overrides from the environment', () => {
    expect(readInstallBudget({ ARTIFACT_INSTALL_STALL_MS: '30000', ARTIFACT_INSTALL_CEILING_MS: '600000' }))
      .toEqual({ stallMs: 30000, ceilingMs: 600000 });
  });
  it('falls back to the safe default on missing, invalid or overflowing values', () => {
    for (const env of [{ ARTIFACT_INSTALL_STALL_MS: 'nope' }, { ARTIFACT_INSTALL_STALL_MS: '-5' },
      { ARTIFACT_INSTALL_STALL_MS: '0' }, { ARTIFACT_INSTALL_CEILING_MS: '' },
      { ARTIFACT_INSTALL_STALL_MS: '60000', ARTIFACT_INSTALL_CEILING_MS: '60000' },
      { ARTIFACT_INSTALL_STALL_MS: '60000', ARTIFACT_INSTALL_CEILING_MS: '1000' },
      // Past 2^31-1 setTimeout overflows to ~1 ms, so the value is refused instead of cutting instantly.
      { ARTIFACT_INSTALL_STALL_MS: String(MAX_TIMEOUT_MS + 1) },
      { ARTIFACT_INSTALL_CEILING_MS: String(MAX_TIMEOUT_MS + 1) }]) {
      expect(readInstallBudget(env)).toEqual(defaultInstallBudget());
    }
    expect(readInstallBudget({ ARTIFACT_INSTALL_STALL_MS: String(MAX_TIMEOUT_MS),
      ARTIFACT_INSTALL_CEILING_MS: String(MAX_TIMEOUT_MS) })).toEqual(defaultInstallBudget());
  });
});

describe('install progress watchdog', () => {
  it('keeps going while install progress happens', async () => {
    const seen: string[] = [];
    const result = await withinInstallBudget(async progress => {
      for (const step of ['fetch-a', 'fetch-b', 'drain']) {
        await delay(10); progress.report(); seen.push(step);
      }
      return 'installed';
    }, { stallMs: 200, ceilingMs: 5_000 });
    expect(result).toBe('installed');
    expect(seen).toEqual(['fetch-a', 'fetch-b', 'drain']);
  });
  it('does not cut a slow start before the first progress', async () => {
    // A healthy cold start waits past one stall window with no observable progress (heavy-queue admission, forge
    // re-download, source transfer); the stall arms only on the first report, so the start survives.
    const result = await withinInstallBudget(async progress => {
      await delay(150);
      for (let i = 0; i < 3; i++) { await delay(10); progress.report(); }
      return 'installed';
    }, { stallMs: 50, ceilingMs: 5_000 });
    expect(result).toBe('installed');
  });
  it('fails a stalled install with the phase in the reason', async () => {
    // One progress report arms the stall; the silence after it trips the watchdog.
    await expect(withinInstallBudget(async progress => {
      progress.report();
      await delay(300);
      return 'late';
    }, { stallMs: 50, ceilingMs: 5_000 }))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'phase_timeout:install' });
  });
  it('fails an install that never reports at the ceiling, not the stall', async () => {
    // No report ever arms the stall, so only the absolute ceiling cuts a mute install.
    await expect(withinInstallBudget(() => delay(300).then(() => 'late'), { stallMs: 10_000, ceilingMs: 150 }))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'phase_timeout:install' });
  });
  it('aborts the signal handed to the work on a stall', async () => {
    let observed: AbortSignal | undefined;
    await expect(withinInstallBudget(async (progress, signal) => {
      observed = signal;
      progress.report();
      await delay(300);
      return 'late';
    }, { stallMs: 50, ceilingMs: 5_000 }))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'phase_timeout:install' });
    expect(observed?.aborted).toBe(true);
  });
  it('fails a hung install at the ceiling even with the stall suspended', async () => {
    await expect(withinInstallBudget(async progress => {
      progress.suspendStall(true);
      await delay(500);
      return 'never';
    }, { stallMs: 10_000, ceilingMs: 150 })).rejects
      .toMatchObject({ code: 'builder_unavailable', reason: 'phase_timeout:install' });
  });
  it('a resumed stall timer fires again without further progress', async () => {
    await expect(withinInstallBudget(async progress => {
      progress.report();
      progress.suspendStall(true);
      await delay(10);
      progress.suspendStall(false);
      await delay(300);
      return 'never';
    }, { stallMs: 100, ceilingMs: 5_000 })).rejects
      .toMatchObject({ code: 'builder_unavailable', reason: 'phase_timeout:install' });
  });
  it('ignores progress reported after the race settled', async () => {
    let late: { report(): void; suspendStall(suspended: boolean): void } | undefined;
    const result = await withinInstallBudget(async progress => {
      late = progress; progress.report(); return 'done';
    }, { stallMs: 50, ceilingMs: 5_000 });
    expect(result).toBe('done');
    late!.report(); late!.suspendStall(true); late!.suspendStall(false);
    await delay(150);
    expect(result).toBe('done');
  });
});

describe('phase logging', () => {
  const key = { storageScopeId: 'scope-x', artifactId: 'artifact-y' };
  const expectedHash = createHash('sha256').update(JSON.stringify(['scope-x', 'artifact-y'])).digest('hex');
  it('logs start and ok with duration and the key hash, never the raw key', async () => {
    const lines: unknown[] = []; let now = 1_000;
    const result = await runPhase(key, 'install', async () => { now += 41; return 'done'; },
      { log: fields => lines.push(fields), now: () => now });
    expect(result).toBe('done');
    expect(lines).toEqual([
      { msg: 'artifact_live_phase', key: expectedHash, phase: 'install', ms: 0, outcome: 'ok', reason: 'started' },
      { msg: 'artifact_live_phase', key: expectedHash, phase: 'install', ms: 41, outcome: 'ok' },
    ]);
    expect(JSON.stringify(lines)).not.toContain('scope-x');
    expect(JSON.stringify(lines)).not.toContain('artifact-y');
  });
  it('marks the start line so an aggregation over outcome never counts it as a success', async () => {
    const lines: Array<Record<string, unknown>> = [];
    await runPhase(key, 'build', async () => 'done',
      { log: fields => lines.push(fields as Record<string, unknown>), now: () => 0 });
    const starts = lines.filter(line => line.reason === 'started');
    expect(starts).toHaveLength(1);
    expect(lines.filter(line => line.outcome === 'ok' && line.reason !== 'started')).toHaveLength(1);
  });
  it('logs fail with the failing phase name and rethrows unchanged', async () => {
    const lines: unknown[] = [];
    const failure = new LiveError('builder_unavailable', 'phase_timeout:install');
    await expect(runPhase(key, 'install', async () => { throw failure; },
      { log: fields => lines.push(fields), now: () => 0 })).rejects.toBe(failure);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ phase: 'install', outcome: 'ok', reason: 'started' });
    expect(lines[1]).toMatchObject({ msg: 'artifact_live_phase', phase: 'install', outcome: 'fail',
      reason: 'builder_unavailable:phase_timeout:install' });
  });
  it('rewrites a bare phase timeout with the failing phase name on every path', async () => {
    const lines: unknown[] = [];
    const bare = new LiveError('builder_unavailable', 'phase_timeout');
    await expect(runPhase(key, 'build', async () => { throw bare; },
      { log: fields => lines.push(fields), now: () => 0 }))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'phase_timeout:build' });
    expect(lines[1]).toMatchObject({ outcome: 'fail', reason: 'builder_unavailable:phase_timeout:build' });
  });
  it('logs a non-live error as builder_unavailable without secrets', async () => {
    const lines: unknown[] = [];
    await expect(runPhase(key, 'build', async () => { throw new Error('relay token abc'); },
      { log: fields => lines.push(fields), now: () => 0 })).rejects.toThrow('relay token abc');
    expect(lines[1]).toMatchObject({ outcome: 'fail', reason: 'builder_unavailable' });
    expect(JSON.stringify(lines)).not.toContain('relay token abc');
  });
});
