import { describe, expect, it } from 'vitest';
import { InvalidTaskSpecError, SchedulerUnavailableError, type LocalTaskManifestV1, type OsSchedulerAdapter } from '../src/index.js';
import { computeExpectedIntervalMsWith } from '../src/systemd/calendar.js';
import {
  computeExpectedIntervalMs, createSystemdUserAdapter,
  probeSystemdUserAvailability, renderSystemdUnits,
} from '../src/systemd/index.js';
import { formatUnavailableMessage, probeLingerEnabledWith, probeSystemdUserAvailabilityWith, requireSystemdUserAvailable } from '../src/systemd/systemctl.js';

describe('@sentropic/local-scheduler/systemd contract & probes (§4.2)', () => {
  it('verifies frozen §4.2 signatures via Equals<> and probes systemd availability/intervals', async () => {
    type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    const eqAdapter: Equals<typeof createSystemdUserAdapter, (opts?: { readonly stateDir?: string; readonly envFilePath?: string }) => OsSchedulerAdapter> = true;
    const eqProbe: Equals<typeof probeSystemdUserAvailability, () => Promise<{ readonly available: true; readonly systemdVersion: string } | { readonly available: false; readonly reason: 'not-linux' | 'no-systemctl' | 'no-user-manager' | 'timeout'; readonly detail: string }>> = true;
    const eqInterval: Equals<typeof computeExpectedIntervalMs, (onCalendar: string) => Promise<number>> = true;
    const eqRender: Equals<typeof renderSystemdUnits, (manifest: Omit<LocalTaskManifestV1, 'units'>) => { readonly service: string; readonly timer: string; readonly serviceSha256: string; readonly timerSha256: string }> = true;
    expect([eqAdapter, eqProbe, eqInterval, eqRender]).toEqual([true, true, true, true]);
    expect(createSystemdUserAdapter.length).toBe(1);

    expect(await probeSystemdUserAvailabilityWith('darwin')).toMatchObject({ available: false, reason: 'not-linux' });
    expect(await probeSystemdUserAvailabilityWith('linux', async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); })).toMatchObject({ available: false, reason: 'no-systemctl' });
    expect(await probeSystemdUserAvailabilityWith('linux', async () => { throw Object.assign(new Error('timeout'), { killed: true }); })).toMatchObject({ available: false, reason: 'timeout' });
    expect(await probeSystemdUserAvailabilityWith('linux', async () => { throw Object.assign(new Error('down'), { stderr: 'No medium found' }); })).toMatchObject({ available: false, reason: 'no-user-manager' });
    const seen: string[][] = [];
    const okAvail = await probeSystemdUserAvailabilityWith('linux', async (f, a) => {
      seen.push([f, ...a]);
      return { stdout: '252\n', stderr: '' };
    });
    expect(okAvail).toEqual({ available: true, systemdVersion: '252' });
    expect(seen[0]).not.toContain('show-environment');

    expect(await computeExpectedIntervalMsWith('hourly')).toBe(3_600_000);
    const analyzeOut = [
      '  Next elapse: Thu 2026-11-26 00:00:00 UTC',
      '  Iter. #2: Thu 2026-11-26 06:00:00 UTC',
      '  Iteration #3: Thu 2026-11-26 12:00:00 UTC',
    ].join('\n');
    expect(await computeExpectedIntervalMsWith('*-*-* 00/6:00:00', async (_f, a) => {
      expect(a).toEqual(['calendar', '--iterations=8', '--', '*-*-* 00/6:00:00']);
      return { stdout: analyzeOut, stderr: '' };
    })).toBe(6 * 3_600_000);
    await expect(computeExpectedIntervalMsWith('*:*:00', async () => ({
      stdout: 'Next elapse: Thu 2026-11-26 00:00:00 UTC\nIteration #2: Thu 2026-11-26 00:00:30 UTC\n', stderr: '',
    }))).rejects.toThrow(InvalidTaskSpecError);
    await expect(computeExpectedIntervalMsWith('*-*-* 00/6:00:00', async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    })).rejects.toMatchObject({
      code: 'SYSTEMD_USER_UNAVAILABLE',
      reason: 'no-systemctl',
      message: expect.stringMatching(/systemd-analyze binary not found.*no fallback scheduler.*Install systemd/i),
    });
    await expect(computeExpectedIntervalMsWith('*-*-* 00/6:00:00', async () => {
      throw Object.assign(new Error('timeout'), { killed: true });
    })).rejects.toMatchObject({
      code: 'SYSTEMD_USER_UNAVAILABLE',
      reason: 'timeout',
      exitCode: 69,
      message: expect.stringMatching(/systemd-analyze calendar timed out.*no fallback scheduler.*responsive/i),
    });
    await expect(computeExpectedIntervalMsWith('*-*-* 00/6:00:00', async () => {
      throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    })).rejects.toBeInstanceOf(SchedulerUnavailableError);

    expect(formatUnavailableMessage('not-linux', 'unsupported platform: darwin')).toMatch(/not-linux.*no fallback scheduler.*Linux host/i);
    if (process.platform === 'linux') {
      await expect(requireSystemdUserAvailable(async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      })).rejects.toMatchObject({
        code: 'SYSTEMD_USER_UNAVAILABLE',
        reason: 'no-systemctl',
        message: expect.stringMatching(/no-systemctl.*no fallback scheduler.*Install systemd/i),
      });
      await expect(requireSystemdUserAvailable(async () => {
        throw Object.assign(new Error('timeout'), { killed: true });
      })).rejects.toMatchObject({
        code: 'SYSTEMD_USER_UNAVAILABLE',
        reason: 'timeout',
        message: expect.stringMatching(/timeout.*no fallback scheduler.*D-Bus session is responsive/i),
      });
      await expect(requireSystemdUserAvailable(async () => {
        throw Object.assign(new Error('down'), { stderr: 'Failed to connect to bus' });
      })).rejects.toMatchObject({
        code: 'SYSTEMD_USER_UNAVAILABLE',
        reason: 'no-user-manager',
        message: expect.stringMatching(/no-user-manager.*Failed to connect to bus.*no fallback scheduler.*XDG_RUNTIME_DIR/i),
      });
    }

    expect(await probeLingerEnabledWith(async (_f, a) => {
      expect(a.slice(0, 4)).toEqual(['show-user', '--property=Linger', '--value', '--']);
      return { stdout: 'no\n', stderr: '' };
    })).toBe(false);

    const lingerSeen: string[][] = [];
    expect(await probeLingerEnabledWith(
      async (_f, a) => {
        lingerSeen.push([...a]);
        return { stdout: 'yes\n', stderr: '' };
      },
      undefined,
      { userInfo: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, env: {}, getuid: () => 1042 },
    )).toBe(true);
    expect(lingerSeen[0]).toEqual(['show-user', '--property=Linger', '--value', '--', '1042']);
  });
});
