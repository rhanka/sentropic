import type { ModelCatalogEntry, ProviderDescriptor, ProviderId, ProviderRuntime } from './provider-runtime';
import { ClaudeProviderRuntime } from './providers/claude-provider';
import { CohereProviderRuntime } from './providers/cohere-provider';
import { GeminiProviderRuntime } from './providers/gemini-provider';
import { MistralProviderRuntime } from './providers/mistral-provider';
import { OpenAIProviderRuntime } from './providers/openai-provider';
import { GcpProviderRuntime } from './providers/gcp-provider';
import { LocalProviderRuntime } from './providers/local-provider';
import { CLOUDCODE_PA_PROVIDER_ID, CloudCodePaProviderRuntime } from './providers/cloudcode-pa-provider';

// Antigravity cutover: `cloudcode-pa` is an api-local TRANSPORT provider (a
// genuinely distinct 3rd Google endpoint). It is NOT a mesh catalog ProviderId
// and is deliberately kept OUT of listProviders/listModels (zero catalog
// models, reached only via the account-transport fallback route). It is still
// registered here as its own runtime so `requireProvider('cloudcode-pa')`
// resolves it (one-provider-one-runtime; testable in isolation).
export type RuntimeProviderId = ProviderId | typeof CLOUDCODE_PA_PROVIDER_ID;

class ProviderRegistry {
  private readonly providers: Map<ProviderId, ProviderRuntime>;
  private readonly cloudCodePa: CloudCodePaProviderRuntime;

  constructor() {
    const openai = new OpenAIProviderRuntime();
    const gemini = new GeminiProviderRuntime();
    const claude = new ClaudeProviderRuntime();
    const mistral = new MistralProviderRuntime();
    const cohere = new CohereProviderRuntime();
    const gcp = new GcpProviderRuntime();
    const local = new LocalProviderRuntime();

    this.providers = new Map<ProviderId, ProviderRuntime>([
      ['openai', openai],
      ['gemini', gemini],
      ['anthropic', claude],
      ['mistral', mistral],
      ['cohere', cohere],
      ['gcp', gcp],
      ['local', local],
    ]);
    this.cloudCodePa = new CloudCodePaProviderRuntime();
  }

  // Catalog surface: the 7 mesh providers only. `cloudcode-pa` is a transport
  // provider (no selectable catalog models) and is intentionally excluded.
  listProviders(): ProviderDescriptor[] {
    return [...this.providers.values()].map((runtime) => runtime.provider);
  }

  listModels(): ModelCatalogEntry[] {
    return [...this.providers.values()].flatMap((runtime) => runtime.listModels());
  }

  getProvider(providerId: RuntimeProviderId): ProviderRuntime | null {
    if (providerId === CLOUDCODE_PA_PROVIDER_ID) {
      return this.cloudCodePa;
    }
    return this.providers.get(providerId) || null;
  }

  requireProvider(providerId: RuntimeProviderId): ProviderRuntime {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    return provider;
  }
}

export const providerRegistry = new ProviderRegistry();
