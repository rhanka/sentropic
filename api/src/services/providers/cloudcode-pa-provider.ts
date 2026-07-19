import type {
  CredentialValidationResult,
  ModelCatalogEntry,
  NormalizedProviderError,
  ProviderDescriptor,
  ProviderId,
  ProviderRuntime,
} from '../provider-runtime';
import {
  ANTIGRAVITY_GENERATE_CONTENT_ENDPOINT,
  ANTIGRAVITY_STREAM_GENERATE_CONTENT_ENDPOINT,
  buildAntigravityHeaders,
} from '../antigravity-provider-auth';

// ---------------------------------------------------------------------------
// Antigravity cutover — the `cloudcode-pa` provider runtime.
//
// A genuinely DISTINCT 3rd Google endpoint (NOT Vertex/`gcp`, NOT AI-Studio
// `gemini`). It talks to the Cloud Code companion internal API
// (`cloudcode-pa.googleapis.com/v1internal:{generateContent,
// streamGenerateContent?alt=sse}`) with the Antigravity wire:
//   - Body wrapper: `{ model, project, request: <Gemini GenerateContentRequest> }`
//     — the `model` is an Antigravity FLEET id and `project` is discovered via
//     `loadCodeAssist` (antigravity-provider-auth.ts) at enrollment.
//   - Headers: `Authorization: Bearer <account access token>` +
//     Antigravity `User-Agent` / `X-Goog-Api-Client` / `Client-Metadata`
//     (buildAntigravityHeaders).
//   - Response envelope: `{ response: <Gemini GenerateContentResponse> }`; this
//     runtime UNWRAPS `.response` so the caller reuses the identical
//     Gemini-shaped extraction / SSE→event loop (buildGeminiRequestBody /
//     extractGeminiText).
//
// PERSONAL-PASSTHROUGH INVARIANT: the enrolled account's own bearer executes the
// request; the token is NEVER relayed as a generic gateway bearer. It is carried
// per-request as `credential` and MUST NOT be logged.
//
// This runtime is registered in provider-registry.ts as an api-local transport
// provider (`cloudcode-pa`); it is NOT a mesh catalog ProviderId and advertises
// zero catalog models (its fleet is reached via the account-transport
// allowlist + the routing fallback map, never as a selectable catalog key).
// ---------------------------------------------------------------------------

export const CLOUDCODE_PA_PROVIDER_ID = 'cloudcode-pa';

type CloudCodePaRequestOptions = {
  model: string;
  project: string;
  body: Record<string, unknown>;
};

export type CloudCodePaGenerateRequest = {
  mode: 'antigravity-generate-content';
  requestOptions: CloudCodePaRequestOptions;
  credential?: string;
  signal?: AbortSignal;
};

export type CloudCodePaStreamGenerateRequest = {
  mode: 'antigravity-stream-generate-content';
  requestOptions: CloudCodePaRequestOptions;
  credential?: string;
  signal?: AbortSignal;
};

// Unwrap the Cloud Code `{ response: <GenerateContentResponse> }` envelope back
// to the bare Gemini response shape the caller expects. Tolerates a bare
// (already-unwrapped) payload.
const unwrapCloudCodeResponse = (payload: unknown): unknown => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (record.response && typeof record.response === 'object') {
      return record.response;
    }
  }
  return payload;
};

export class CloudCodePaProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = {
      providerId: CLOUDCODE_PA_PROVIDER_ID as ProviderId,
      label: 'Antigravity (Cloud Code)',
      // A per-account transport provider — never statically "ready" (there is no
      // env key; readiness is per enrolled account). Inert: this provider is not
      // surfaced in listProviders/listModels.
      status: 'planned',
      capabilities: {
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: false,
        supportsReasoning: true,
      },
    };
  }

  // No catalog models: the Antigravity fleet is an account-transport allowlist,
  // never a selectable catalog key (avoids the "listed ≠ callable" trap).
  listModels(): ModelCatalogEntry[] {
    return [];
  }

  validateCredential(credential?: string): CredentialValidationResult {
    if (!credential || credential.trim().length === 0) {
      return {
        ok: false,
        message: 'Antigravity (Cloud Code) requires an enrolled account access token',
      };
    }
    return { ok: true };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'Antigravity request failed';

    const code =
      (record && typeof record.code === 'string' && record.code) || undefined;

    const status =
      (record && typeof record.status === 'number' && record.status) || undefined;

    const retryable =
      status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: CLOUDCODE_PA_PROVIDER_ID as ProviderId,
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as CloudCodePaGenerateRequest;
    if (payload.mode !== 'antigravity-generate-content') {
      throw new Error('CloudCodePaProviderRuntime.generate: unsupported mode');
    }
    return await this.requestJson(
      payload.requestOptions,
      payload.credential,
      payload.signal,
    );
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as CloudCodePaStreamGenerateRequest;
    if (payload.mode !== 'antigravity-stream-generate-content') {
      throw new Error('CloudCodePaProviderRuntime.streamGenerate: unsupported mode');
    }
    return await this.requestSse(
      payload.requestOptions,
      payload.credential,
      payload.signal,
    );
  }

  // Cloud Code `v1internal` request envelope: `{ model, project, request }`.
  private buildRequestBody(requestOptions: CloudCodePaRequestOptions): Record<string, unknown> {
    return {
      model: requestOptions.model,
      project: requestOptions.project,
      request: requestOptions.body,
    };
  }

  private resolveBearer(override?: string): string {
    const trimmed = override?.trim();
    if (!trimmed) {
      throw new Error('Antigravity (Cloud Code) requires an enrolled account access token');
    }
    return trimmed;
  }

  private async requestJson(
    requestOptions: CloudCodePaRequestOptions,
    credential?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const bearer = this.resolveBearer(credential);
    const response = await fetch(ANTIGRAVITY_GENERATE_CONTENT_ENDPOINT, {
      method: 'POST',
      headers: buildAntigravityHeaders({ accessToken: bearer }),
      body: JSON.stringify(this.buildRequestBody(requestOptions)),
      signal,
    });

    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    return unwrapCloudCodeResponse(await response.json());
  }

  private async requestSse(
    requestOptions: CloudCodePaRequestOptions,
    credential?: string,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<unknown>> {
    const bearer = this.resolveBearer(credential);
    const response = await fetch(ANTIGRAVITY_STREAM_GENERATE_CONTENT_ENDPOINT, {
      method: 'POST',
      headers: buildAntigravityHeaders({ accessToken: bearer }),
      body: JSON.stringify(this.buildRequestBody(requestOptions)),
      signal,
    });

    if (!response.ok) {
      throw await this.toProviderError(response);
    }
    if (!response.body) {
      return this.emptyStream();
    }

    return this.readSse(response.body);
  }

  // Cloud Code returns the `google.rpc.Status` shape:
  // `{ error: { code, status, message } }`. Surface `status` (enum string) as
  // the normalized code and the HTTP status for retryability. NEVER log the
  // bearer.
  private async toProviderError(response: Response): Promise<Error> {
    const raw = await response.text().catch(() => '');
    let message = `Antigravity request failed (${response.status})`;
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
    return;
  }

  // SSE byte-parsing semantics mirror gemini-provider.ts / gcp-provider.ts:
  // streamGenerateContent?alt=sse emits an SSE-of-JSON envelope. Each event is
  // the Cloud Code `{ response: <chunk> }` wrapper; we unwrap `.response` so the
  // caller consumes the identical Gemini chunk shape.
  private async *readSse(
    body: ReadableStream<Uint8Array>,
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
          yield unwrapCloudCodeResponse(parsed);
        }
      }
    }

    buffer += decoder.decode();
    const trailing = this.parseSseEvent(buffer);
    if (trailing !== null) {
      yield unwrapCloudCodeResponse(trailing);
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
    buffer: string,
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
