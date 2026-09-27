import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/logger';
import type { LedgerDatabase } from '../../src/services/llm-metering/budget-admission';
import {
  loadReservationReaperConfig, runReservationReaperSweep, startReservationReaper,
} from '../../src/services/llm-metering/reservation-reaper';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('reservation reaper schedule', () => {
  it('should default on only for gateway processes and support an explicit off switch', () => {
    expect(loadReservationReaperConfig({}, true)).toEqual({ enabled: true, intervalMs: 300_000, limit: 100 });
    expect(loadReservationReaperConfig({}, false).enabled).toBe(false);
    expect(loadReservationReaperConfig({ LLM_RESERVATION_REAPER_ENABLED: 'true' }, false).enabled).toBe(false);
    expect(loadReservationReaperConfig({ LLM_RESERVATION_REAPER_ENABLED: 'false' }, true).enabled).toBe(false);
    expect(loadReservationReaperConfig({ LLM_RESERVATION_REAPER_INTERVAL_MS: '50', LLM_RESERVATION_REAPER_LIMIT: '7' }, true))
      .toEqual({ enabled: true, intervalMs: 50, limit: 7 });
  });

  it.each(['0', '-1', '1.5', 'NaN', '', '2147483648', 'secret'])('should reject invalid bounds without echoing %s', (value) => {
    for (const field of ['LLM_RESERVATION_REAPER_INTERVAL_MS', 'LLM_RESERVATION_REAPER_LIMIT']) {
      expect(() => loadReservationReaperConfig({ [field]: value }, true)).toThrow(`${field}: must be a positive 32-bit integer`);
    }
    expect(() => loadReservationReaperConfig({ LLM_RESERVATION_REAPER_ENABLED: value }, true))
      .toThrow('LLM_RESERVATION_REAPER_ENABLED: must be true or false');
  });

  it('should sweep at boot and periodically, skip overlap and fence shutdown', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const sweep = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const reaper = startReservationReaper({ enabled: true, intervalMs: 50, limit: 7 }, sweep);
    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledWith(7);
    await vi.advanceTimersByTimeAsync(150);
    expect(sweep).toHaveBeenCalledOnce();
    finish();
    await vi.advanceTimersByTimeAsync(50);
    expect(sweep).toHaveBeenCalledTimes(2);
    let stopped = false;
    const stopping = reaper.stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(150);
    expect(stopped).toBe(false);
    expect(sweep).toHaveBeenCalledTimes(2);
    finish();
    await stopping;
    await vi.advanceTimersByTimeAsync(150);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should do no work when disabled or stopped before boot begins', async () => {
    vi.useFakeTimers();
    const sweep = vi.fn();
    const config = { enabled: false, intervalMs: 50, limit: 1 };
    const disabled = startReservationReaper(config, sweep);
    const stopped = startReservationReaper({ ...config, enabled: true }, sweep);
    await stopped.stop();
    await vi.advanceTimersByTimeAsync(150);
    expect(sweep).not.toHaveBeenCalled();
    await disabled.stop();
  });

  it('should recover after a failed sweep and log counts without error contents', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const sweep = vi.fn().mockRejectedValueOnce(new Error('secret SQL params')).mockResolvedValue(undefined);
    const reaper = startReservationReaper({ enabled: true, intervalMs: 50, limit: 1 }, sweep);
    await vi.advanceTimersByTimeAsync(50);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledExactlyOnceWith({ released: 0, reconciled: 0, failed: 1 }, 'reservation-reaper: sweep');
    await reaper.stop();
  });

  it('should contain candidate query failures and report successful empty sweeps using counts only', async () => {
    const log = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const execute = vi.fn().mockRejectedValueOnce(new Error('secret SQL params')).mockResolvedValue({ rows: [] });
    const database = { execute } as unknown as LedgerDatabase;
    await expect(runReservationReaperSweep({ database })).resolves.toEqual({ released: 0, reconciled: 0, failed: 1 });
    await expect(runReservationReaperSweep({ database })).resolves.toEqual({ released: 0, reconciled: 0, failed: 0 });
    expect(log.mock.calls).toEqual([
      [{ released: 0, reconciled: 0, failed: 1 }, 'reservation-reaper: sweep'],
      [{ released: 0, reconciled: 0, failed: 0 }, 'reservation-reaper: sweep'],
    ]);
  });
});
