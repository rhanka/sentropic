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

export interface DefaultProviderAdapterClients {
  openai?: OpenAIAdapterClient;
  gemini?: GeminiAdapterClient;
  anthropic?: AnthropicAdapterClient;
  mistral?: MistralAdapterClient;
  cohere?: CohereAdapterClient;
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
  ];
};
