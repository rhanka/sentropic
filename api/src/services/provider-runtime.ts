export type ProviderId = 'openai' | 'gemini';

export type ProviderStatus = 'ready' | 'planned';

export type ReasoningTier = 'none' | 'light' | 'standard' | 'advanced';

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

export const providerIds: ProviderId[] = ['openai', 'gemini'];

export const isProviderId = (value: string): value is ProviderId => {
  return providerIds.includes(value as ProviderId);
};
