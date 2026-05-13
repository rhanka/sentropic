import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the store to return known labels
vi.mock('$lib/stores/modelCatalog', () => {
  const labels = new Map([
    ['gpt-5.5', 'GPT-5.5'],
    ['claude-sonnet-4-6', 'Sonnet 4.6'],
    ['magistral-medium-2509', 'Magistral Medium'],
    ['devstral-2512', 'Devstral 2'],
  ]);
  return {
    getModelLabel: (id: string | null | undefined) => {
      if (!id) return '';
      return labels.get(id) ?? id;
    },
  };
});

import { formatCompactModelLabel } from '../../src/lib/utils/model-display';

describe('model display utils', () => {
  it('returns empty string for missing or blank values', () => {
    expect(formatCompactModelLabel(undefined)).toBe('');
    expect(formatCompactModelLabel(null)).toBe('');
    expect(formatCompactModelLabel('   ')).toBe('');
  });

  it('returns short labels from catalog for known models', () => {
    expect(formatCompactModelLabel('gpt-5.5')).toBe('GPT-5.5');
    expect(formatCompactModelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(formatCompactModelLabel('magistral-medium-2509')).toBe('Magistral Medium');
    expect(formatCompactModelLabel('devstral-2512')).toBe('Devstral 2');
  });

  it('returns raw model id for unknown models', () => {
    expect(formatCompactModelLabel('some-future-model')).toBe('some-future-model');
  });
});
