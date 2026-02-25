import { providerRegistry } from './provider-registry';
import { isProviderId, type ModelCatalogEntry, type ProviderId } from './provider-runtime';
import { settingsService } from './settings';

export type ModelSelectionPair = {
  provider_id: ProviderId;
  model_id: string;
};

type CatalogProvider = {
  provider_id: ProviderId;
  label: string;
  status: 'ready' | 'planned';
  capabilities: {
    supports_tools: boolean;
    supports_streaming: boolean;
    supports_structured_output: boolean;
    supports_reasoning: boolean;
  };
};

type CatalogModel = {
  provider_id: ProviderId;
  model_id: string;
  label: string;
  reasoning_tier: 'none' | 'light' | 'standard' | 'advanced';
  supports_tools: boolean;
  supports_streaming: boolean;
  default_contexts: ('chat' | 'structured' | 'summary' | 'doc')[];
};

export type ModelCatalogPayload = {
  providers: CatalogProvider[];
  models: CatalogModel[];
  defaults: ModelSelectionPair;
};

const FALLBACK_DEFAULT: ModelSelectionPair = {
  provider_id: 'openai',
  model_id: 'gpt-4.1-nano',
};

const toCatalogModel = (entry: ModelCatalogEntry): CatalogModel => {
  return {
    provider_id: entry.providerId,
    model_id: entry.modelId,
    label: entry.label,
    reasoning_tier: entry.reasoningTier,
    supports_tools: entry.supportsTools,
    supports_streaming: entry.supportsStreaming,
    default_contexts: entry.defaultContexts,
  };
};

const findModel = (
  models: CatalogModel[],
  providerId: ProviderId,
  modelId: string
): CatalogModel | null => {
  return models.find(
    (model) => model.provider_id === providerId && model.model_id === modelId
  ) || null;
};

const findProviderDefaultModel = (
  models: CatalogModel[],
  providerId: ProviderId
): CatalogModel | null => {
  return (
    models.find(
      (model) =>
        model.provider_id === providerId && model.default_contexts.includes('chat')
    ) ||
    models.find((model) => model.provider_id === providerId) ||
    null
  );
};

export const inferProviderFromModelId = (
  models: CatalogModel[],
  modelId: string | null | undefined
): ProviderId | null => {
  const normalized = (modelId ?? '').trim();
  if (!normalized) return null;

  const matches = models.filter((model) => model.model_id === normalized);
  if (matches.length !== 1) return null;

  return matches[0].provider_id;
};

export const resolveDefaultSelection = (
  input: {
    providerId?: string | null;
    modelId?: string | null;
  },
  models: CatalogModel[]
): ModelSelectionPair => {
  const inferredProviderId = inferProviderFromModelId(models, input.modelId);

  const providerId =
    input.providerId && isProviderId(input.providerId)
      ? input.providerId
      : inferredProviderId || FALLBACK_DEFAULT.provider_id;

  const targetModelId = input.modelId || '';
  const exact = findModel(models, providerId, targetModelId);
  if (exact) {
    return {
      provider_id: exact.provider_id,
      model_id: exact.model_id,
    };
  }

  const providerDefault = findProviderDefaultModel(models, providerId);
  if (providerDefault) {
    return {
      provider_id: providerDefault.provider_id,
      model_id: providerDefault.model_id,
    };
  }

  const fallbackExact = findModel(
    models,
    FALLBACK_DEFAULT.provider_id,
    FALLBACK_DEFAULT.model_id
  );

  if (fallbackExact) {
    return {
      provider_id: fallbackExact.provider_id,
      model_id: fallbackExact.model_id,
    };
  }

  const first = models[0];
  if (first) {
    return {
      provider_id: first.provider_id,
      model_id: first.model_id,
    };
  }

  return FALLBACK_DEFAULT;
};

export const getModelCatalogPayload = async (options?: {
  userId?: string | null;
}): Promise<ModelCatalogPayload> => {
  const providers = providerRegistry.listProviders().map((provider) => ({
    provider_id: provider.providerId,
    label: provider.label,
    status: provider.status,
    capabilities: {
      supports_tools: provider.capabilities.supportsTools,
      supports_streaming: provider.capabilities.supportsStreaming,
      supports_structured_output: provider.capabilities.supportsStructuredOutput,
      supports_reasoning: provider.capabilities.supportsReasoning,
    },
  }));

  const models = providerRegistry.listModels().map(toCatalogModel);

  const settings = await settingsService.getAISettings({
    userId: options?.userId ?? null,
  });
  const defaults = resolveDefaultSelection(
    {
      providerId: settings.defaultProviderId,
      modelId: settings.defaultModel,
    },
    models
  );

  return {
    providers,
    models,
    defaults,
  };
};
