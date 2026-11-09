import { describe, expect, it } from 'vitest';
import {
  refreshSkewMs,
  shouldRefreshProactively,
} from '../../src/service/custodian-refresh.js';

const MINUTE = 60_000;
const T0 = Date.now();

describe('custodian refresh policy', () => {
  it('should open the window at 25 percent of TTL remaining', () => {
    expect(refreshSkewMs(60 * MINUTE)).toBe(15 * MINUTE);
  });

  it('should floor the window at 10 minutes for short TTLs', () => {
    expect(refreshSkewMs(20 * MINUTE)).toBe(10 * MINUTE);
    expect(refreshSkewMs(Number.NaN)).toBe(10 * MINUTE);
  });

  it('should refresh proactively inside the skew window under an injected clock', () => {
    const enrolledAt = T0;
    const expiresAt = T0 + 60 * MINUTE;
    expect(shouldRefreshProactively({ expiresAtMs: expiresAt, enrolledAtMs: enrolledAt,
      nowMs: T0 + 50 * MINUTE })).toBe(true);
    expect(shouldRefreshProactively({ expiresAtMs: expiresAt, enrolledAtMs: enrolledAt,
      nowMs: T0 + 10 * MINUTE })).toBe(false);
    expect(shouldRefreshProactively({ expiresAtMs: T0 - MINUTE, enrolledAtMs: enrolledAt,
      nowMs: T0 })).toBe(true);
  });
});
