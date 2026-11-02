import { describe, expect, it } from 'vitest';
import { federationAssertionExpiry } from '../../../src/services/auth/federation/assertion-expiry';

describe('verified upstream assertion lifetime', () => {
  it.each([undefined, null, '1800000000', 0, -1, Infinity, 1.5, Number.MAX_SAFE_INTEGER])(
    'refuses an absent or malformed expiry: %s', exp => {
      expect(() => federationAssertionExpiry({ exp })).toThrow('Invalid federation assertion expiry');
    });
  it('preserves the exact signed expiry instant without extending the evidence lifetime', () => {
    expect(federationAssertionExpiry({ exp: 1_800_000_000 })).toBe('2027-01-15T08:00:00.000Z');
  });
});
