import OpenAI from 'openai';
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
      codexTransport?: { accessToken: string; accountId?: string | null };
      signal?: AbortSignal;
    }
  | {
      mode: 'responses';
      requestOptions: OpenAI.Responses.ResponseCreateParamsStreaming;
      credential?: string;
      codexTransport?: { accessToken: string; accountId?: string | null };
      signal?: AbortSignal;
    };

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

const stripCodexInputIds = (body: string): string => {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (Array.isArray(parsed.input)) {
      parsed.input = parsed.input.map((item) =>
        item && typeof item === 'object' && 'id' in item
          ? (({ id: _id, ...rest }) => rest)(item as Record<string, unknown>)
          : item,
      );
    }
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
};

const buildCodexFetch =
  (transport: { accessToken: string; accountId?: string | null }): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(init?.headers ?? {});
    headers.set('authorization', `Bearer ${transport.accessToken}`);
    headers.set('originator', 'opencode');
    headers.set('User-Agent', 'opencode/0.1.0');
    headers.set('session_id', `codex_${Date.now().toString(36)}`);
    if (transport.accountId) headers.set('ChatGPT-Account-Id', transport.accountId);
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return fetch(
      url.pathname.includes('/responses') || url.pathname.includes('/chat/completions')
        ? CODEX_RESPONSES_URL
        : input,
      {
        ...init,
        headers,
        body:
          typeof init?.body === 'string' &&
          (url.pathname.includes('/responses') || url.pathname.includes('/chat/completions'))
            ? stripCodexInputIds(init.body)
            : init?.body,
      },
    );
  };

export class OpenAIProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = buildRuntimeProviderDescriptor({
      providerId: 'openai',
      ready: this.validateCredential().ok,
    });
  }

  listModels(): ModelCatalogEntry[] {
    return listRuntimeModelsByProvider('openai');
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
    const client = this.getClient(payload.credential, payload.codexTransport);

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

  private getClient(
    apiKeyOverride?: string,
    codexTransport?: { accessToken: string; accountId?: string | null },
  ): OpenAI {
    if (codexTransport?.accessToken) {
      return new OpenAI({ apiKey: 'codex_dummy_key', fetch: buildCodexFetch(codexTransport) });
    }
    const validation = this.validateCredential(apiKeyOverride);
    if (!validation.ok) {
      throw new Error(validation.message || 'OpenAI API key is not configured');
    }

    return new OpenAI({ apiKey: apiKeyOverride || env.OPENAI_API_KEY });
  }
}
