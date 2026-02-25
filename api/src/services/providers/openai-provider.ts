import OpenAI from 'openai';
import { env } from '../../config/env';
import type {
  CredentialValidationResult,
  ModelCatalogEntry,
  NormalizedProviderError,
  ProviderDescriptor,
  ProviderRuntime,
} from '../provider-runtime';

export type OpenAIGenerateRequest = {
  mode: 'chat-completions';
  requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams;
  credential?: string;
  signal?: AbortSignal;
};

export type OpenAIStreamGenerateRequest =
  | {
      mode: 'chat-completions';
      requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
      credential?: string;
      signal?: AbortSignal;
    }
  | {
      mode: 'responses';
      requestOptions: OpenAI.Responses.ResponseCreateParamsStreaming;
      credential?: string;
      signal?: AbortSignal;
    };

const OPENAI_MODELS: ModelCatalogEntry[] = [
  {
    providerId: 'openai',
    modelId: 'gpt-5.2',
    label: 'GPT-5.2',
    reasoningTier: 'advanced',
    supportsTools: true,
    supportsStreaming: true,
    defaultContexts: ['chat', 'structured', 'summary'],
  },
  {
    providerId: 'openai',
    modelId: 'gpt-4.1-nano',
    label: 'GPT-4.1 Nano',
    reasoningTier: 'light',
    supportsTools: true,
    supportsStreaming: true,
    defaultContexts: ['doc'],
  },
];

export class OpenAIProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = {
      providerId: 'openai',
      label: 'OpenAI',
      status: this.validateCredential().ok ? 'ready' : 'planned',
      capabilities: {
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: true,
        supportsReasoning: true,
      },
    };
  }

  listModels(): ModelCatalogEntry[] {
    return OPENAI_MODELS;
  }

  validateCredential(credential?: string): CredentialValidationResult {
    const apiKey = credential || env.OPENAI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        ok: false,
        message: 'OpenAI API key is not configured',
      };
    }

    return { ok: true };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'OpenAI request failed';

    const code =
      (record && typeof record.code === 'string' && record.code) ||
      undefined;

    const status =
      (record && typeof record.status === 'number' && record.status) ||
      undefined;

    const retryable = status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: 'openai',
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as OpenAIGenerateRequest;
    if (payload.mode !== 'chat-completions') {
      throw new Error('OpenAIProviderRuntime.generate: unsupported mode');
    }

    const client = this.getClient(payload.credential);
    return await client.chat.completions.create(payload.requestOptions, {
      signal: payload.signal,
    });
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as OpenAIStreamGenerateRequest;
    const client = this.getClient(payload.credential);

    if (payload.mode === 'chat-completions') {
      return await client.chat.completions.create(payload.requestOptions, {
        signal: payload.signal,
      });
    }

    if (payload.mode === 'responses') {
      return await client.responses.create(payload.requestOptions, {
        signal: payload.signal,
      });
    }

    throw new Error('OpenAIProviderRuntime.streamGenerate: unsupported mode');
  }

  private getClient(apiKeyOverride?: string): OpenAI {
    const validation = this.validateCredential(apiKeyOverride);
    if (!validation.ok) {
      throw new Error(validation.message || 'OpenAI API key is not configured');
    }

    return new OpenAI({ apiKey: apiKeyOverride || env.OPENAI_API_KEY });
  }
}
