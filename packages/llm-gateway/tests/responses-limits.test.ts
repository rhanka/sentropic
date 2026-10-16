/**
 * Responses limits (spec §16.7): spec-valued engineering defaults plus a
 * validated host override — a stricter host limit wins, anything looser
 * clamps to the default, and non-finite/non-positive values fail fast.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESPONSES_LIMITS,
  resolveResponsesLimits,
} from '../src/responses-egress.js';

describe('responses limits (spec §16.7)', () => {
  it('pins the spec engineering defaults', () => {
    expect(DEFAULT_RESPONSES_LIMITS).toEqual({
      maxBodyBytes: 16_777_216,
      maxInputItems: 4096,
      maxTools: 256,
      maxOutputItems: 1024,
      maxSseEventBytes: 1_048_576,
      maxAccumulatedBytes: 8_388_608,
    });
  });

  it('resolves absent overrides to the defaults', () => {
    expect(resolveResponsesLimits()).toEqual(DEFAULT_RESPONSES_LIMITS);
    expect(resolveResponsesLimits({})).toEqual(DEFAULT_RESPONSES_LIMITS);
  });

  it('lets a stricter host override win, field by field', () => {
    expect(resolveResponsesLimits({ maxTools: 8, maxInputItems: 100 })).toMatchObject({
      maxTools: 8, maxInputItems: 100, maxOutputItems: 1024,
    });
  });

  it('clamps a looser host override to the spec default', () => {
    expect(resolveResponsesLimits({ maxTools: 512, maxBodyBytes: Number.MAX_SAFE_INTEGER }))
      .toMatchObject({ maxTools: 256, maxBodyBytes: 16_777_216 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '256', true])(
    'rejects a non-finite-or-positive maxTools override (%s)', (value) => {
      expect(() => resolveResponsesLimits({ maxTools: value })).toThrow(/maxTools/);
    },
  );

  it('ignores unknown override keys', () => {
    expect(resolveResponsesLimits({ maxTools: 8, bogus: 1 })).toMatchObject({ maxTools: 8 });
  });
});
