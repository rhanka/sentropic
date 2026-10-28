import type { ModelCatalogModel, ModelProviderId } from '@sentropic/chat-ui/utils/model-selection';

/** Runtime model selection policy. */
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

/** Runtime model selection policy. */
export function resolveHydratedModelSelection(
  messages: ReadonlyArray<{ role: string; model?: string | null }>,
  catalogModels: ReadonlyArray<ModelCatalogModel>,
): ModelCatalogModel | null {
  const lastAssistantModel = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && Boolean(m.model))?.model;
  if (!lastAssistantModel) return null;
  return (
    catalogModels.find((entry) => entry.model_id === lastAssistantModel) ?? null
  );
}

