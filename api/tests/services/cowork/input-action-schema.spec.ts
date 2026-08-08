import { describe, expect, it } from 'vitest';

import { isCoworkInputAction, isCoworkLiteralText } from '../../../src/services/cowork/input-action-schema';

describe('Cowork input action schema', () => {
  it('accepts only bounded printable literal type text', () => {
    expect(isCoworkInputAction({ action: 'type', text: 'A safe sentence.' })).toBe(true);
    for (const text of ['\t', '\u001b', '\u007f', '\u0085', '\u2028', '\u2029', '\r', '\n', '\u200d', '\ud800']) {
      expect(isCoworkLiteralText(`safe${text}text`)).toBe(false);
      expect(isCoworkInputAction({ action: 'type', text: `safe${text}text` })).toBe(false);
    }
  });
});
