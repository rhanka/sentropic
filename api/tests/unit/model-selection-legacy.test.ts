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
});
