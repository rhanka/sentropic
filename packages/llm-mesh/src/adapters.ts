import type { ProviderAdapter } from './registry.js';
import {
  BaseProviderAdapter,
  type ProviderAdapterClient,
  type ProviderAdapterOptions,
} from './adapter-core.js';

export * from './adapter-core.js';
export * from './adapter-auth.js';

export interface OpenAIAdapterClient extends ProviderAdapterClient {}
export interface GeminiAdapterClient extends ProviderAdapterClient {}
export interface AnthropicAdapterClient extends ProviderAdapterClient {}
export type ClaudeAdapterClient = AnthropicAdapterClient;
export interface MistralAdapterClient extends ProviderAdapterClient {}
export interface CohereAdapterClient extends ProviderAdapterClient {}
export interface GcpAdapterClient extends ProviderAdapterClient {}
export interface LocalAdapterClient extends ProviderAdapterClient {}

export class OpenAIAdapter extends BaseProviderAdapter<OpenAIAdapterClient> {
  constructor(options: ProviderAdapterOptions<OpenAIAdapterClient> = {}) {
    super('openai', options);
  }
}

export class GeminiAdapter extends BaseProviderAdapter<GeminiAdapterClient> {
  constructor(options: ProviderAdapterOptions<GeminiAdapterClient> = {}) {
    super('gemini', options);
  }
}

export class AnthropicAdapter extends BaseProviderAdapter<AnthropicAdapterClient> {
  constructor(options: ProviderAdapterOptions<AnthropicAdapterClient> = {}) {
    super('anthropic', options);
  }
}

export const ClaudeAdapter = AnthropicAdapter;

export class MistralAdapter extends BaseProviderAdapter<MistralAdapterClient> {
  constructor(options: ProviderAdapterOptions<MistralAdapterClient> = {}) {
    super('mistral', options);
  }
}

export class CohereAdapter extends BaseProviderAdapter<CohereAdapterClient> {
  constructor(options: ProviderAdapterOptions<CohereAdapterClient> = {}) {
    super('cohere', options);
  }
}

// Gemini-on-GCP (Model Garden) adapter. Mirrors the sibling token-bearing
// adapters: it declares NO `validateAuth` override, so it uses the default
// `validateAdapterAuthSource` (adapter-auth.ts). Per M2, api Lot 3 mints the
// short-lived ADC bearer PRE-DISPATCH and carries it as a `direct-token`; that
// shape passes `validateAdapterAuthSource` (adapter-auth.ts:20-23 — `direct-token`
// is `ok` when the token has text) AND forwards through the actual-token path.
// The bearer is minted in api (the package stays transport-/credential-free).
// (Provider id renamed vertex→gcp — user decision 2026-06-02, Vertex AI brand
// retired; the endpoint host stays aiplatform.googleapis.com.)
export class GcpAdapter extends BaseProviderAdapter<GcpAdapterClient> {
  constructor(options: ProviderAdapterOptions<GcpAdapterClient> = {}) {
    super('gcp', options);
  }
}

// Local provider adapter: an OpenAI-compatible endpoint hosted on the machine
// (e.g. the Laneformer 2B sidecar on 127.0.0.1:8089). It uses the default
// token-bearing auth like the sibling adapters; the actual baseURL/transport is
// supplied by the api/gateway layer (this package stays transport-free).
export class LocalAdapter extends BaseProviderAdapter<LocalAdapterClient> {
  constructor(options: ProviderAdapterOptions<LocalAdapterClient> = {}) {
    super('local', options);
  }
}

export interface DefaultProviderAdapterClients {
  openai?: OpenAIAdapterClient;
  gemini?: GeminiAdapterClient;
  anthropic?: AnthropicAdapterClient;
  mistral?: MistralAdapterClient;
  cohere?: CohereAdapterClient;
  gcp?: GcpAdapterClient;
  local?: LocalAdapterClient;
}

export const createDefaultProviderAdapters = (
  clients: DefaultProviderAdapterClients = {},
): readonly ProviderAdapter[] => {
  return [
    new OpenAIAdapter({ client: clients.openai }),
    new GeminiAdapter({ client: clients.gemini }),
    new AnthropicAdapter({ client: clients.anthropic }),
    new MistralAdapter({ client: clients.mistral }),
    new CohereAdapter({ client: clients.cohere }),
    new GcpAdapter({ client: clients.gcp }),
    new LocalAdapter({ client: clients.local }),
  ];
};
