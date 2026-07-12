import { describe, expect, it } from 'vitest';
import {
  findLegacyModelCutoverRule,
  normalizeLegacyModelSelection,
} from '../../src/services/model-selection-legacy';

describe('model selection legacy cutovers', () => {
  it('maps gpt-5.2 to gpt-5.6-luna on the openai provider', () => {
    expect(findLegacyModelCutoverRule('gpt-5.2')).toEqual({
      providerId: 'openai',
      fromModelId: 'gpt-5.2',
      toModelId: 'gpt-5.6-luna',
    });

    expect(
      normalizeLegacyModelSelection({
        providerId: 'openai',
        modelId: 'gpt-5.2',
      })
    ).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      migrated: true,
    });
  });

  it('cuts the openai default over from gpt-5.5 to gpt-5.6-luna', () => {
    expect(findLegacyModelCutoverRule('gpt-5.5')).toEqual({
      providerId: 'openai',
      fromModelId: 'gpt-5.5',
      toModelId: 'gpt-5.6-luna',
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

  it('maps retired gemini-3.1-flash-lite-preview to gemini-3.1-flash-lite', () => {
    expect(findLegacyModelCutoverRule('gemini-3.1-flash-lite-preview')).toEqual({
      providerId: 'gemini',
      fromModelId: 'gemini-3.1-flash-lite-preview',
      toModelId: 'gemini-3.1-flash-lite',
    });

    expect(
      normalizeLegacyModelSelection({
        providerId: 'gemini',
        modelId: 'gemini-3.1-flash-lite-preview',
      })
    ).toEqual({
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      migrated: true,
    });
  });

  it('maps erroneously-merged gemini-3.5-thinking to gemini-3.1-flash-lite', () => {
    expect(findLegacyModelCutoverRule('gemini-3.5-thinking')).toEqual({
      providerId: 'gemini',
      fromModelId: 'gemini-3.5-thinking',
      toModelId: 'gemini-3.1-flash-lite',
    });

    expect(
      normalizeLegacyModelSelection({
        providerId: 'gemini',
        modelId: 'gemini-3.5-thinking',
      })
    ).toEqual({
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-lite',
      migrated: true,
    });
  });

  it('maps gemini-3.1-pro-preview-customtools to gemini-3.5-flash', () => {
    expect(findLegacyModelCutoverRule('gemini-3.1-pro-preview-customtools')).toEqual({
      providerId: 'gemini',
      fromModelId: 'gemini-3.1-pro-preview-customtools',
      toModelId: 'gemini-3.5-flash',
    });

    expect(
      normalizeLegacyModelSelection({
        providerId: 'gemini',
        modelId: 'gemini-3.1-pro-preview-customtools',
      })
    ).toEqual({
      providerId: 'gemini',
      modelId: 'gemini-3.5-flash',
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

  it('migrates legacy Claude Sonnet and Opus ids', () => {
    expect(
      normalizeLegacyModelSelection({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-6',
      })
    ).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      migrated: true,
    });

    expect(
      normalizeLegacyModelSelection({
        providerId: 'anthropic',
        modelId: 'claude-opus-4-7',
      })
    ).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
      migrated: true,
    });
  });

  it('leaves Mistral model ids unchanged (no legacy rules)', () => {
    expect(
      normalizeLegacyModelSelection({
        providerId: 'mistral',
        modelId: 'magistral-medium-2509',
      })
    ).toEqual({
      providerId: 'mistral',
      modelId: 'magistral-medium-2509',
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
