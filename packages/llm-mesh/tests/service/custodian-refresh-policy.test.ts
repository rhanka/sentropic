import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTODIAN_REFRESH_POLICY,
  refreshSkewMs,
  sanitizeCustodianRefreshPolicy,
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
    const issuedAt = T0;
    const expiresAt = T0 + 60 * MINUTE;
    expect(shouldRefreshProactively({ expiresAtMs: expiresAt, issuedAtMs: issuedAt,
      nowMs: T0 + 50 * MINUTE })).toBe(true);
    expect(shouldRefreshProactively({ expiresAtMs: expiresAt, issuedAtMs: issuedAt,
      nowMs: T0 + 10 * MINUTE })).toBe(false);
    expect(shouldRefreshProactively({ expiresAtMs: T0 - MINUTE, issuedAtMs: issuedAt,
      nowMs: T0 })).toBe(true);
  });

  it('should sanitize an invalid host policy to safe bounds', () => {
    expect(sanitizeCustodianRefreshPolicy(undefined)).toEqual(DEFAULT_CUSTODIAN_REFRESH_POLICY);
    expect(sanitizeCustodianRefreshPolicy({ skewRatio: Number.NaN, minSkewMs: -1 }))
      .toEqual(DEFAULT_CUSTODIAN_REFRESH_POLICY);
    expect(sanitizeCustodianRefreshPolicy({ skewRatio: 2, minSkewMs: 60_000 }))
      .toEqual({ skewRatio: 0.25, minSkewMs: 60_000 });
    expect(sanitizeCustodianRefreshPolicy({ skewRatio: 0.5, minSkewMs: Number.POSITIVE_INFINITY }))
      .toEqual({ skewRatio: 0.5, minSkewMs: 600_000 });
  });

  it('should bound the window by credential issuance, not enrollment age', () => {
    // A credential issued at T0 with a 60-minute TTL opens a 15-minute
    // window however old the enrollment is; otherwise every tick refreshes.
    const expiresAt = T0 + 60 * MINUTE;
    expect(shouldRefreshProactively({ expiresAtMs: expiresAt, issuedAtMs: T0,
      nowMs: T0 + 30 * MINUTE })).toBe(false);
    expect(shouldRefreshProactively({ expiresAtMs: expiresAt, issuedAtMs: T0,
      nowMs: T0 + 50 * MINUTE })).toBe(true);
  });
});
