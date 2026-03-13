import { CohereClient } from 'cohere-ai';
import { env } from '../../config/env';
import type {
  CredentialValidationResult,
  ModelCatalogEntry,
  NormalizedProviderError,
  ProviderDescriptor,
  ProviderRuntime,
} from '../provider-runtime';

const COHERE_MODELS: ModelCatalogEntry[] = [
  {
    providerId: 'cohere',
    modelId: 'command-a-03-2025',
    label: 'Command A',
    reasoningTier: 'standard',
    supportsTools: true,
    supportsStreaming: true,
    defaultContexts: ['chat'],
  },
  {
    providerId: 'cohere',
    modelId: 'command-a-reasoning-08-2025',
    label: 'Command A R.',
    reasoningTier: 'advanced',
    supportsTools: true,
    supportsStreaming: true,
    defaultContexts: ['chat', 'structured', 'summary'],
  },
  // embed-v4.0 and rerank-v3.5 catalogued only — deferred to BR-17 (RAG), not exposed in runtime
];

export type CohereGenerateRequest = {
  mode: 'chat';
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

export type CohereStreamGenerateRequest = {
  mode: 'chat';
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

export class CohereProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = {
      providerId: 'cohere',
      label: 'Cohere',
      status: this.validateCredential().ok ? 'ready' : 'planned',
      capabilities: {
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: true,
        supportsReasoning: false,
      },
    };
  }

  listModels(): ModelCatalogEntry[] {
    return COHERE_MODELS;
  }

  validateCredential(credential?: string): CredentialValidationResult {
    const apiKey = credential || env.COHERE_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        ok: false,
        message: 'Cohere API key is not configured',
      };
    }

    return { ok: true };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'Cohere request failed';

    const code =
      (record && typeof record.code === 'string' && record.code) ||
      undefined;

    const status =
      (record && typeof record.statusCode === 'number' && record.statusCode) ||
      (record && typeof record.status === 'number' && record.status) ||
      undefined;

    const retryable = status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: 'cohere',
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as CohereGenerateRequest;
    if (payload.mode !== 'chat') {
      throw new Error('CohereProviderRuntime.generate: unsupported mode');
    }

    const client = this.getClient(payload.credential);
    return await client.v2.chat(payload.requestOptions as Parameters<typeof client.v2.chat>[0]);
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as CohereStreamGenerateRequest;
    if (payload.mode !== 'chat') {
      throw new Error('CohereProviderRuntime.streamGenerate: unsupported mode');
    }

    const client = this.getClient(payload.credential);
    const stream = await client.v2.chatStream(payload.requestOptions as Parameters<typeof client.v2.chatStream>[0]);

    return this.toAsyncIterable(stream);
  }

  private getClient(apiKeyOverride?: string): CohereClient {
    const validation = this.validateCredential(apiKeyOverride);
    if (!validation.ok) {
      throw new Error(validation.message || 'Cohere API key is not configured');
    }

    return new CohereClient({ token: apiKeyOverride || env.COHERE_API_KEY });
  }

  private async *toAsyncIterable(
    stream: AsyncIterable<unknown>,
  ): AsyncGenerator<unknown> {
    for await (const event of stream) {
      yield event;
    }
  }
}
