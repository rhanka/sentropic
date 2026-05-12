export const providerIds = ['openai', 'gemini', 'anthropic', 'mistral', 'cohere'] as const;

export type ProviderId = (typeof providerIds)[number];

export type ProviderStatus = 'ready' | 'planned';

export type ProviderFamily = 'openai' | 'google' | 'anthropic' | 'mistral' | 'cohere';

export type ReasoningTier = 'none' | 'light' | 'standard' | 'advanced';

export type ModelTaskHint = 'chat' | 'structured' | 'summary' | 'doc';

export const knownModelIds = [
  'gpt-5.4',
  'gpt-5.4-nano',
  'gpt-4.1-nano',
  'gemini-3.1-pro-preview-customtools',
  'gemini-3.1-flash-lite-preview',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'mistral-small-2603',
  'magistral-medium-2509',
  'command-a-03-2025',
  'command-a-reasoning-08-2025',
] as const;

export type KnownModelId = (typeof knownModelIds)[number];

export type ModelId = KnownModelId | (string & {});

export type QualifiedModelId = `${ProviderId}:${string}`;

export const knownModelIdsByProvider = {
  openai: ['gpt-5.4', 'gpt-5.4-nano', 'gpt-4.1-nano'],
  gemini: ['gemini-3.1-pro-preview-customtools', 'gemini-3.1-flash-lite-preview'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6'],
  mistral: ['mistral-small-2603', 'magistral-medium-2509'],
  cohere: ['command-a-03-2025', 'command-a-reasoning-08-2025'],
} as const satisfies Record<ProviderId, readonly KnownModelId[]>;

export interface ModelReference {
  providerId: ProviderId;
  modelId: ModelId;
}

export const toQualifiedModelId = (model: ModelReference): QualifiedModelId => {
  return `${model.providerId}:${model.modelId}`;
};

export const isProviderId = (value: string): value is ProviderId => {
  return providerIds.includes(value as ProviderId);
};

export const isKnownModelId = (value: string): value is KnownModelId => {
  return knownModelIds.includes(value as KnownModelId);
};
