import { describe, expect, it } from 'vitest';
import { isBoundedJson, isCorrelationId, isMicroUsd } from '../src/judge/validation.js';

describe('judge request JSON boundary', () => {
  it('should preserve valid JSON and reject values JSON would silently coerce', () => {
    expect(isBoundedJson({ output: null, state: [0, false, 'text'] })).toBe(true);
    for (const value of [NaN, Infinity, undefined, 1n, new Date(), [undefined], Array(1)]) {
      expect(isBoundedJson(value)).toBe(false);
    }
  });
  it('should reject unsafe keys and accessors without invoking user code', () => {
    expect(isBoundedJson(JSON.parse('{"state":{"__proto__":{}}}'))).toBe(false);
    expect(isBoundedJson({ get output() { throw new Error('must not run'); } })).toBe(false);
    expect(isBoundedJson({ [Symbol('hidden')]: 'value' })).toBe(false);
  });
  it('should bound UTF-8 bytes, canonical money and correlation identifiers', () => {
    expect(isBoundedJson('é', 4)).toBe(true);
    expect(isBoundedJson('é', 3)).toBe(false);
    expect(['0', '42', '9007199254740993'].every(isMicroUsd)).toBe(true);
    expect(['01', '-1', '1.0', ' 1', '1e3'].some(isMicroUsd)).toBe(false);
    expect(isCorrelationId('call:one-1.2_3')).toBe(true);
    expect(isCorrelationId('a'.repeat(129))).toBe(false);
    expect(isCorrelationId('line\nbreak')).toBe(false);
  });
});
