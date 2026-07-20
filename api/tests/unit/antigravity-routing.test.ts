import { describe, expect, it } from 'vitest';

import {
  deriveProviderFamily,
  mapModelToAntigravityFleet,
} from '../../src/services/provider-connections';

// D3 routing map coverage: the requested catalog model/provider maps to the
// correct Antigravity FLEET wire id per family (the Antigravity fallback serves
// all three families through cloudcode-pa).

describe('antigravity routing — family derivation', () => {
  it('derives claude for anthropic models', () => {
    expect(deriveProviderFamily('anthropic', 'claude-sonnet-5')).toBe('claude');
    expect(deriveProviderFamily('gcp', 'anthropic/claude-opus-4-6@gcp')).toBe('claude');
  });

  it('derives gpt for openai models', () => {
    expect(deriveProviderFamily('openai', 'gpt-5.6-luna')).toBe('gpt');
    expect(deriveProviderFamily('openai', 'gpt-5.5')).toBe('gpt');
  });

  it('derives gemini for google models', () => {
    expect(deriveProviderFamily('gemini', 'gemini-3.5-flash')).toBe('gemini');
    expect(deriveProviderFamily('gcp', 'google/gemini-3.1-flash-lite@gcp')).toBe('gemini');
  });
});

describe('antigravity routing — fleet mapping', () => {
  it('maps claude models to the claude fleet (opus → thinking variant)', () => {
    expect(mapModelToAntigravityFleet('anthropic', 'claude-sonnet-5')).toBe('claude-sonnet-4-6');
    expect(mapModelToAntigravityFleet('anthropic', 'claude-opus-4-8')).toBe('claude-opus-4-6-thinking');
  });

  it('maps openai models to the gpt-oss fleet', () => {
    expect(mapModelToAntigravityFleet('openai', 'gpt-5.6-luna')).toBe('gpt-oss-120b-medium');
    expect(mapModelToAntigravityFleet('openai', 'gpt-5.5')).toBe('gpt-oss-120b-medium');
  });

  it('maps gemini models to the gemini-3-pro fleet (lite/low → low tier)', () => {
    expect(mapModelToAntigravityFleet('gemini', 'gemini-3.5-flash')).toBe('gemini-3-pro-high');
    expect(mapModelToAntigravityFleet('gemini', 'gemini-3.1-flash-lite')).toBe('gemini-3-pro-low');
  });
});
