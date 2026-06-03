/**
 * model-selection.ts — pure, framework-agnostic utilities for the model/provider selector.
 *
 * Extracted from AppChatPanel.svelte (lines 4159-4243, 5827-5849 on main).
 * No Svelte imports, no browser runtime — safe for node-only vitest.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Known provider IDs. Kept as a union so callers can switch exhaustively. */
export type ModelProviderId = 'openai' | 'gemini' | 'anthropic' | 'mistral' | 'cohere';

/** Thin catalog entry for a provider (mirrors API payload shape). */
export type ModelCatalogProvider = {
  provider_id: ModelProviderId;
  label: string;
  /** 'ready' = available; 'planned' = not yet available. */
  status: 'ready' | 'planned';
};

/** Thin catalog entry for a model (mirrors API payload shape). */
export type ModelCatalogModel = {
  provider_id: ModelProviderId;
  model_id: string;
  label: string;
  default_contexts: string[];
};

/** Grouped view: one provider + its models, used to render `<optgroup>`. */
export type ModelCatalogGroup = {
  provider: ModelCatalogProvider;
  models: ModelCatalogModel[];
};

/** Parsed result of a `'provider::model'` selection key. */
export type ParsedModelKey = {
  providerId: ModelProviderId;
  modelId: string;
};

// ---------------------------------------------------------------------------
// Known provider IDs (for parse validation)
// ---------------------------------------------------------------------------

const KNOWN_PROVIDER_IDS: ReadonlySet<string> = new Set<ModelProviderId>([
  'openai',
  'gemini',
  'anthropic',
  'mistral',
  'cohere',
]);

// ---------------------------------------------------------------------------
// Parse / format
// ---------------------------------------------------------------------------

/**
 * Parse a `'provider::model'` composite key into its components.
 *
 * Returns `null` if the value is missing the separator, has an empty model
 * segment, or contains an unrecognised provider id.
 */
export function parseModelSelectionKey(rawValue: string): ParsedModelKey | null {
  const separatorIndex = rawValue.indexOf('::');
  if (separatorIndex <= 0) return null;
  const providerId = rawValue.slice(0, separatorIndex);
  const modelId = rawValue.slice(separatorIndex + 2);
  if (!modelId) return null;
  if (!KNOWN_PROVIDER_IDS.has(providerId)) return null;
  return { providerId: providerId as ModelProviderId, modelId };
}

/**
 * Format a provider + model pair into the composite selection key used as
 * the `<option value>` and `bind:value` target.
 */
export function formatModelSelectionKey(
  providerId: ModelProviderId,
  modelId: string,
): string {
  return `${providerId}::${modelId}`;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Group a flat models list by provider, preserving the provider order from
 * `providers`.  Groups with no models are omitted.
 */
export function groupModelsByProvider(
  providers: ModelCatalogProvider[],
  models: ModelCatalogModel[],
): ModelCatalogGroup[] {
  return providers
    .map((provider) => ({
      provider,
      models: models.filter((m) => m.provider_id === provider.provider_id),
    }))
    .filter((group) => group.models.length > 0);
}

// ---------------------------------------------------------------------------
// Fallback selection
// ---------------------------------------------------------------------------

/**
 * Resolve the catalog entry that corresponds to the current
 * `(selectedProviderId, selectedModelId)` pair.
 *
 * Falls back in priority order:
 * 1. Exact provider + model match.
 * 2. Any entry with the same model_id (provider moved / renamed).
 * 3. `null` — caller renders a fallback `<option>`.
 */
export function resolveFallbackModelOption(
  models: ModelCatalogModel[],
  selectedProviderId: ModelProviderId,
  selectedModelId: string,
): ModelCatalogModel | null {
  return (
    models.find(
      (m) => m.provider_id === selectedProviderId && m.model_id === selectedModelId,
    ) ??
    models.find((m) => m.model_id === selectedModelId) ??
    null
  );
}

/**
 * Coerce `(selectedProviderId, selectedModelId)` to a valid catalog entry
 * when the catalog has loaded and the current selection is no longer present.
 *
 * Priority order:
 * 1. Exact match — no change.
 * 2. Match on `modelId` only (provider migrated).
 * 3. First model for the same `providerId`.
 * 4. First model in the catalog.
 *
 * Returns the original pair unchanged if the catalog is empty or the exact
 * match already exists.
 */
export function coerceSelectionToValidEntry(
  models: ModelCatalogModel[],
  selectedProviderId: ModelProviderId,
  selectedModelId: string,
): { providerId: ModelProviderId; modelId: string } {
  if (models.length === 0) {
    return { providerId: selectedProviderId, modelId: selectedModelId };
  }

  const exactMatch = models.find(
    (m) => m.provider_id === selectedProviderId && m.model_id === selectedModelId,
  );
  if (exactMatch) {
    return { providerId: selectedProviderId, modelId: selectedModelId };
  }

  const modelMatch = models.find((m) => m.model_id === selectedModelId);
  if (modelMatch) {
    return { providerId: modelMatch.provider_id, modelId: modelMatch.model_id };
  }

  const providerFallback =
    models.find((m) => m.provider_id === selectedProviderId) ?? models[0];
  return {
    providerId: providerFallback.provider_id,
    modelId: providerFallback.model_id,
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Return the display label for the currently-selected model, falling back
 * to the raw `modelId` string when the catalog is not yet loaded.
 */
export function getSelectedModelLabel(
  models: ModelCatalogModel[],
  selectedProviderId: ModelProviderId,
  selectedModelId: string,
): string {
  return (
    resolveFallbackModelOption(models, selectedProviderId, selectedModelId)?.label ??
    selectedModelId
  );
}

/**
 * Compute the minimum `ch` width required so the `<select>` element is wide
 * enough for the longest label in the catalog.
 *
 * Mirrors the app logic: `Math.max(longestLabelLength + 4, 18)`.
 * The `+4` accounts for browser-rendered dropdown arrow padding.
 */
export function computeModelSelectorWidthCh(
  groups: ModelCatalogGroup[],
  models: ModelCatalogModel[],
  selectedProviderId: ModelProviderId,
  selectedModelId: string,
): number {
  const labels = groups.flatMap((g) => g.models.map((m) => m.label));
  if (labels.length === 0) {
    labels.push(getSelectedModelLabel(models, selectedProviderId, selectedModelId));
  }
  const longest = labels.reduce((max, l) => Math.max(max, l.length), 0);
  return Math.max(longest + 4, 18);
}

/**
 * Build the `<optgroup>` label for a provider entry.
 *
 * 'ready' providers show the bare label; non-ready providers append the
 * status in parentheses.
 */
export function providerGroupLabel(provider: ModelCatalogProvider): string {
  return provider.status === 'ready'
    ? provider.label
    : `${provider.label} (${provider.status})`;
}
