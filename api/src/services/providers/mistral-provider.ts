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

const MISTRAL_CHAT_COMPLETIONS_URL = 'https://api.mistral.ai/v1/chat/completions';

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

class MistralHttpError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'MistralHttpError';
    if (typeof options.status === 'number') this.status = options.status;
    if (options.code) this.code = options.code;
  }
}

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

    const apiKey = this.getApiKey(payload.credential);
    return await this.postChatCompletions(
      apiKey,
      this.normalizeRequestOptions(payload.requestOptions),
      payload.signal,
    );
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as MistralStreamGenerateRequest;
    if (payload.mode !== 'chat-completions') {
      throw new Error('MistralProviderRuntime.streamGenerate: unsupported mode');
    }

    const apiKey = this.getApiKey(payload.credential);
    return await this.postChatCompletionsStream(
      apiKey,
      {
        ...this.normalizeRequestOptions(payload.requestOptions),
        stream: true,
      },
      payload.signal,
    );
  }

  private getApiKey(apiKeyOverride?: string): string {
    const validation = this.validateCredential(apiKeyOverride);
    if (!validation.ok) {
      throw new Error(validation.message || 'Mistral API key is not configured');
    }

    const apiKey = apiKeyOverride || env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error('Mistral API key is not configured');
    }

    return apiKey;
  }

  private normalizeRequestOptions(
    requestOptions: Record<string, unknown>,
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...requestOptions };

    this.moveOption(normalized, 'responseFormat', 'response_format');
    this.moveOption(normalized, 'toolChoice', 'tool_choice');
    this.moveOption(normalized, 'maxTokens', 'max_tokens');

    const messages = normalized.messages;
    if (Array.isArray(messages)) {
      normalized.messages = messages.map((message) =>
        this.normalizeMessage(message as Record<string, unknown>),
      );
    }

    return normalized;
  }

  private normalizeMessage(message: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...message };
    this.moveOption(normalized, 'toolCalls', 'tool_calls');
    this.moveOption(normalized, 'toolCallId', 'tool_call_id');
    return normalized;
  }

  private moveOption(
    options: Record<string, unknown>,
    source: string,
    target: string,
  ): void {
    if (Object.prototype.hasOwnProperty.call(options, source)) {
      if (!Object.prototype.hasOwnProperty.call(options, target)) {
        options[target] = options[source];
      }
      delete options[source];
    }
  }

  private async postChatCompletions(
    apiKey: string,
    requestOptions: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(MISTRAL_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestOptions),
      signal,
    });

    if (!response.ok) {
      throw await this.toHttpError(response);
    }

    return await response.json();
  }

  private async postChatCompletionsStream(
    apiKey: string,
    requestOptions: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<unknown>> {
    const response = await fetch(MISTRAL_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestOptions),
      signal,
    });

    if (!response.ok) {
      throw await this.toHttpError(response);
    }

    if (!response.body) {
      throw new MistralHttpError('Mistral stream response was empty', {
        status: response.status,
      });
    }

    return this.parseSseStream(response.body);
  }

  private async *parseSseStream(
    stream: ReadableStream<Uint8Array>,
  ): AsyncGenerator<unknown> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r\n/g, '\n');
        }
        if (done) {
          buffer += decoder.decode();
          buffer = buffer.replace(/\r\n/g, '\n');
        }

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          const parsed = this.parseSseEvent(rawEvent);
          if (parsed.done) return;
          if ('value' in parsed) yield parsed.value;

          boundary = buffer.indexOf('\n\n');
        }

        if (done) break;
      }

      const tail = buffer.trim();
      if (tail.length > 0) {
        const parsed = this.parseSseEvent(tail);
        if (!parsed.done && 'value' in parsed) yield parsed.value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseSseEvent(rawEvent: string): { done: boolean; value?: unknown } {
    const data = rawEvent
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();

    if (data.length === 0) return { done: false };
    if (data === '[DONE]') return { done: true };

    try {
      return { done: false, value: JSON.parse(data) as unknown };
    } catch {
      throw new MistralHttpError('Mistral stream returned invalid JSON');
    }
  }

  private async toHttpError(response: Response): Promise<MistralHttpError> {
    const fallback = `Mistral request failed with status ${response.status}`;
    const text = await response.text().catch(() => '');
    const parsed = this.parseErrorPayload(text, fallback);

    return new MistralHttpError(parsed.message, {
      status: response.status,
      ...(parsed.code ? { code: parsed.code } : {}),
    });
  }

  private parseErrorPayload(
    text: string,
    fallback: string,
  ): { message: string; code?: string } {
    if (text.trim().length === 0) return { message: fallback };

    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      const error = payload.error as Record<string, unknown> | undefined;
      const rawMessage = error?.message ?? payload.message;
      const rawCode = error?.code ?? payload.code;
      const message = typeof rawMessage === 'string' && rawMessage
        ? rawMessage
        : fallback;
      const code = typeof rawCode === 'string' && rawCode ? rawCode : undefined;

      return code ? { message, code } : { message };
    } catch {
      return { message: text.slice(0, 500) || fallback };
    }
  }
}
