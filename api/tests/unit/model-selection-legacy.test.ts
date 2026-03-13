import { describe, expect, it } from 'vitest';
import {
  findLegacyModelCutoverRule,
  normalizeLegacyModelSelection,
} from '../../src/services/model-selection-legacy';

describe('model selection legacy cutovers', () => {
  it('maps gpt-5.2 to gpt-5.4 on the openai provider', () => {
    expect(findLegacyModelCutoverRule('gpt-5.2')).toEqual({
      providerId: 'openai',
      fromModelId: 'gpt-5.2',
      toModelId: 'gpt-5.4',
    });

    expect(
      normalizeLegacyModelSelection({
        providerId: 'openai',
        modelId: 'gpt-5.2',
      })
    ).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.4',
      migrated: true,
    });
  });

  it('maps gemini-2.5-flash-lite to gemini-3.1-flash-lite', () => {
    expect(findLegacyModelCutoverRule('gemini-2.5-flash-lite')).toEqual({
      providerId: 'gemini',
      fromModelId: 'gemini-2.5-flash-lite',
      toModelId: 'gemini-3.1-flash-lite',
    });

    expect(
      normalizeLegacyModelSelection({
        providerId: 'gemini',
        modelId: 'gemini-2.5-flash-lite',
      })
    ).toEqual({
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      migrated: true,
    });
  });

  it('leaves non-legacy ids unchanged', () => {
    expect(
      normalizeLegacyModelSelection({
        providerId: 'openai',
        modelId: 'gpt-4.1-nano',
      })
    ).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4.1-nano',
      migrated: false,
    });
  });

  it('leaves Claude model ids unchanged (no legacy rules)', () => {
    expect(
      normalizeLegacyModelSelection({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-6',
      })
    ).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      migrated: false,
    });
  });

  it('leaves Mistral model ids unchanged (no legacy rules)', () => {
    expect(
      normalizeLegacyModelSelection({
        providerId: 'mistral',
        modelId: 'mistral-large-2512',
      })
    ).toEqual({
      providerId: 'mistral',
      modelId: 'mistral-large-2512',
      migrated: false,
    });
  });

  it('leaves Cohere model ids unchanged (no legacy rules)', () => {
    expect(
      normalizeLegacyModelSelection({
        providerId: 'cohere',
        modelId: 'command-a-03-2025',
      })
    ).toEqual({
      providerId: 'cohere',
      modelId: 'command-a-03-2025',
      migrated: false,
    });
  });
});
