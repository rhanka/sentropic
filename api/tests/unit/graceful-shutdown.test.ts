import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installGracefulShutdown, SHUTDOWN_DRAIN_MS, type ClosableServer } from '../../src/services/graceful-shutdown';

function fakeProcess() {
  const listeners = new Map<string, Array<() => void>>();
  const exit = vi.fn();
  return {
    exit,
    on(signal: NodeJS.Signals, listener: () => void) {
      listeners.set(signal, [...(listeners.get(signal) ?? []), listener]);
    },
    emit(signal: NodeJS.Signals) {
      for (const listener of listeners.get(signal) ?? []) listener();
    },
    signals: () => [...listeners.keys()].sort(),
  };
}

function fakeServer(closes: boolean) {
  const calls: string[] = [];
  const server: ClosableServer = {
    close(callback) {
      calls.push('close');
      if (closes) callback?.();
    },
    closeIdleConnections() {
      calls.push('closeIdleConnections');
    },
    closeAllConnections() {
      calls.push('closeAllConnections');
    },
  };
  return { server, calls };
}

describe('graceful shutdown', () => {
  const log = { info: vi.fn() };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should handle SIGTERM and SIGINT, so that Node as PID 1 does not ignore them', () => {
    const proc = fakeProcess();
    installGracefulShutdown({ log, proc });
    expect(proc.signals()).toEqual(['SIGINT', 'SIGTERM']);
  });

  it('should exit at once when no server is attached yet', () => {
    const proc = fakeProcess();
    installGracefulShutdown({ log, proc });
    proc.emit('SIGTERM');
    expect(proc.exit).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it('should stop accepting connections and exit when in-flight requests are done', () => {
    const proc = fakeProcess();
    const { server, calls } = fakeServer(true);
    installGracefulShutdown({ log, proc }).attach(server);
    proc.emit('SIGTERM');
    expect(calls).toEqual(['close', 'closeIdleConnections']);
    expect(proc.exit).toHaveBeenCalledWith(0);
    vi.advanceTimersByTime(SHUTDOWN_DRAIN_MS * 2);
    expect(proc.exit).toHaveBeenCalledTimes(1);
  });

  it('should close long-lived connections after the bounded drain and exit', () => {
    const proc = fakeProcess();
    const { server, calls } = fakeServer(false);
    installGracefulShutdown({ log, proc }).attach(server);
    proc.emit('SIGTERM');
    vi.advanceTimersByTime(SHUTDOWN_DRAIN_MS - 1);
    expect(proc.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['close', 'closeIdleConnections', 'closeAllConnections']);
    expect(proc.exit).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it('should close at once without a drain, so a development reload does not wait for open streams', () => {
    const proc = fakeProcess();
    const { server, calls } = fakeServer(false);
    installGracefulShutdown({ log, proc, drainMs: 0 }).attach(server);
    proc.emit('SIGTERM');
    vi.advanceTimersByTime(0);
    expect(calls).toEqual(['close', 'closeIdleConnections', 'closeAllConnections']);
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it('should keep the drain well inside the default 30 s termination grace period', () => {
    expect(SHUTDOWN_DRAIN_MS).toBeLessThanOrEqual(10_000);
  });

  it('should start one shutdown only when signals repeat', () => {
    const proc = fakeProcess();
    const { server, calls } = fakeServer(false);
    installGracefulShutdown({ log, proc }).attach(server);
    proc.emit('SIGTERM');
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    expect(calls.filter((call) => call === 'close')).toHaveLength(1);
  });

  it('should run onStop hooks once on signal to clear intervals and pause background workers', () => {
    const proc = fakeProcess();
    const { server } = fakeServer(false);
    const controller = installGracefulShutdown({ log, proc });
    let ticks = 0;
    const interval = setInterval(() => { ticks += 1; }, 1_000);
    const pauseQueue = vi.fn();
    controller.onStop(() => {
      clearInterval(interval);
      pauseQueue();
      return Promise.reject(new Error('non-fatal stop error'));
    });
    controller.attach(server);

    vi.advanceTimersByTime(2_000);
    expect(ticks).toBe(2);

    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    expect(pauseQueue).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SHUTDOWN_DRAIN_MS);
    expect(ticks).toBe(2);
    expect(proc.exit).toHaveBeenCalledTimes(1);
  });

  it('should be installed by both server entry points and attached to their listeners', () => {
    for (const entry of ['../../src/index.ts', '../../../apps/auth-idp/index.ts']) {
      const source = readFileSync(fileURLToPath(new URL(entry, import.meta.url)), 'utf8');
      expect(source).toContain("const shutdown = installGracefulShutdown({ log: logger, drainMs: env.NODE_ENV === 'production' ? undefined : 0 });");
      expect(source).toMatch(/shutdown\.attach\(serve\(\{ fetch: app\.fetch, port \}\)\);/);
    }
  });

  it('should stop every periodic sweep interval and pause QueueManager on API shutdown', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/index.ts', import.meta.url)), 'utf8');
    const allIntervals = source.match(/\bsetInterval\(/g) ?? [];
    const trackedIntervals = source.match(/trackSweep\(setInterval\(/g) ?? [];
    expect(allIntervals.length).toBeGreaterThanOrEqual(6);
    expect(trackedIntervals.length).toBe(allIntervals.length);
    expect(source).toContain('shutdown.onStop(');
    expect(source).toMatch(/loadedQueueManager\?\.pause\(\)/);
    expect(source).toContain('reservationReaper.stop()');
    expect(source).toContain('outboxDispatcher.stop()');
  });
});
