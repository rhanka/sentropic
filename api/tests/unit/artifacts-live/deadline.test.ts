import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultInstallBudget, INSTALL_CEILING_MS_DEFAULT, INSTALL_STALL_MS_DEFAULT, readInstallBudget,
  runPhase, withinInstallBudget } from '../../../src/services/artifacts/live/deadline';
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
  it('falls back to the safe default on missing or invalid values', () => {
    for (const env of [{ ARTIFACT_INSTALL_STALL_MS: 'nope' }, { ARTIFACT_INSTALL_STALL_MS: '-5' },
      { ARTIFACT_INSTALL_STALL_MS: '0' }, { ARTIFACT_INSTALL_CEILING_MS: '' },
      { ARTIFACT_INSTALL_STALL_MS: '60000', ARTIFACT_INSTALL_CEILING_MS: '60000' },
      { ARTIFACT_INSTALL_STALL_MS: '60000', ARTIFACT_INSTALL_CEILING_MS: '1000' }]) {
      expect(readInstallBudget(env)).toEqual(defaultInstallBudget());
    }
  });
});

describe('install progress watchdog', () => {
  it('keeps going while install progress happens', async () => {
    const seen: string[] = [];
    const result = await withinInstallBudget(async progress => {
      for (const step of ['fetch-a', 'fetch-b', 'drain']) {
        await delay(20); progress.report(); seen.push(step);
      }
      return 'installed';
    }, { stallMs: 30, ceilingMs: 5_000 });
    expect(result).toBe('installed');
    expect(seen).toEqual(['fetch-a', 'fetch-b', 'drain']);
  });
  it('fails a stalled install with the phase in the reason', async () => {
    await expect(withinInstallBudget(() => delay(200).then(() => 'late'), { stallMs: 20, ceilingMs: 5_000 }))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'phase_timeout:install' });
  });
  it('fails a hung install at the ceiling even with the stall suspended', async () => {
    await expect(withinInstallBudget(async progress => {
      progress.suspendStall(true);
      await delay(500);
      return 'never';
    }, { stallMs: 10_000, ceilingMs: 50 })).rejects
      .toMatchObject({ code: 'builder_unavailable', reason: 'phase_timeout:install' });
  });
  it('a resumed stall timer fires again without further progress', async () => {
    await expect(withinInstallBudget(async progress => {
      progress.report();
      progress.suspendStall(true);
      await delay(10);
      progress.suspendStall(false);
      await delay(200);
      return 'never';
    }, { stallMs: 30, ceilingMs: 5_000 })).rejects
      .toMatchObject({ code: 'builder_unavailable', reason: 'phase_timeout:install' });
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
      { msg: 'artifact_live_phase', key: expectedHash, phase: 'install', ms: 0, outcome: 'ok' },
      { msg: 'artifact_live_phase', key: expectedHash, phase: 'install', ms: 41, outcome: 'ok' },
    ]);
    expect(JSON.stringify(lines)).not.toContain('scope-x');
    expect(JSON.stringify(lines)).not.toContain('artifact-y');
  });
  it('logs fail with the failing phase name and rethrows unchanged', async () => {
    const lines: unknown[] = [];
    const failure = new LiveError('builder_unavailable', 'phase_timeout:install');
    await expect(runPhase(key, 'install', async () => { throw failure; },
      { log: fields => lines.push(fields), now: () => 0 })).rejects.toBe(failure);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ msg: 'artifact_live_phase', phase: 'install', outcome: 'fail',
      reason: 'builder_unavailable:phase_timeout:install' });
  });
  it('logs a non-live error as builder_unavailable without secrets', async () => {
    const lines: unknown[] = [];
    await expect(runPhase(key, 'build', async () => { throw new Error('relay token abc'); },
      { log: fields => lines.push(fields), now: () => 0 })).rejects.toThrow('relay token abc');
    expect(lines[1]).toMatchObject({ outcome: 'fail', reason: 'builder_unavailable' });
    expect(JSON.stringify(lines)).not.toContain('relay token abc');
  });
});
