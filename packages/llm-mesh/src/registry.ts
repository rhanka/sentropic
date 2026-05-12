import type { AuthInput } from './auth.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from './generation.js';
import type { ModelProfile, ProviderDescriptor } from './catalog.js';
import type { ProviderId } from './providers.js';
import type { NormalizedProviderError } from './errors.js';

export interface CredentialValidationResult {
  ok: boolean;
  message?: string;
}

export interface ProviderRuntimeContext {
  auth?: AuthInput;
  metadata?: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly provider: ProviderDescriptor;
  listModels(): readonly ModelProfile[];
  generate(request: GenerateRequest, context?: ProviderRuntimeContext): Promise<GenerateResponse>;
  stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult>;
  validateAuth(source?: AuthInput): CredentialValidationResult;
  normalizeError(error: unknown): NormalizedProviderError;
}

export interface ProviderRegistry {
  listProviders(): readonly ProviderDescriptor[];
  listModels(): readonly ModelProfile[];
  getProvider(providerId: ProviderId): ProviderAdapter | null;
  requireProvider(providerId: ProviderId): ProviderAdapter;
}

export class StaticProviderRegistry implements ProviderRegistry {
  private readonly providers: ReadonlyMap<ProviderId, ProviderAdapter>;

  constructor(adapters: readonly ProviderAdapter[]) {
    this.providers = new Map(adapters.map((adapter) => [adapter.provider.providerId, adapter]));
  }

  listProviders(): readonly ProviderDescriptor[] {
    return [...this.providers.values()].map((adapter) => adapter.provider);
  }

  listModels(): readonly ModelProfile[] {
    return [...this.providers.values()].flatMap((adapter) => [...adapter.listModels()]);
  }

  getProvider(providerId: ProviderId): ProviderAdapter | null {
    return this.providers.get(providerId) ?? null;
  }

  requireProvider(providerId: ProviderId): ProviderAdapter {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    return provider;
  }
}

export const createProviderRegistry = (
  adapters: readonly ProviderAdapter[],
): ProviderRegistry => {
  return new StaticProviderRegistry(adapters);
};
