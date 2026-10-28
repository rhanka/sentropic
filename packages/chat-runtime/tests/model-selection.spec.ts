import { describe, expect, it } from 'vitest';
import {
  computeModelSelectorWidthCh,
  formatModelSelectionKey,
  getSelectedModelLabel,
  groupModelsByProvider,
  parseModelSelectionKey,
  providerGroupLabel,
  resolveFallbackModelOption,
  type ModelCatalogModel,
  type ModelCatalogProvider,
} from '@sentropic/chat-ui/utils/model-selection';
import { coerceSelectionToValidEntry, resolveHydratedModelSelection } from '../src/utils/modelSelectionPolicy.js';

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
