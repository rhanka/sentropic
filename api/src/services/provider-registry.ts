import type { ModelCatalogEntry, ProviderDescriptor, ProviderId, ProviderRuntime } from './provider-runtime';
import { GeminiProviderRuntime } from './providers/gemini-provider';
import { OpenAIProviderRuntime } from './providers/openai-provider';

class ProviderRegistry {
  private readonly providers: Map<ProviderId, ProviderRuntime>;

  constructor() {
    const openai = new OpenAIProviderRuntime();
    const gemini = new GeminiProviderRuntime();

    this.providers = new Map<ProviderId, ProviderRuntime>([
      ['openai', openai],
      ['gemini', gemini],
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
