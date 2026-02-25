import { describe, expect, it } from 'vitest';
import { formatCompactModelLabel } from '../../src/lib/utils/model-display';

describe('model display utils', () => {
  it('returns empty string for missing or blank values', () => {
    expect(formatCompactModelLabel(undefined)).toBe('');
    expect(formatCompactModelLabel(null)).toBe('');
    expect(formatCompactModelLabel('   ')).toBe('');
  });

  it('compacts long Gemini model identifiers', () => {
    expect(formatCompactModelLabel('gemini-3.1-pro-preview-customtools')).toBe(
      'gemini-3.1',
    );
    expect(formatCompactModelLabel('GEMINI-2.5-FLASH-LITE')).toBe(
      'gemini-2.5',
    );
    expect(formatCompactModelLabel('gemini-3-flash-preview')).toBe(
      'gemini-3',
    );
  });

  it('keeps non-Gemini model identifiers unchanged', () => {
    expect(formatCompactModelLabel('gpt-5.2')).toBe('gpt-5.2');
  });
});
