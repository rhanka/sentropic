/**
 * CMP-P1 API adapter: settings-seeded prompt registry, digest-verified reads.
 */
import { describe, it, expect } from 'vitest';
import {
  createCmPromptRegistry,
  getCmPromptContent,
  seedCmPromptsFromSettings,
} from '../../src/services/prompts/cm-prompt-registry';

const record = {
  'signal-detect': {
    title: 'Signal detection',
    versions: { v1: { content: 'find signals', author: 'owner' } },
  },
};

describe('CMP-P1 API prompt adapter', () => {
  it('seeds from settings and serves digest-verified content', () => {
    const registry = createCmPromptRegistry();
    expect(seedCmPromptsFromSettings(registry, record)).toBe(1);
    const got = getCmPromptContent(registry, 'signal-detect', 'v1');
    expect(got?.content).toBe('find signals');
    expect(got?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('returns undefined for unknown prompts', () => {
    const registry = createCmPromptRegistry();
    seedCmPromptsFromSettings(registry, record);
    expect(getCmPromptContent(registry, 'ghost')).toBeUndefined();
  });
});
