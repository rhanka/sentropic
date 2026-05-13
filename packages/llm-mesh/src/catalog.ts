import {
  geminiUnsupportedJsonSchemaKeywords,
  type CapabilitySupport,
  type ModelCapabilities,
  type ProviderCapabilities,
} from './capabilities.js';
import type { AccountTransportProviderId, TokenAuthSourceType } from './auth.js';
import {
  type KnownModelId,
  type ModelId,
  type ModelTaskHint,
  type ProviderFamily,
  type ProviderId,
  type ProviderStatus,
  type ReasoningTier,
  providerIds,
} from './providers.js';

export interface ProviderDescriptor {
  providerId: ProviderId;
  family: ProviderFamily;
  label: string;
  status: ProviderStatus;
  capabilities: ProviderCapabilities;
}

export interface ModelProfile {
  providerId: ProviderId;
  modelId: KnownModelId;
  label: string;
  reasoningTier: ReasoningTier;
  defaultTaskHints: readonly ModelTaskHint[];
  capabilities: ModelCapabilities;
}

const tokenSources = [
  'direct-token',
  'user-token',
  'workspace-token',
  'environment-token',
] as const satisfies readonly TokenAuthSourceType[];

const toolChoice = ['auto', 'required', 'none'] as const;

const textModalities = {
  input: ['text'] as const,
  output: ['text', 'json', 'tool-call'] as const,
};

const auth = (
  accountTransports: readonly AccountTransportProviderId[] = [],
) => ({
  tokenSources,
  accountTransports,
});

const capabilities = (input: {
  reasoningTier: ReasoningTier;
  structuredOutputLevel: ProviderCapabilities['structuredOutput']['jsonSchema']['level'];
  accountTransports?: readonly AccountTransportProviderId[];
  supportsReasoning?: boolean;
  streamedArgumentDeltas?: CapabilitySupport;
  unsupportedKeywords?: readonly string[];
  stringEnumsOnly?: boolean;
}): ProviderCapabilities => ({
  tools: {
    support: 'unknown',
    parallelCalls: 'unknown',
    streamedArgumentDeltas: input.streamedArgumentDeltas ?? 'unknown',
    resultContinuation: 'unknown',
    toolChoice,
  },
  streaming: {
    support: 'unknown',
    nativeProviderChunks: 'unknown',
  },
  structuredOutput: {
    support:
      input.structuredOutputLevel === 'none'
        ? 'unsupported'
        : input.structuredOutputLevel === 'json-schema'
          ? 'supported'
          : 'partial',
    strategies: ['json-object', 'json-schema', 'tool-call'],
    jsonSchema: {
      support:
        input.structuredOutputLevel === 'none'
          ? 'unsupported'
          : input.structuredOutputLevel === 'json-schema'
            ? 'supported'
            : 'partial',
      level: input.structuredOutputLevel,
      strict: input.structuredOutputLevel === 'json-schema',
      ...(input.unsupportedKeywords ? { unsupportedKeywords: input.unsupportedKeywords } : {}),
      ...(typeof input.stringEnumsOnly === 'boolean'
        ? { stringEnumsOnly: input.stringEnumsOnly }
        : {}),
    },
  },
  reasoning: {
    support:
      input.supportsReasoning === false || input.reasoningTier === 'none'
        ? 'unsupported'
        : 'unknown',
    tier: input.reasoningTier,
    controls:
      input.supportsReasoning === false || input.reasoningTier === 'none'
        ? 'unsupported'
        : 'unknown',
    visibleSummaries:
      input.supportsReasoning === false || input.reasoningTier === 'none'
        ? 'unsupported'
        : 'unknown',
    hiddenSignatures:
      input.supportsReasoning === false || input.reasoningTier === 'none'
        ? 'unsupported'
        : 'unknown',
    tokenUsageAccounting:
      input.supportsReasoning === false || input.reasoningTier === 'none'
        ? 'unsupported'
        : 'unknown',
  },
  modalities: textModalities,
  auth: auth(input.accountTransports),
});

export const providerProfiles = {
  openai: {
    providerId: 'openai',
    family: 'openai',
    label: 'OpenAI',
    status: 'planned',
    capabilities: capabilities({
      reasoningTier: 'advanced',
      structuredOutputLevel: 'json-schema',
      accountTransports: ['codex'],
    }),
  },
  gemini: {
    providerId: 'gemini',
    family: 'google',
    label: 'Google Gemini',
    status: 'planned',
    capabilities: capabilities({
      reasoningTier: 'advanced',
      structuredOutputLevel: 'json-schema-subset',
      unsupportedKeywords: geminiUnsupportedJsonSchemaKeywords,
      stringEnumsOnly: true,
    }),
  },
  anthropic: {
    providerId: 'anthropic',
    family: 'anthropic',
    label: 'Anthropic Claude',
    status: 'planned',
    capabilities: capabilities({
      reasoningTier: 'advanced',
      structuredOutputLevel: 'tool-input-schema',
    }),
  },
  mistral: {
    providerId: 'mistral',
    family: 'mistral',
    label: 'Mistral AI',
    status: 'planned',
    capabilities: capabilities({
      reasoningTier: 'advanced',
      structuredOutputLevel: 'json-schema',
    }),
  },
  cohere: {
    providerId: 'cohere',
    family: 'cohere',
    label: 'Cohere',
    status: 'planned',
    capabilities: capabilities({
      reasoningTier: 'advanced',
      structuredOutputLevel: 'tool-input-schema',
    }),
  },
} as const satisfies Record<ProviderId, ProviderDescriptor>;

const modelCapabilities = (
  providerId: ProviderId,
  reasoningTier: ReasoningTier,
): ModelCapabilities => ({
  ...providerProfiles[providerId].capabilities,
  reasoning: {
    ...providerProfiles[providerId].capabilities.reasoning,
    support:
      providerProfiles[providerId].capabilities.reasoning.support === 'unsupported' ||
      reasoningTier === 'none'
        ? 'unsupported'
        : providerProfiles[providerId].capabilities.reasoning.support,
    tier: reasoningTier,
    controls:
      providerProfiles[providerId].capabilities.reasoning.support === 'unsupported' ||
      reasoningTier === 'none'
        ? 'unsupported'
        : 'unknown',
    visibleSummaries:
      providerProfiles[providerId].capabilities.reasoning.support === 'unsupported' ||
      reasoningTier === 'none'
        ? 'unsupported'
        : 'unknown',
    hiddenSignatures:
      providerProfiles[providerId].capabilities.reasoning.support === 'unsupported' ||
      reasoningTier === 'none'
        ? 'unsupported'
        : 'unknown',
    tokenUsageAccounting:
      providerProfiles[providerId].capabilities.reasoning.support === 'unsupported' ||
      reasoningTier === 'none'
        ? 'unsupported'
        : 'unknown',
  },
});

export const modelProfiles = [
  {
    providerId: 'openai',
    modelId: 'gpt-5.5',
    label: 'GPT-5.5',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat', 'structured', 'summary'],
    capabilities: modelCapabilities('openai', 'advanced'),
  },
  {
    providerId: 'openai',
    modelId: 'gpt-5.4-nano',
    label: 'GPT-5.4 Nano',
    reasoningTier: 'standard',
    defaultTaskHints: ['chat'],
    capabilities: modelCapabilities('openai', 'standard'),
  },
  {
    providerId: 'openai',
    modelId: 'gpt-4.1-nano',
    label: 'GPT-4.1 Nano',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: modelCapabilities('openai', 'none'),
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3.1-pro-preview-customtools',
    label: 'Gemini 3.1 Pro',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat', 'structured', 'summary'],
    capabilities: modelCapabilities('gemini', 'advanced'),
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3.1-flash-lite-preview',
    label: 'Gemini 3.1 Flash Lite',
    reasoningTier: 'standard',
    defaultTaskHints: ['chat'],
    capabilities: modelCapabilities('gemini', 'standard'),
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    reasoningTier: 'standard',
    defaultTaskHints: ['chat', 'structured'],
    capabilities: modelCapabilities('anthropic', 'standard'),
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-opus-4-7',
    label: 'Opus 4.6',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat', 'structured', 'summary'],
    capabilities: modelCapabilities('anthropic', 'advanced'),
  },
  {
    providerId: 'mistral',
    modelId: 'mistral-small-2603',
    label: 'Mistral Small 4',
    reasoningTier: 'standard',
    defaultTaskHints: ['chat'],
    capabilities: modelCapabilities('mistral', 'standard'),
  },
  {
    providerId: 'mistral',
    modelId: 'magistral-medium-2509',
    label: 'Magistral Medium',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat', 'structured', 'summary'],
    capabilities: modelCapabilities('mistral', 'advanced'),
  },
  {
    providerId: 'cohere',
    modelId: 'command-a-03-2025',
    label: 'Command A',
    reasoningTier: 'standard',
    defaultTaskHints: ['chat'],
    capabilities: modelCapabilities('cohere', 'standard'),
  },
  {
    providerId: 'cohere',
    modelId: 'command-a-reasoning-08-2025',
    label: 'Command A R.',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat', 'structured', 'summary'],
    capabilities: modelCapabilities('cohere', 'advanced'),
  },
] as const satisfies readonly ModelProfile[];

export const providerCapabilityMatrix = providerProfiles;

export const modelCapabilityMatrix = modelProfiles;

export const listProviderProfiles = (): readonly ProviderDescriptor[] => {
  return providerIds.map((providerId) => providerProfiles[providerId]);
};

export const listModelProfiles = (): readonly ModelProfile[] => {
  return modelProfiles;
};

export const listModelProfilesByProvider = (
  providerId: ProviderId,
): readonly ModelProfile[] => {
  return modelProfiles.filter((model) => model.providerId === providerId);
};

export const getProviderProfile = (
  providerId: ProviderId,
): ProviderDescriptor => {
  return providerProfiles[providerId];
};

export const getModelProfile = (
  providerId: ProviderId,
  modelId: ModelId,
): ModelProfile | null => {
  return (
    modelProfiles.find(
      (model) => model.providerId === providerId && model.modelId === modelId,
    ) ?? null
  );
};
