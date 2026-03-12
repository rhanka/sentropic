import type { ModelCatalogEntry, ProviderDescriptor, ProviderId, ProviderRuntime } from './provider-runtime';
import { ClaudeProviderRuntime } from './providers/claude-provider';
import { CohereProviderRuntime } from './providers/cohere-provider';
import { GeminiProviderRuntime } from './providers/gemini-provider';
import { MistralProviderRuntime } from './providers/mistral-provider';
import { OpenAIProviderRuntime } from './providers/openai-provider';

class ProviderRegistry {
  private readonly providers: Map<ProviderId, ProviderRuntime>;

  constructor() {
    const openai = new OpenAIProviderRuntime();
    const gemini = new GeminiProviderRuntime();
    const claude = new ClaudeProviderRuntime();
    const mistral = new MistralProviderRuntime();
    const cohere = new CohereProviderRuntime();

    this.providers = new Map<ProviderId, ProviderRuntime>([
      ['openai', openai],
      ['gemini', gemini],
      ['anthropic', claude],
      ['mistral', mistral],
      ['cohere', cohere],
    ]);
  }

  listProviders(): ProviderDescriptor[] {
    return [...this.providers.values()].map((runtime) => runtime.provider);
  }

  listModels(): ModelCatalogEntry[] {
    return [...this.providers.values()].flatMap((runtime) => runtime.listModels());
  }

  getProvider(providerId: ProviderId): ProviderRuntime | null {
    return this.providers.get(providerId) || null;
  }

  requireProvider(providerId: ProviderId): ProviderRuntime {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    return provider;
  }
}

export const providerRegistry = new ProviderRegistry();
