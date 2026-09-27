import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostApp, createLedgerDependencies } from '../src/app';
import { loadHostConfig } from '../src/config';
import { handleShutdownSignals, startHost } from '../src/lifecycle';
import { testConfig } from './fixtures';
import type { LedgerDatabase } from '../../../api/src/services/llm-metering/budget-admission';

const counts = { released: 0, reconciled: 0, failed: 0 };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('host reservation reaper', () => {
  it('should bind the composed reaper to the injected ledger database', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const ledger = createLedgerDependencies({ database: { execute } as unknown as LedgerDatabase, ownerRef: 'test' });
    const host = await createHostApp({ config: testConfig(), dependencies: ledger });
    await expect(host.reaper!(7)).resolves.toEqual(counts);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('should parse explicit interval, limit and disable settings', () => {
    expect(loadHostConfig({ NODE_ENV: 'test', LLM_RESERVATION_REAPER_INTERVAL_MS: '25',
      LLM_RESERVATION_REAPER_LIMIT: '3', LLM_RESERVATION_REAPER_ENABLED: 'false' }).reaper)
      .toEqual({ enabled: false, intervalMs: 25, limit: 3 });
    expect(() => loadHostConfig({ NODE_ENV: 'test', LLM_RESERVATION_REAPER_INTERVAL_MS: '0' })).toThrow();
  });

  it('should sweep by default at boot and periodically without overlapping work', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let finish!: (value: typeof counts) => void;
    const reaper = vi.fn(() => new Promise<typeof counts>((resolve) => { finish = resolve; }));
    const config = testConfig();
    const host = await createHostApp({ config, dependencies: { reaper } });
    const running = await startHost(host, config);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(reaper).toHaveBeenCalledExactlyOnceWith(100);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(reaper).toHaveBeenCalledOnce();
      finish(counts);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(reaper).toHaveBeenCalledTimes(2);
      const signals = new EventEmitter();
      const exit = vi.fn();
      handleShutdownSignals(signals, running, exit);
      signals.emit('SIGTERM');
      signals.emit('SIGTERM');
      await vi.advanceTimersByTimeAsync(600_000);
      expect(reaper).toHaveBeenCalledTimes(2);
      expect(exit).not.toHaveBeenCalled();
      finish(counts);
      await running.stop();
      await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
      await vi.advanceTimersByTimeAsync(600_000);
      expect(reaper).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { finish(counts); await running.stop(); }
  });

  it('should perform no boot or periodic sweep with the off switch', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const config = loadHostConfig({ NODE_ENV: 'test', PORT: '0', LLM_RESERVATION_REAPER_ENABLED: 'false' });
    const reaper = vi.fn().mockResolvedValue(counts);
    const host = await createHostApp({ config, dependencies: { reaper } });
    const running = await startHost(host, config);
    try {
      await vi.advanceTimersByTimeAsync(600_000);
      expect(reaper).not.toHaveBeenCalled();
    } finally { await running.stop(); }
  });

  it('should bound shutdown even when the ledger sweep never finishes', async () => {
    const config = testConfig();
    const reaper = vi.fn(() => new Promise<typeof counts>(() => undefined));
    const host = await createHostApp({ config, dependencies: { reaper } });
    const running = await startHost(host, config, { settleTimeoutMs: 10, log: () => undefined });
    await vi.waitFor(() => expect(reaper).toHaveBeenCalledOnce());
    expect(await running.stop()).toMatchObject({ settled: false });
  });
});
