export const providerIds = ['openai', 'gemini', 'anthropic', 'mistral', 'cohere', 'gcp', 'local'] as const;

export type ProviderId = (typeof providerIds)[number];

export type ProviderStatus = 'ready' | 'planned';

export type ProviderFamily = 'openai' | 'google' | 'anthropic' | 'mistral' | 'cohere';

export type ReasoningTier = 'none' | 'light' | 'standard' | 'advanced';

export type ModelTaskHint = 'chat' | 'structured' | 'summary' | 'doc';

export const knownModelIds = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4-nano',
  'gpt-4.1-nano',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-fable-5',
  'mistral-small-2603',
  'magistral-medium-2509',
  'command-a-03-2025',
  'command-a-reasoning-08-2025',
  // GCP (Model Garden) catalog keys use the `{publisher}/{model}@gcp` scheme so
  // they are globally unique vs the bare AI-Studio `gemini` ids (HARD invariant —
  // the api `inferProviderFromModelId` helper returns null on a >1 catalog match,
  // which would silently mis-route a colliding id to the default provider).
  // (Provider id renamed vertex→gcp — user decision 2026-06-02, Vertex AI brand
  // retired; the endpoint host stays aiplatform.googleapis.com.)
  // ROUTING CONTRACT FOR api Lot 3: the catalog key is the selection key only.
  // The api dispatch strips it back to publisher=`google` + wire model
  // (`gemini-3.5-flash`) when building the GCP
  // `publishers/{publisher}/models/{model}` URL path; the `@gcp` qualifier is
  // what routes the id to provider `gcp`.
  'google/gemini-3.5-flash@gcp',
  'google/gemini-3.1-flash-lite@gcp',
  'anthropic/claude-sonnet-4-6@gcp',
  'anthropic/claude-opus-4-6@gcp',
  // Local provider: an OpenAI-compatible endpoint on the host (e.g. the
  // Laneformer 2B sidecar on 127.0.0.1:8089). The wire format is OpenAI; the
  // baseURL/transport is configured in the api/gateway layer (the package stays
  // transport-free). Multiple local models can be exposed under this provider.
  'laneformer-2b-it',
] as const;

export type KnownModelId = (typeof knownModelIds)[number];

export type ModelId = KnownModelId | (string & {});

export type QualifiedModelId = `${ProviderId}:${string}`;

export const knownModelIdsByProvider = {
  openai: [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4-nano',
    'gpt-4.1-nano',
  ],
  gemini: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
  anthropic: ['claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-fable-5'],
  mistral: ['mistral-small-2603', 'magistral-medium-2509'],
  cohere: ['command-a-03-2025', 'command-a-reasoning-08-2025'],
  gcp: ['google/gemini-3.5-flash@gcp', 'google/gemini-3.1-flash-lite@gcp', 'anthropic/claude-sonnet-4-6@gcp', 'anthropic/claude-opus-4-6@gcp'],
  local: ['laneformer-2b-it'],
} as const satisfies Record<ProviderId, readonly KnownModelId[]>;

export interface ModelReference {
  providerId: ProviderId;
  modelId: ModelId;
}

export const toQualifiedModelId = (model: ModelReference): QualifiedModelId => {
  return `${model.providerId}:${model.modelId}`;
};

// Antigravity unified gateway fleet. One Google account transport
// (transportProviderId `antigravity`) serves ALL of these models. Modelled as
// the account transport's model-allowlist rather than distinct mesh catalog
// ProviderIds: these are Antigravity-internal wire ids (not sentropic catalog
// selection keys), and minting new ProviderIds would ripple through every
// `satisfies Record<ProviderId, …>` map and the api adapter registration while
// risking the "listed ≠ callable" mis-routing trap. Kept as a plain constant so
// the transport can key its `modelIds` allowlist off it.
export const antigravityModelFleet = [
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gemini-3-pro-high',
  'gemini-3-pro-low',
  'gpt-oss-120b-medium',
] as const;

export type AntigravityFleetModelId = (typeof antigravityModelFleet)[number];

export const isProviderId = (value: string): value is ProviderId => {
  return providerIds.includes(value as ProviderId);
};

export const isKnownModelId = (value: string): value is KnownModelId => {
  return knownModelIds.includes(value as KnownModelId);
};
