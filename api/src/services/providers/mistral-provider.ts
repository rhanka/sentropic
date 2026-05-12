import { Mistral } from '@mistralai/mistralai';
import { env } from '../../config/env';
import type {
  CredentialValidationResult,
  ModelCatalogEntry,
  NormalizedProviderError,
  ProviderDescriptor,
  ProviderRuntime,
} from '../provider-runtime';
import {
  buildRuntimeProviderDescriptor,
  listRuntimeModelsByProvider,
} from '../provider-runtime';

export type MistralGenerateRequest = {
  mode: 'chat-completions';
  requestOptions: {
    model: string;
    messages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  credential?: string;
  signal?: AbortSignal;
};

export type MistralStreamGenerateRequest = {
  mode: 'chat-completions';
  requestOptions: {
    model: string;
    messages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  credential?: string;
  signal?: AbortSignal;
};

export class MistralProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = buildRuntimeProviderDescriptor({
      providerId: 'mistral',
      ready: this.validateCredential().ok,
    });
  }

  listModels(): ModelCatalogEntry[] {
    return listRuntimeModelsByProvider('mistral');
  }

  validateCredential(credential?: string): CredentialValidationResult {
    const apiKey = credential || env.MISTRAL_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        ok: false,
        message: 'Mistral API key is not configured',
      };
    }

    return { ok: true };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'Mistral request failed';

    const code =
      (record && typeof record.code === 'string' && record.code) ||
      undefined;

    const status =
      (record && typeof record.status === 'number' && record.status) ||
      undefined;

    const retryable = status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: 'mistral',
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as MistralGenerateRequest;
    if (payload.mode !== 'chat-completions') {
      throw new Error('MistralProviderRuntime.generate: unsupported mode');
    }

    const client = this.getClient(payload.credential);
    return await client.chat.complete(payload.requestOptions);
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as MistralStreamGenerateRequest;
    if (payload.mode !== 'chat-completions') {
      throw new Error('MistralProviderRuntime.streamGenerate: unsupported mode');
    }

    const client = this.getClient(payload.credential);
    const stream = await client.chat.stream(payload.requestOptions);

    return this.toAsyncIterable(stream);
  }

  private getClient(apiKeyOverride?: string): Mistral {
    const validation = this.validateCredential(apiKeyOverride);
    if (!validation.ok) {
      throw new Error(validation.message || 'Mistral API key is not configured');
    }

    return new Mistral({ apiKey: apiKeyOverride || env.MISTRAL_API_KEY });
  }

  private async *toAsyncIterable(
    stream: AsyncIterable<unknown>,
  ): AsyncGenerator<unknown> {
    for await (const event of stream) {
      yield event;
    }
  }
}
