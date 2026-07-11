import { describe, expect, it } from 'vitest';
import {
  coerceSelectionToValidEntry,
  computeModelSelectorWidthCh,
  formatModelSelectionKey,
  getSelectedModelLabel,
  groupModelsByProvider,
  parseModelSelectionKey,
  providerGroupLabel,
  resolveFallbackModelOption,
  resolveHydratedModelSelection,
  type ModelCatalogModel,
  type ModelCatalogProvider,
} from '../src/utils/model-selection.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROVIDERS: ModelCatalogProvider[] = [
  { provider_id: 'openai', label: 'OpenAI', status: 'ready' },
  { provider_id: 'anthropic', label: 'Anthropic', status: 'ready' },
  { provider_id: 'gemini', label: 'Gemini', status: 'planned' },
];

const MODELS: ModelCatalogModel[] = [
  { provider_id: 'openai', model_id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', default_contexts: [] },
  { provider_id: 'openai', model_id: 'gpt-4o', label: 'GPT-4o', default_contexts: [] },
  { provider_id: 'anthropic', model_id: 'claude-opus-4', label: 'Claude Opus 4', default_contexts: [] },
  { provider_id: 'gemini', model_id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', default_contexts: [] },
];

// ---------------------------------------------------------------------------
// parseModelSelectionKey
// ---------------------------------------------------------------------------

describe('parseModelSelectionKey', () => {
  it('should parse a valid provider::model key', () => {
    expect(parseModelSelectionKey('openai::gpt-4o')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o',
    });
  });

  it('should parse all known providers', () => {
    const providers = ['openai', 'gemini', 'anthropic', 'mistral', 'cohere'] as const;
    for (const p of providers) {
      expect(parseModelSelectionKey(`${p}::some-model`)?.providerId).toBe(p);
    }
  });

  it('should return null when separator is missing', () => {
    expect(parseModelSelectionKey('openai:gpt-4o')).toBeNull();
    expect(parseModelSelectionKey('openaigpt-4o')).toBeNull();
  });

  it('should return null when provider segment is empty (key starts with ::)', () => {
    expect(parseModelSelectionKey('::gpt-4o')).toBeNull();
  });

  it('should return null when model segment is empty', () => {
    expect(parseModelSelectionKey('openai::')).toBeNull();
  });

  it('should return null for an unknown provider', () => {
    expect(parseModelSelectionKey('unknown::gpt-4o')).toBeNull();
    expect(parseModelSelectionKey('xai::grok-3')).toBeNull();
  });

  it('should return null for an empty string', () => {
    expect(parseModelSelectionKey('')).toBeNull();
  });

  it('should preserve model ids that contain :: correctly', () => {
    // Only the FIRST :: is the separator; rest is part of modelId
    const result = parseModelSelectionKey('openai::some::weird::model');
    // indexOf('::') at position 6, so modelId = 'some::weird::model'
    expect(result).toEqual({ providerId: 'openai', modelId: 'some::weird::model' });
  });
});

// ---------------------------------------------------------------------------
// formatModelSelectionKey
// ---------------------------------------------------------------------------

describe('formatModelSelectionKey', () => {
  it('should format provider and model into a composite key', () => {
    expect(formatModelSelectionKey('openai', 'gpt-4o')).toBe('openai::gpt-4o');
    expect(formatModelSelectionKey('anthropic', 'claude-opus-4')).toBe('anthropic::claude-opus-4');
  });

  it('should be round-trippable with parseModelSelectionKey', () => {
    const key = formatModelSelectionKey('gemini', 'gemini-2.0-flash');
    expect(parseModelSelectionKey(key)).toEqual({
      providerId: 'gemini',
      modelId: 'gemini-2.0-flash',
    });
  });
});

// ---------------------------------------------------------------------------
// groupModelsByProvider
// ---------------------------------------------------------------------------

describe('groupModelsByProvider', () => {
  it('should group models by provider in provider order', () => {
    const groups = groupModelsByProvider(PROVIDERS, MODELS);
    expect(groups).toHaveLength(3);
    expect(groups[0].provider.provider_id).toBe('openai');
    expect(groups[0].models).toHaveLength(2);
    expect(groups[1].provider.provider_id).toBe('anthropic');
    expect(groups[1].models).toHaveLength(1);
    expect(groups[2].provider.provider_id).toBe('gemini');
    expect(groups[2].models).toHaveLength(1);
  });

  it('should omit providers with no models', () => {
    const provs: ModelCatalogProvider[] = [
      { provider_id: 'cohere', label: 'Cohere', status: 'planned' },
      ...PROVIDERS,
    ];
    const groups = groupModelsByProvider(provs, MODELS);
    const ids = groups.map((g) => g.provider.provider_id);
    expect(ids).not.toContain('cohere');
  });

  it('should return an empty array when models list is empty', () => {
    expect(groupModelsByProvider(PROVIDERS, [])).toEqual([]);
  });

  it('should return an empty array when providers list is empty', () => {
    expect(groupModelsByProvider([], MODELS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveFallbackModelOption
// ---------------------------------------------------------------------------

describe('resolveFallbackModelOption', () => {
  it('should return exact match when provider and model both match', () => {
    const result = resolveFallbackModelOption(MODELS, 'openai', 'gpt-4.1-nano');
    expect(result?.model_id).toBe('gpt-4.1-nano');
    expect(result?.provider_id).toBe('openai');
  });

  it('should fall back to model-only match when provider differs', () => {
    // Simulate a model that moved provider (e.g. openai -> anthropic)
    const result = resolveFallbackModelOption(MODELS, 'openai', 'claude-opus-4');
    expect(result?.model_id).toBe('claude-opus-4');
  });

  it('should return null when neither provider+model nor model-only match exists', () => {
    const result = resolveFallbackModelOption(MODELS, 'openai', 'nonexistent-model');
    expect(result).toBeNull();
  });

  it('should return null when models list is empty', () => {
    expect(resolveFallbackModelOption([], 'openai', 'gpt-4o')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// coerceSelectionToValidEntry
// ---------------------------------------------------------------------------

describe('coerceSelectionToValidEntry', () => {
  it('should return the selection unchanged when an exact match exists', () => {
    const result = coerceSelectionToValidEntry(MODELS, 'openai', 'gpt-4o');
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-4o' });
  });

  it('should migrate to correct provider when model moved provider', () => {
    // claude-opus-4 belongs to anthropic; if selectedProviderId is openai, it should fix
    const result = coerceSelectionToValidEntry(MODELS, 'openai', 'claude-opus-4');
    expect(result).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-4' });
  });

  it('should fall back to first model for provider when model not found', () => {
    const result = coerceSelectionToValidEntry(MODELS, 'openai', 'nonexistent');
    // Should fall back to first model for 'openai'
    expect(result.providerId).toBe('openai');
    expect(['gpt-4.1-nano', 'gpt-4o']).toContain(result.modelId);
  });

  it('should fall back to first catalog model when provider has no models', () => {
    const modelsWithoutAnthropicAndGemini: ModelCatalogModel[] = [
      { provider_id: 'openai', model_id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', default_contexts: [] },
    ];
    const result = coerceSelectionToValidEntry(modelsWithoutAnthropicAndGemini, 'anthropic', 'nonexistent');
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-4.1-nano' });
  });

  it('should return the original pair unchanged when catalog is empty', () => {
    const result = coerceSelectionToValidEntry([], 'openai', 'gpt-4o');
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-4o' });
  });
});

// ---------------------------------------------------------------------------
// getSelectedModelLabel
// ---------------------------------------------------------------------------

describe('getSelectedModelLabel', () => {
  it('should return the label for an exact match', () => {
    expect(getSelectedModelLabel(MODELS, 'openai', 'gpt-4.1-nano')).toBe('GPT-4.1 Nano');
  });

  it('should fall back to the raw modelId when catalog is empty', () => {
    expect(getSelectedModelLabel([], 'openai', 'gpt-4o')).toBe('gpt-4o');
  });

  it('should fall back to the raw modelId when model is not in catalog', () => {
    expect(getSelectedModelLabel(MODELS, 'openai', 'unknown-model')).toBe('unknown-model');
  });
});

// ---------------------------------------------------------------------------
// computeModelSelectorWidthCh
// ---------------------------------------------------------------------------

describe('computeModelSelectorWidthCh', () => {
  it('should return at least 18 ch as minimum', () => {
    expect(computeModelSelectorWidthCh([], [], 'openai', 'x')).toBeGreaterThanOrEqual(18);
  });

  it('should use longest label + 4 when groups have labels', () => {
    const groups = groupModelsByProvider(PROVIDERS, MODELS);
    const result = computeModelSelectorWidthCh(groups, MODELS, 'openai', 'gpt-4.1-nano');
    // Longest label: 'Claude Opus 4' = 13 chars → 13 + 4 = 17, which is < 18, so minimum = 18
    // Actually 'Gemini 2.0 Flash' = 16 chars → 16 + 4 = 20 > 18
    expect(result).toBe(20);
  });

  it('should fall back to selected model label when groups is empty', () => {
    // When groups is empty, uses the selectedModel label length
    const result = computeModelSelectorWidthCh([], MODELS, 'openai', 'gpt-4.1-nano');
    // 'GPT-4.1 Nano'.length = 12, 12 + 4 = 16, min 18 => 18
    expect(result).toBe(18);
  });

  it('should use minimum 18 even when longest label is short', () => {
    const shortModels: ModelCatalogModel[] = [
      { provider_id: 'openai', model_id: 'gpt', label: 'GPT', default_contexts: [] },
    ];
    const shortProviders: ModelCatalogProvider[] = [
      { provider_id: 'openai', label: 'OpenAI', status: 'ready' },
    ];
    const groups = groupModelsByProvider(shortProviders, shortModels);
    // 'GPT'.length = 3, 3 + 4 = 7, min 18 => 18
    expect(computeModelSelectorWidthCh(groups, shortModels, 'openai', 'gpt')).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// providerGroupLabel
// ---------------------------------------------------------------------------

describe('providerGroupLabel', () => {
  it('should return the plain label for a ready provider', () => {
    const p: ModelCatalogProvider = { provider_id: 'openai', label: 'OpenAI', status: 'ready' };
    expect(providerGroupLabel(p)).toBe('OpenAI');
  });

  it('should append the status in parentheses for non-ready providers', () => {
    const p: ModelCatalogProvider = { provider_id: 'gemini', label: 'Gemini', status: 'planned' };
    expect(providerGroupLabel(p)).toBe('Gemini (planned)');
  });
});

describe('resolveHydratedModelSelection (gold shell S2)', () => {
  const CATALOG: ModelCatalogModel[] = [
    { provider_id: 'openai', model_id: 'gpt-5.5', label: 'GPT-5.5' },
    { provider_id: 'anthropic', model_id: 'claude-opus', label: 'Claude Opus' },
  ] as ModelCatalogModel[];

  it('selects the catalog entry of the LAST assistant message carrying a model', () => {
    const entry = resolveHydratedModelSelection(
      [
        { role: 'assistant', model: 'claude-opus' },
        { role: 'user' },
        { role: 'assistant', model: 'gpt-5.5' },
      ],
      CATALOG,
    );
    expect(entry).toMatchObject({ provider_id: 'openai', model_id: 'gpt-5.5' });
  });

  it('skips assistant messages without a model', () => {
    const entry = resolveHydratedModelSelection(
      [
        { role: 'assistant', model: 'claude-opus' },
        { role: 'assistant', model: null },
      ],
      CATALOG,
    );
    expect(entry).toMatchObject({ model_id: 'claude-opus' });
  });

  it('returns null when the model is absent from the live catalog (dead id never re-selected)', () => {
    expect(
      resolveHydratedModelSelection([{ role: 'assistant', model: 'gone-model' }], CATALOG),
    ).toBeNull();
  });

  it('returns null when no assistant message carries a model', () => {
    expect(resolveHydratedModelSelection([{ role: 'user' }], CATALOG)).toBeNull();
  });
});
