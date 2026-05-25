export const providerIds = ['openai', 'gemini', 'anthropic', 'mistral', 'cohere'] as const;

export type ProviderId = (typeof providerIds)[number];

export type ProviderStatus = 'ready' | 'planned';

export type ProviderFamily = 'openai' | 'google' | 'anthropic' | 'mistral' | 'cohere';

export type ReasoningTier = 'none' | 'light' | 'standard' | 'advanced';

export type ModelTaskHint = 'chat' | 'structured' | 'summary' | 'doc';

export const knownModelIds = [
  'gpt-5.5',
  'gpt-5.4-nano',
  'gpt-4.1-nano',
  'gpt-image-2',
  'gpt-image-1.5',
  'gpt-image-1',
  'gpt-image-1-mini',
  'gemini-3.5-flash',
  'gemini-3.5-thinking',
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'mistral-medium-latest',
  'mistral-large-latest',
  'mistral-small-2603',
  'magistral-medium-2509',
  'command-a-03-2025',
  'command-a-reasoning-08-2025',
] as const;

export type KnownModelId = (typeof knownModelIds)[number];

export type ModelId = KnownModelId | (string & {});

export type QualifiedModelId = `${ProviderId}:${string}`;

export const knownModelIdsByProvider = {
  openai: [
    'gpt-5.5',
    'gpt-5.4-nano',
    'gpt-4.1-nano',
    'gpt-image-2',
    'gpt-image-1.5',
    'gpt-image-1',
    'gpt-image-1-mini',
  ],
  gemini: ['gemini-3.5-flash', 'gemini-3.5-thinking', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image', 'gemini-3-pro-image-preview'],
  mistral: ['mistral-medium-latest', 'mistral-large-latest', 'mistral-small-2603', 'magistral-medium-2509'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-7'],
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
