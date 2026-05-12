import type { AuthInput } from './auth.js';
import {
  getProviderProfile,
  listModelProfilesByProvider,
  type ModelProfile,
  type ProviderDescriptor,
} from './catalog.js';
import type {
  GenerateRequest,
  GenerateResponse,
  StreamRequest,
  StreamResult,
} from './generation.js';
import type { ProviderId } from './providers.js';
import type { ProviderAdapter, ProviderRuntimeContext } from './registry.js';
import { validateAdapterAuthSource } from './adapter-auth.js';
import {
  normalizeProviderError,
  type NormalizedProviderError,
  type ProviderErrorNormalizationOptions,
} from './errors.js';

export interface ProviderAdapterClient {
  generate(
    request: GenerateRequest,
    context?: ProviderRuntimeContext,
  ): Promise<GenerateResponse>;
  stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult>;
}

export interface ProviderAdapterOptions<Client extends ProviderAdapterClient = ProviderAdapterClient> {
  client?: Client;
  provider?: ProviderDescriptor;
  models?: readonly ModelProfile[];
  errorOptions?: ProviderErrorNormalizationOptions;
  validateAuth?: (
    source?: AuthInput,
  ) => { ok: boolean; message?: string };
}

export class ProviderAdapterNotConfiguredError extends Error {
  readonly code = 'adapter_not_configured';

  constructor(
    readonly providerId: ProviderId,
    readonly operation: 'generate' | 'stream',
  ) {
    super(`${providerId} adapter ${operation} client is not configured`);
    this.name = 'ProviderAdapterNotConfiguredError';
  }
}

export abstract class BaseProviderAdapter<Client extends ProviderAdapterClient = ProviderAdapterClient>
  implements ProviderAdapter
{
  readonly provider: ProviderDescriptor;
  private readonly client?: Client;
  private readonly models: readonly ModelProfile[];
  private readonly options: ProviderAdapterOptions<Client>;

  protected constructor(
    providerId: ProviderId,
    options: ProviderAdapterOptions<Client> = {},
  ) {
    this.provider = options.provider ?? getProviderProfile(providerId);
    this.models = options.models ?? listModelProfilesByProvider(providerId);
    this.client = options.client;
    this.options = options;
  }

  listModels(): readonly ModelProfile[] {
    return this.models;
  }

  async generate(
    request: GenerateRequest,
    context?: ProviderRuntimeContext,
  ): Promise<GenerateResponse> {
    if (!this.client) {
      throw new ProviderAdapterNotConfiguredError(this.provider.providerId, 'generate');
    }
    return await this.client.generate(request, context);
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    if (!this.client) {
      throw new ProviderAdapterNotConfiguredError(this.provider.providerId, 'stream');
    }
    return await this.client.stream(request, context);
  }

  validateAuth(source?: AuthInput): { ok: boolean; message?: string } {
    return this.options.validateAuth?.(source) ?? validateAdapterAuthSource(source);
  }

  normalizeError(error: unknown): NormalizedProviderError {
    return normalizeProviderError(this.provider.providerId, error, {
      defaultMessage: `${this.provider.label} request failed`,
      ...this.options.errorOptions,
    });
  }
}
