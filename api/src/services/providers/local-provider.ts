import OpenAI from 'openai';
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

// The local provider is an OpenAI-compatible endpoint hosted on the machine —
// e.g. the Laneformer 2B sidecar exposing /v1/chat/completions on 127.0.0.1:8089.
// No API key: the local sidecar is unauthenticated. The base URL is overridable
// via LOCAL_INFERENCE_BASE_URL for alternate hosts/ports; default targets the
// Laneformer sidecar.
const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:8089/v1';

const localBaseUrl = (): string => process.env.LOCAL_INFERENCE_BASE_URL || DEFAULT_LOCAL_BASE_URL;

export type LocalGenerateRequest = {
  mode: 'chat-completions';
  requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams;
  signal?: AbortSignal;
};

export type LocalStreamGenerateRequest = {
  mode: 'chat-completions';
  requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
  signal?: AbortSignal;
};

export class LocalProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    // Always "ready" in the credential sense — the local sidecar needs no key.
    // Actual reachability of the sidecar is a runtime concern, not a credential.
    this.provider = buildRuntimeProviderDescriptor({
      providerId: 'local',
      ready: true,
    });
  }

  listModels(): ModelCatalogEntry[] {
    return listRuntimeModelsByProvider('local');
  }

  validateCredential(): CredentialValidationResult {
    // Local sidecar is unauthenticated.
    return { ok: true };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'Local inference request failed';

    const code = (record && typeof record.code === 'string' && record.code) || undefined;
    const status = (record && typeof record.status === 'number' && record.status) || undefined;
    const retryable = status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: 'local',
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as LocalGenerateRequest;
    if (payload.mode !== 'chat-completions') {
      throw new Error('LocalProviderRuntime.generate: unsupported mode');
    }
    const client = this.getClient();
    return await client.chat.completions.create(payload.requestOptions, {
      signal: payload.signal,
    });
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as LocalStreamGenerateRequest;
    if (payload.mode !== 'chat-completions') {
      throw new Error('LocalProviderRuntime.streamGenerate: unsupported mode');
    }
    const client = this.getClient();
    return await client.chat.completions.create(payload.requestOptions, {
      signal: payload.signal,
    });
  }

  private getClient(): OpenAI {
    // Dummy key: the local sidecar ignores auth. baseURL points at the host.
    return new OpenAI({ apiKey: 'local-no-auth', baseURL: localBaseUrl() });
  }
}
