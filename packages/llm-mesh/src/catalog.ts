import {
  geminiUnsupportedJsonSchemaKeywords,
  type CapabilitySupport,
  type ModelCapabilities,
  type ProviderCapabilities,
} from './capabilities.js';
import type { AccountTransportProviderId, TokenAuthSourceType } from './auth.js';
import type {
  ImageGenerationKind,
  ImageGenerationStatus,
} from './image-generation.js';
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

const defaultUnsupportedImageGeneration = {
  status: 'unsupported' as const,
  kind: 'none' as const,
};
const openaiImageGeneration = {
  status: 'supported' as const,
  kind: 'native-image-model' as const,
};
const geminiImageGeneration = {
  status: 'supported' as const,
  kind: 'gemini-generate-content' as const,
};
const mistralImageGeneration = {
  status: 'planned' as const,
  kind: 'provider-agent-tool' as const,
};

const textModalities = {
  input: ['text'] as const,
  output: ['text', 'json', 'tool-call', 'image'] as const,
};

const imageOutputModalities = {
  input: ['text', 'image'] as const,
  output: ['image'] as const,
};

const unsupportedTools = {
  support: 'unsupported' as const,
  parallelCalls: 'unsupported' as const,
  streamedArgumentDeltas: 'unsupported' as const,
  resultContinuation: 'unsupported' as const,
  toolChoice: ['none'] as const,
};

const unsupportedStreaming = {
  support: 'unsupported' as const,
  nativeProviderChunks: 'unsupported' as const,
};

const unsupportedStructuredOutput = {
  support: 'unsupported' as const,
  strategies: [] as const,
  jsonSchema: {
    support: 'unsupported' as const,
    level: 'none' as const,
    strict: false,
  },
};

const unsupportedReasoning = {
  support: 'unsupported' as const,
  tier: 'none' as const,
  controls: 'unsupported' as const,
  visibleSummaries: 'unsupported' as const,
  hiddenSignatures: 'unsupported' as const,
  tokenUsageAccounting: 'unsupported' as const,
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
  imageGeneration?: {
    status: ImageGenerationStatus;
    kind: ImageGenerationKind;
  };
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
  imageGeneration: input.imageGeneration ?? defaultUnsupportedImageGeneration,
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
      imageGeneration: openaiImageGeneration,
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
      imageGeneration: geminiImageGeneration,
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
      imageGeneration: defaultUnsupportedImageGeneration,
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
      imageGeneration: mistralImageGeneration,
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
      imageGeneration: defaultUnsupportedImageGeneration,
    }),
  },
} as const satisfies Record<ProviderId, ProviderDescriptor>;

const modelImageProfile = (
  status: ImageGenerationStatus,
  kind: ImageGenerationKind,
) => ({
  status,
  kind,
});

const modelCapabilities = (
  providerId: ProviderId,
  reasoningTier: ReasoningTier,
  imageGeneration: { status: ImageGenerationStatus; kind: ImageGenerationKind } = providerProfiles[providerId]
    .capabilities.imageGeneration,
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
  imageGeneration: modelImageProfile(imageGeneration.status, imageGeneration.kind),
});

const imageGenerationOnlyCapabilities = (
  providerId: ProviderId,
  imageGeneration: { status: ImageGenerationStatus; kind: ImageGenerationKind },
): ModelCapabilities => ({
  ...modelCapabilities(providerId, 'none', imageGeneration),
  tools: unsupportedTools,
  streaming: unsupportedStreaming,
  structuredOutput: unsupportedStructuredOutput,
  reasoning: unsupportedReasoning,
  modalities: imageOutputModalities,
  imageGeneration: modelImageProfile(imageGeneration.status, imageGeneration.kind),
});

export const modelProfiles = [
  {
    providerId: 'openai',
    modelId: 'gpt-5.5',
    label: 'GPT-5.5',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat', 'structured', 'summary'],
    capabilities: modelCapabilities('openai', 'advanced', defaultUnsupportedImageGeneration),
  },
  {
    providerId: 'openai',
    modelId: 'gpt-5.4-nano',
    label: 'GPT-5.4 Nano',
    reasoningTier: 'standard',
    defaultTaskHints: ['chat'],
    capabilities: modelCapabilities('openai', 'standard', defaultUnsupportedImageGeneration),
  },
  {
    providerId: 'openai',
    modelId: 'gpt-4.1-nano',
    label: 'GPT-4.1 Nano',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: modelCapabilities('openai', 'none', defaultUnsupportedImageGeneration),
  },
  {
    providerId: 'openai',
    modelId: 'gpt-image-2',
    label: 'GPT Image 2',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: imageGenerationOnlyCapabilities('openai', openaiImageGeneration),
  },
  {
    providerId: 'openai',
    modelId: 'gpt-image-1.5',
    label: 'GPT Image 1.5',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: imageGenerationOnlyCapabilities('openai', openaiImageGeneration),
  },
  {
    providerId: 'openai',
    modelId: 'gpt-image-1',
    label: 'GPT Image 1',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: imageGenerationOnlyCapabilities('openai', openaiImageGeneration),
  },
  {
    providerId: 'openai',
    modelId: 'gpt-image-1-mini',
    label: 'GPT Image 1 Mini',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: imageGenerationOnlyCapabilities('openai', openaiImageGeneration),
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat', 'structured', 'summary'],
    capabilities: modelCapabilities('gemini', 'advanced', defaultUnsupportedImageGeneration),
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3.5-thinking',
    label: 'Gemini 3.5 Thinking',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat', 'structured', 'summary'],
    capabilities: modelCapabilities('gemini', 'advanced', defaultUnsupportedImageGeneration),
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image Preview',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: imageGenerationOnlyCapabilities('gemini', geminiImageGeneration),
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: imageGenerationOnlyCapabilities('gemini', geminiImageGeneration),
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image Preview',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: imageGenerationOnlyCapabilities('gemini', geminiImageGeneration),
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
    label: 'Opus 4.7',
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
    capabilities: modelCapabilities('mistral', 'standard', defaultUnsupportedImageGeneration),
  },
  {
    providerId: 'mistral',
    modelId: 'magistral-medium-2509',
    label: 'Magistral Medium',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat', 'structured', 'summary'],
    capabilities: modelCapabilities('mistral', 'advanced', defaultUnsupportedImageGeneration),
  },
  {
    providerId: 'mistral',
    modelId: 'mistral-medium-latest',
    label: 'Mistral Medium Latest',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: imageGenerationOnlyCapabilities('mistral', mistralImageGeneration),
  },
  {
    providerId: 'mistral',
    modelId: 'mistral-large-latest',
    label: 'Mistral Large Latest',
    reasoningTier: 'none',
    defaultTaskHints: ['doc'],
    capabilities: imageGenerationOnlyCapabilities('mistral', mistralImageGeneration),
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
