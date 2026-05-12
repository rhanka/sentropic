import {
  getProviderProfile,
  listModelProfilesByProvider,
  providerIds as meshProviderIds,
  type CapabilitySupport,
  type ModelProfile,
  type ProviderId as MeshProviderId,
  type ReasoningTier as MeshReasoningTier,
} from '@sentropic/llm-mesh';

export type ProviderId = MeshProviderId;

export type ProviderStatus = 'ready' | 'planned';

export type ReasoningTier = MeshReasoningTier;

export type DefaultContext = 'chat' | 'structured' | 'summary' | 'doc';

export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
}

export interface ProviderDescriptor {
  providerId: ProviderId;
  label: string;
  status: ProviderStatus;
  capabilities: ProviderCapabilities;
}

export interface ModelCatalogEntry {
  providerId: ProviderId;
  modelId: string;
  label: string;
  reasoningTier: ReasoningTier;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsReasoning?: boolean;
  defaultContexts: DefaultContext[];
}

export interface CredentialValidationResult {
  ok: boolean;
  message?: string;
}

export interface NormalizedProviderError {
  providerId: ProviderId;
  message: string;
  code?: string;
  retryable?: boolean;
}

export interface ProviderRuntime {
  readonly provider: ProviderDescriptor;
  listModels(): ModelCatalogEntry[];
  generate(request: unknown): Promise<unknown>;
  streamGenerate(request: unknown): Promise<AsyncIterable<unknown>>;
  validateCredential(credential?: string): CredentialValidationResult;
  normalizeError(error: unknown): NormalizedProviderError;
}

export const providerIds: ProviderId[] = [...meshProviderIds];

export const isProviderId = (value: string): value is ProviderId => {
  return providerIds.includes(value as ProviderId);
};

const isAvailable = (support: CapabilitySupport): boolean => {
  return support !== 'unsupported';
};

const toRuntimeModel = (profile: ModelProfile): ModelCatalogEntry => ({
  providerId: profile.providerId,
  modelId: profile.modelId,
  label: profile.label,
  reasoningTier: profile.reasoningTier,
  supportsTools: isAvailable(profile.capabilities.tools.support),
  supportsStreaming: isAvailable(profile.capabilities.streaming.support),
  supportsReasoning: isAvailable(profile.capabilities.reasoning.support),
  defaultContexts: [...profile.defaultTaskHints],
});

export const listRuntimeModelsByProvider = (
  providerId: ProviderId,
): ModelCatalogEntry[] => {
  return listModelProfilesByProvider(providerId).map(toRuntimeModel);
};

export const buildRuntimeProviderDescriptor = (input: {
  providerId: ProviderId;
  ready: boolean;
}): ProviderDescriptor => {
  const profile = getProviderProfile(input.providerId);
  return {
    providerId: profile.providerId,
    label: profile.label,
    status: input.ready ? 'ready' : 'planned',
    capabilities: {
      supportsTools: isAvailable(profile.capabilities.tools.support),
      supportsStreaming: isAvailable(profile.capabilities.streaming.support),
      supportsStructuredOutput: isAvailable(profile.capabilities.structuredOutput.support),
      supportsReasoning: isAvailable(profile.capabilities.reasoning.support),
    },
  };
};
