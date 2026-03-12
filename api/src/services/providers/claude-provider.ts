import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import type {
  CredentialValidationResult,
  ModelCatalogEntry,
  NormalizedProviderError,
  ProviderDescriptor,
  ProviderRuntime,
} from '../provider-runtime';

const CLAUDE_MODELS: ModelCatalogEntry[] = [
  {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    reasoningTier: 'standard',
    supportsTools: true,
    supportsStreaming: true,
    defaultContexts: ['chat', 'structured'],
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    reasoningTier: 'advanced',
    supportsTools: true,
    supportsStreaming: true,
    defaultContexts: ['chat', 'structured', 'summary'],
  },
];

export type ClaudeGenerateRequest = {
  mode: 'messages';
  requestOptions: Anthropic.MessageCreateParams;
  credential?: string;
  signal?: AbortSignal;
};

export type ClaudeStreamGenerateRequest = {
  mode: 'messages';
  requestOptions: Anthropic.MessageCreateParams;
  credential?: string;
  signal?: AbortSignal;
};

export class ClaudeProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = {
      providerId: 'anthropic',
      label: 'Anthropic Claude',
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
    return CLAUDE_MODELS;
  }

  validateCredential(credential?: string): CredentialValidationResult {
    const apiKey = credential || env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        ok: false,
        message: 'Anthropic API key is not configured',
      };
    }

    return { ok: true };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'Anthropic request failed';

    const code =
      (record && typeof record.code === 'string' && record.code) ||
      undefined;

    const status =
      (record && typeof record.status === 'number' && record.status) ||
      undefined;

    const retryable = status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: 'anthropic',
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as ClaudeGenerateRequest;
    if (payload.mode !== 'messages') {
      throw new Error('ClaudeProviderRuntime.generate: unsupported mode');
    }

    const client = this.getClient(payload.credential);
    return await client.messages.create(
      { ...payload.requestOptions, stream: false },
      { signal: payload.signal },
    );
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as ClaudeStreamGenerateRequest;
    if (payload.mode !== 'messages') {
      throw new Error('ClaudeProviderRuntime.streamGenerate: unsupported mode');
    }

    const client = this.getClient(payload.credential);
    const stream = client.messages.stream(payload.requestOptions, {
      signal: payload.signal,
    });

    return this.toAsyncIterable(stream);
  }

  private getClient(apiKeyOverride?: string): Anthropic {
    const validation = this.validateCredential(apiKeyOverride);
    if (!validation.ok) {
      throw new Error(validation.message || 'Anthropic API key is not configured');
    }

    return new Anthropic({ apiKey: apiKeyOverride || env.ANTHROPIC_API_KEY });
  }

  private async *toAsyncIterable(
    stream: Anthropic.MessageStream,
  ): AsyncGenerator<unknown> {
    for await (const event of stream) {
      yield event;
    }
  }
}
