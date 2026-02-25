import { env } from '../../config/env';
import type {
  CredentialValidationResult,
  ModelCatalogEntry,
  NormalizedProviderError,
  ProviderDescriptor,
  ProviderRuntime,
} from '../provider-runtime';

const GEMINI_MODELS: ModelCatalogEntry[] = [
  {
    providerId: 'gemini',
    modelId: 'gemini-3.1-pro-preview-customtools',
    label: 'Gemini 3.1 Pro',
    reasoningTier: 'advanced',
    supportsTools: true,
    supportsStreaming: true,
    defaultContexts: ['chat', 'structured', 'summary'],
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    reasoningTier: 'standard',
    supportsTools: true,
    supportsStreaming: true,
    defaultContexts: ['chat'],
  },
];

type GeminiRequestOptions = {
  model: string;
  body: Record<string, unknown>;
};

export type GeminiGenerateRequest = {
  mode: 'generate-content';
  requestOptions: GeminiRequestOptions;
  credential?: string;
  signal?: AbortSignal;
};

export type GeminiStreamGenerateRequest = {
  mode: 'stream-generate-content';
  requestOptions: GeminiRequestOptions;
  credential?: string;
  signal?: AbortSignal;
};

export class GeminiProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = {
      providerId: 'gemini',
      label: 'Google Gemini',
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
    return GEMINI_MODELS;
  }

  validateCredential(credential?: string): CredentialValidationResult {
    const apiKey = credential || env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        ok: false,
        message: 'Gemini API key is not configured',
      };
    }

    return { ok: true };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'Gemini request failed';

    const code =
      (record && typeof record.code === 'string' && record.code) ||
      undefined;

    const status =
      (record && typeof record.status === 'number' && record.status) ||
      undefined;

    const retryable = status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: 'gemini',
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as GeminiGenerateRequest;
    if (payload.mode !== 'generate-content') {
      throw new Error('GeminiProviderRuntime.generate: unsupported mode');
    }

    return await this.requestJson(
      payload.requestOptions,
      payload.credential,
      payload.signal
    );
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as GeminiStreamGenerateRequest;
    if (payload.mode !== 'stream-generate-content') {
      throw new Error('GeminiProviderRuntime.streamGenerate: unsupported mode');
    }

    return await this.requestSse(
      payload.requestOptions,
      payload.credential,
      payload.signal
    );
  }

  private buildApiUrl(input: {
    model: string;
    apiKey: string;
    stream: boolean;
  }): string {
    const action = input.stream ? 'streamGenerateContent' : 'generateContent';
    const encodedModel = encodeURIComponent(input.model);
    const alt = input.stream ? '&alt=sse' : '';
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:${action}?key=${encodeURIComponent(input.apiKey)}${alt}`;
  }

  private resolveApiKey(override?: string): string {
    const validation = this.validateCredential(override);
    if (!validation.ok) {
      throw new Error(validation.message || 'Gemini API key is not configured');
    }
    return (override || env.GEMINI_API_KEY || '').trim();
  }

  private async requestJson(
    requestOptions: GeminiRequestOptions,
    credential?: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    const apiKey = this.resolveApiKey(credential);
    const response = await fetch(
      this.buildApiUrl({
        model: requestOptions.model,
        apiKey,
        stream: false,
      }),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestOptions.body),
        signal,
      }
    );

    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    return await response.json();
  }

  private async requestSse(
    requestOptions: GeminiRequestOptions,
    credential?: string,
    signal?: AbortSignal
  ): Promise<AsyncIterable<unknown>> {
    const apiKey = this.resolveApiKey(credential);
    const response = await fetch(
      this.buildApiUrl({
        model: requestOptions.model,
        apiKey,
        stream: true,
      }),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestOptions.body),
        signal,
      }
    );

    if (!response.ok) {
      throw await this.toProviderError(response);
    }
    if (!response.body) {
      return this.emptyStream();
    }

    return this.readSse(response.body);
  }

  private async toProviderError(response: Response): Promise<Error> {
    const raw = await response.text().catch(() => '');
    let message = `Gemini request failed (${response.status})`;
    let code: string | undefined;

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const err = parsed.error as Record<string, unknown> | undefined;
      if (err && typeof err.message === 'string' && err.message) {
        message = err.message;
      }
      if (err && typeof err.status === 'string' && err.status) {
        code = err.status;
      }
    } catch {
      if (raw.trim()) {
        message = raw.trim().slice(0, 500);
      }
    }

    const error = new Error(message) as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    if (code) {
      error.code = code;
    }
    return error;
  }

  private async *emptyStream(): AsyncGenerator<unknown> {
    yield* [];
  }

  private async *readSse(
    body: ReadableStream<Uint8Array>
  ): AsyncGenerator<unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      while (true) {
        const boundary = this.findSseBoundary(buffer);
        if (!boundary) break;
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = this.parseSseEvent(rawEvent);
        if (parsed !== null) {
          yield parsed;
        }
      }
    }

    buffer += decoder.decode();
    const trailing = this.parseSseEvent(buffer);
    if (trailing !== null) {
      yield trailing;
    }
  }

  private parseSseEvent(rawEvent: string): unknown | null {
    const normalized = rawEvent.replace(/\r\n/g, '\n').trim();
    if (!normalized) return null;

    const lines = normalized
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (lines.length === 0) return null;
    const payload = lines.join('\n').trim();
    if (!payload || payload === '[DONE]') return null;

    return JSON.parse(payload) as unknown;
  }

  private findSseBoundary(
    buffer: string
  ): { index: number; length: number } | null {
    let boundaryIndex = -1;
    let boundaryLength = 0;

    const separators = ['\r\n\r\n', '\n\n', '\r\r'] as const;
    for (const separator of separators) {
      const index = buffer.indexOf(separator);
      if (index >= 0 && (boundaryIndex < 0 || index < boundaryIndex)) {
        boundaryIndex = index;
        boundaryLength = separator.length;
      }
    }

    if (boundaryIndex < 0) {
      return null;
    }

    return { index: boundaryIndex, length: boundaryLength };
  }
}
