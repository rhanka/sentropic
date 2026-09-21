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

// Serving wire facts [MEASURED] from static analysis of the installed muse
// CLI (wrapper ~/.local/bin/muse + ELF muse-bin-1.3.0-R3401.1, read-only):
// - base default https://api.meta.ai (ClientBuilder default);
// - provider path /muse-code/models joined to the configured base URL;
// - Authorization: Bearer <api_key>;
// - x-meta-ai-gateway-session-id header slot.
// [GAP] message schema + session-id value: body is passed through from
// requestOptions and the session header is sent only when provided —
// nothing is invented for either.
const MUSE_DEFAULT_BASE_URL = 'https://api.meta.ai';
const MUSE_SERVING_PATH = '/muse-code/models';

export type MuseGenerateRequest = {
  mode: 'msp';
  requestOptions: Record<string, unknown>;
  credential?: string;
  museAccountTransport?: { accessToken: string; accountId?: string | null };
  signal?: AbortSignal;
};

export type MuseStreamGenerateRequest = {
  mode: 'msp';
  requestOptions: Record<string, unknown>;
  credential?: string;
  museAccountTransport?: { accessToken: string; accountId?: string | null };
  signal?: AbortSignal;
};

export const resolveMuseApiKey = (credential?: string): string | null => {
  const direct = (credential ?? '').trim();
  if (direct.length > 0) return direct;
  // BR75-Q1: CI secret is MUSE_API_KEY; the repo-root .env carries
  // MODEL_API_KEY as fallback. No other generic name is read.
  const ciKey = (env.MUSE_API_KEY ?? '').trim();
  if (ciKey.length > 0) return ciKey;
  const modelKey = (env.MODEL_API_KEY ?? '').trim();
  return modelKey.length > 0 ? modelKey : null;
};

export class MuseProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = buildRuntimeProviderDescriptor({
      providerId: 'muse',
      ready: this.validateCredential().ok,
    });
  }

  listModels(): ModelCatalogEntry[] {
    // Dispatch exists now (S4 upstream transport); advertise the mesh
    // catalog muse models like the sibling providers do.
    return listRuntimeModelsByProvider('muse');
  }

  validateCredential(credential?: string): CredentialValidationResult {
    const apiKey = resolveMuseApiKey(credential);
    if (!apiKey) {
      return {
        ok: false,
        message: 'Muse API key is not configured',
      };
    }

    return { ok: true };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'Muse request failed';

    const code =
      (record && typeof record.code === 'string' && record.code) ||
      undefined;

    const status =
      (record && typeof record.status === 'number' && record.status) ||
      undefined;

    const retryable = status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: 'muse',
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as MuseGenerateRequest;
    if (payload.mode !== 'msp') {
      throw new Error('MuseProviderRuntime.generate: unsupported mode');
    }
    return await this.requestJson(payload);
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as MuseStreamGenerateRequest;
    if (payload.mode !== 'msp') {
      throw new Error('MuseProviderRuntime.streamGenerate: unsupported mode');
    }
    return await this.requestSse(payload);
  }

  private resolveApiKey(payload: MuseGenerateRequest): string {
    // Account-transport token first (enrolled seat), then explicit
    // credential, then MUSE_API_KEY / MODEL_API_KEY env fallback.
    const transportToken = (payload.museAccountTransport?.accessToken ?? '').trim();
    if (transportToken.length > 0) return transportToken;
    const apiKey = resolveMuseApiKey(payload.credential);
    if (!apiKey) {
      throw new Error('Muse API key is not configured');
    }
    return apiKey;
  }

  private buildApiUrl(requestOptions: Record<string, unknown>): string {
    const base = [requestOptions.baseUrl].find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ) ?? MUSE_DEFAULT_BASE_URL;
    return `${base.replace(/\/+$/, '')}${MUSE_SERVING_PATH}`;
  }

  private buildHeaders(apiKey: string, requestOptions: Record<string, unknown>): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    };
    const sessionId = requestOptions.sessionId;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      headers['x-meta-ai-gateway-session-id'] = sessionId;
    }
    return headers;
  }

  private async requestJson(payload: MuseGenerateRequest): Promise<unknown> {
    const apiKey = this.resolveApiKey(payload);
    const response = await fetch(this.buildApiUrl(payload.requestOptions), {
      method: 'POST',
      headers: this.buildHeaders(apiKey, payload.requestOptions),
      body: JSON.stringify(payload.requestOptions.body ?? {}),
      signal: payload.signal,
    });
    if (!response.ok) {
      throw await this.toProviderError(response);
    }
    return await response.json();
  }

  private async requestSse(payload: MuseStreamGenerateRequest): Promise<AsyncIterable<unknown>> {
    const apiKey = this.resolveApiKey(payload);
    const response = await fetch(this.buildApiUrl(payload.requestOptions), {
      method: 'POST',
      headers: this.buildHeaders(apiKey, payload.requestOptions),
      body: JSON.stringify(payload.requestOptions.body ?? {}),
      signal: payload.signal,
    });
    if (!response.ok) {
      throw await this.toProviderError(response);
    }
    if (!response.body) {
      return this.emptyStream();
    }
    return this.readSse(response.body);
  }

  private async toProviderError(response: Response): Promise<Error> {
    // The key never enters the message: status + truncated body only.
    const raw = await response.text().catch(() => '');
    let message = `Muse request failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const err = parsed.error;
      if (typeof err === 'string' && err) {
        message = `${message}: ${err.slice(0, 200)}`;
      } else if (err && typeof err === 'object') {
        const detail = (err as Record<string, unknown>).message;
        if (typeof detail === 'string' && detail) {
          message = `${message}: ${detail.slice(0, 200)}`;
        } else if (raw.trim()) {
          message = `${message}: ${raw.trim().slice(0, 200)}`;
        }
      } else if (raw.trim()) {
        message = `${message}: ${raw.trim().slice(0, 200)}`;
      }
    } catch {
      if (raw.trim()) {
        message = `${message}: ${raw.trim().slice(0, 200)}`;
      }
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    return error;
  }

  private async *emptyStream(): AsyncGenerator<unknown> {
    return;
  }

  private async *readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = rawEvent
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.startsWith('data:'));
        if (dataLine) {
          const data = dataLine.slice('data:'.length).trim();
          if (data && data !== '[DONE]') {
            try {
              yield JSON.parse(data);
            } catch {
              yield data;
            }
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      yield tail;
    }
  }
}
