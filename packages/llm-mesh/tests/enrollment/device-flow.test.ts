import { describe, expect, it, vi } from 'vitest';

import { runDeviceFlowUntilComplete } from '../../src/enrollment/device-flow.js';

const grant = (over: Record<string, unknown> = {}) => ({
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  ...over,
});

describe('runDeviceFlowUntilComplete (shared RFC 8628 poller)', () => {
  it('returns the grant after pending polls', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const poll = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? { status: 'pending' as const } : { status: 'complete' as const, payload: grant() };
    });

    const out = await runDeviceFlowUntilComplete({
      poll,
      pollIntervalMs: 1000,
      sleep,
    });

    expect(out.access_token).toBe('access-1');
    expect(poll).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('backs off on slow_down without hammering', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const poll = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { status: 'slow_down' as const };
      if (calls === 2) return { status: 'pending' as const };
      return { status: 'complete' as const, payload: grant() };
    });

    await runDeviceFlowUntilComplete({ poll, pollIntervalMs: 1000, sleep });

    // First wait at the base interval, then doubled after slow_down.
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('fails up on access_denied', async () => {
    const poll = vi.fn(async () => ({ status: 'denied' as const, error: 'access_denied' }));
    await expect(
      runDeviceFlowUntilComplete({ poll, pollIntervalMs: 10, sleep: async () => {} }),
    ).rejects.toThrow('denied');
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('fails up on expired_token', async () => {
    const poll = vi.fn(async () => ({ status: 'expired' as const }));
    await expect(
      runDeviceFlowUntilComplete({ poll, pollIntervalMs: 10, sleep: async () => {} }),
    ).rejects.toThrow('expired');
  });

  it('fails after max attempts instead of looping forever', async () => {
    const poll = vi.fn(async () => ({ status: 'pending' as const }));
    await expect(
      runDeviceFlowUntilComplete({ poll, pollIntervalMs: 1, sleep: async () => {}, maxAttempts: 3 }),
    ).rejects.toThrow('attempts');
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('aborts when cancelled', async () => {
    let cancelled = false;
    const poll = vi.fn(async () => {
      cancelled = true;
      return { status: 'pending' as const };
    });
    await expect(
      runDeviceFlowUntilComplete({
        poll,
        pollIntervalMs: 1,
        sleep: async () => {},
        isCancelled: () => cancelled,
      }),
    ).rejects.toThrow('cancelled');
  });

  it('rejects a grant without access token', async () => {
    const poll = vi.fn(async () => ({ status: 'complete' as const, payload: { refresh_token: 'r' } }));
    await expect(
      runDeviceFlowUntilComplete({ poll, pollIntervalMs: 1, sleep: async () => {} }),
    ).rejects.toThrow('access token');
  });
});
