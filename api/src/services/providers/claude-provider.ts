import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import { RequestTooLargeError, requestTooLargeDetail, normalizeProviderError } from '@sentropic/llm-mesh';
import { GATEWAY_MAX_REQUEST_BODY_BYTES } from '@sentropic/llm-gateway';
import { env } from '../../config/env';
import { executeClaudeNative, type ClaudeNativeRequest, type ClaudeNativeCountRequest } from '../llm-runtime/anthropic-native-http';
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

export type ClaudeGenerateRequest = {
  mode: 'messages';
  requestOptions: Anthropic.MessageCreateParams;
  credential?: string;
  claudeCodeTransport?: { accessToken: string; accountId?: string | null; stableSessionId?: string | null };
  signal?: AbortSignal;
};

export type ClaudeStreamGenerateRequest = {
  mode: 'messages';
  requestOptions: Anthropic.MessageCreateParams;
  credential?: string;
  claudeCodeTransport?: { accessToken: string; accountId?: string | null; stableSessionId?: string | null };
  signal?: AbortSignal;
};

const buildClaudeCodeFetch =
  (transport: { accessToken: string; accountId?: string | null; stableSessionId?: string | null }): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(init?.headers ?? {});
    headers.delete('x-api-key');
    headers.delete('X-Api-Key');
    headers.set('authorization', `Bearer ${transport.accessToken}`);
    return fetch(input, { ...init, headers });
  };

/** SDK 0.78.0 serializes JSON with JSON.stringify; measure before any SDK operation. */
export const prepareClaudeCanonicalBody = (options: Anthropic.MessageCreateParams, stream: boolean) => {
  const body = { ...options, stream };
  const requestBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  if (requestBytes > GATEWAY_MAX_REQUEST_BODY_BYTES) {
    throw new RequestTooLargeError({ requestBytes, limitBytes: GATEWAY_MAX_REQUEST_BODY_BYTES, source: 'gateway' });
  }
  return { body, requestBytes };
};

const canonicalFailure = (error: unknown, requestBytes: number): unknown => {
  const detail = requestTooLargeDetail(error);
  return detail ? { ...normalizeProviderError('anthropic', error),
    requestSize: detail.requestSize ?? { requestBytes, limitBytes: GATEWAY_MAX_REQUEST_BODY_BYTES, source: 'upstream' },
  } : error;
};

export class ClaudeProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = buildRuntimeProviderDescriptor({
      providerId: 'anthropic',
      ready: this.validateCredential().ok,
    });
  }

  listModels(): ModelCatalogEntry[] {
    return listRuntimeModelsByProvider('anthropic');
  }

  nativeMessages(request: ClaudeNativeRequest) {
    return executeClaudeNative({ ...request, credential: request.credential || env.ANTHROPIC_API_KEY });
  }

  nativeCountTokens(request: ClaudeNativeCountRequest) {
    return executeClaudeNative({ ...request, stream: false, finalize: undefined, onResponseStarted: undefined,
      credential: request.credential || env.ANTHROPIC_API_KEY }, 'count_tokens');
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
    if (requestTooLargeDetail(error)) return normalizeProviderError('anthropic', error);
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

    const { body, requestBytes } = prepareClaudeCanonicalBody(payload.requestOptions, false);
    const client = this.getClient(payload.credential, payload.claudeCodeTransport);
    try {
      return await client.messages.create(body as Anthropic.MessageCreateParamsNonStreaming, { signal: payload.signal });
    } catch (error) { throw canonicalFailure(error, requestBytes); }
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as ClaudeStreamGenerateRequest;
    if (payload.mode !== 'messages') {
      throw new Error('ClaudeProviderRuntime.streamGenerate: unsupported mode');
    }

    const { body, requestBytes } = prepareClaudeCanonicalBody(payload.requestOptions, true);
    const client = this.getClient(payload.credential, payload.claudeCodeTransport);
    const stream = client.messages.stream(body, {
      signal: payload.signal,
    });

    return this.toAsyncIterable(stream, requestBytes);
  }

  private getClient(
    apiKeyOverride?: string,
    claudeCodeTransport?: { accessToken: string; accountId?: string | null; stableSessionId?: string | null },
  ): Anthropic {
    if (claudeCodeTransport?.accessToken) {
      return new Anthropic({
        apiKey: 'claude_code_dummy_key',
        fetch: buildClaudeCodeFetch(claudeCodeTransport),
      });
    }

    const validation = this.validateCredential(apiKeyOverride);
    if (!validation.ok) {
      throw new Error(validation.message || 'Anthropic API key is not configured');
    }

    return new Anthropic({ apiKey: apiKeyOverride || env.ANTHROPIC_API_KEY });
  }

  private async *toAsyncIterable(
    stream: MessageStream,
    requestBytes: number,
  ): AsyncGenerator<unknown> {
    try { for await (const event of stream) yield event; }
    catch (error) { throw canonicalFailure(error, requestBytes); }
    finally { stream.abort(); }
  }
}
