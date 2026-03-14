import { describe, expect, it } from 'vitest';
import { formatCompactModelLabel } from '../../src/lib/utils/model-display';

describe('model display utils', () => {
  it('returns empty string for missing or blank values', () => {
    expect(formatCompactModelLabel(undefined)).toBe('');
    expect(formatCompactModelLabel(null)).toBe('');
    expect(formatCompactModelLabel('   ')).toBe('');
  });

  it('returns short labels for known models', () => {
    expect(formatCompactModelLabel('gpt-5.4')).toBe('GPT-5.4');
    expect(formatCompactModelLabel('gpt-4.1')).toBe('GPT-4.1');
    expect(formatCompactModelLabel('gpt-4.1-nano')).toBe('GPT-4.1 Nano');
    expect(formatCompactModelLabel('gemini-3.1-pro-preview-customtools')).toBe('Gemini 3.1 Pro');
    expect(formatCompactModelLabel('gemini-3.1-flash-lite-preview')).toBe('Flash Lite');
    expect(formatCompactModelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(formatCompactModelLabel('claude-opus-4-6')).toBe('Opus 4.6');
    expect(formatCompactModelLabel('devstral-2512')).toBe('Devstral 2');
    expect(formatCompactModelLabel('magistral-medium-2509')).toBe('Magistral 1.2');
    expect(formatCompactModelLabel('command-a-03-2025')).toBe('Command A');
    expect(formatCompactModelLabel('command-a-reasoning-08-2025')).toBe('Command A R.');
  });

  it('returns raw model id for unknown models', () => {
    expect(formatCompactModelLabel('some-future-model')).toBe('some-future-model');
  });
});
