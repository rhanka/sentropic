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
