import { describe, expect, it } from 'vitest';

import { isCoworkInputAction, isCoworkLiteralText, parseCoworkInputAction } from '../../../src/services/cowork/input-action-schema';

describe('Cowork input action schema', () => {
  it('accepts only bounded printable literal type text', () => {
    expect(isCoworkInputAction({ action: 'type', text: 'A safe sentence.' })).toBe(true);
    for (const text of ['\t', '\u001b', '\u007f', '\u0085', '\u2028', '\u2029', '\r', '\n', '\u200d', '\ud800']) {
      expect(isCoworkLiteralText(`safe${text}text`)).toBe(false);
      expect(isCoworkInputAction({ action: 'type', text: `safe${text}text` })).toBe(false);
    }
  });

  it('accepts only exact discriminated action shapes and canonicalizes a missing click button', () => {
    expect(parseCoworkInputAction({ action: 'click', x: 10, y: -2 })).toEqual({ action: 'click', x: 10, y: -2, button: 'left' });
    expect(parseCoworkInputAction({ action: 'click', x: 10.5, y: 2 })).toBeNull();
    expect(parseCoworkInputAction({ action: 'click', x: 10, y: 2, button: 'right ' })).toBeNull();
    expect(parseCoworkInputAction({ action: 'click', x: 10, y: 2, extra: true })).toBeNull();
    expect(parseCoworkInputAction({ action: 'scroll', dx: 0, dy: 1 })).toEqual({ action: 'scroll', dx: 0, dy: 1 });
    expect(parseCoworkInputAction({ action: 'scroll', dx: 0, dy: 0 })).toBeNull();
    expect(parseCoworkInputAction({ action: 'scroll', dx: 0 })).toBeNull();
    expect(isCoworkInputAction({ action: 'type', text: 'safe', extra: true })).toBe(false);
  });
});
