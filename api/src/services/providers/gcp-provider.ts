import { GoogleAuth } from 'google-auth-library';

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

// ---------------------------------------------------------------------------
// BR-42f — GCP (Google Cloud Model Garden, formerly Vertex AI) provider runtime.
//
// (Provider id renamed vertex→gcp — user decision 2026-06-02, Vertex AI brand
// retired; the endpoint host stays aiplatform.googleapis.com.)
//
// GCP serves the SAME Gemini request/response payload shape as AI Studio;
// only the transport envelope differs:
//   - URL: {location}-aiplatform.googleapis.com/v1/projects/{project}/
//          locations/{location}/publishers/{publisher}/models/{model}:{action}
//   - Auth: `Authorization: Bearer <ADC bearer>` (NO `?key=` query param).
//
// The Gemini request-body builder and the SSE→event loop in
// `llm-runtime/index.ts` are REUSED verbatim (BR42f-D4). This runtime owns only
// the URL construction, the bearer header, ADC minting/caching, the sync
// `validateCredential`, and the GCP `google.rpc.Status` error mapping.
//
// The catalog id is the globally-unique `{publisher}/{model}@gcp` selection
// key (§C). The runtime strips the `@gcp` qualifier back to `{publisher}` +
// wire `{model}` for the URL path.
// ---------------------------------------------------------------------------

export const GCP_AUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// Refresh skew aligned with OAUTH_DPOP_IAT_SKEW_SEC default (D-ADC1): never
// serve a token within SKEW seconds of its expiry.
const TOKEN_REFRESH_SKEW_MS = 60_000;

type GcpRequestOptions = {
  project: string;
  location: string;
  publisher: string;
  model: string;
  body: Record<string, unknown>;
};

export type GcpGenerateRequest = {
  mode: 'gcp-generate-content';
  requestOptions: GcpRequestOptions;
  credential?: string;
  signal?: AbortSignal;
};

export type GcpStreamGenerateRequest = {
  mode: 'gcp-stream-generate-content';
  requestOptions: GcpRequestOptions;
  credential?: string;
  signal?: AbortSignal;
};

type CachedToken = {
  token: string;
  // epoch ms expiry as reported by the ADC token response (skew applied lazily)
  expiresAtMs: number;
};

// Parse a globally-unique catalog selection key `{publisher}/{model}@gcp`
// into the URL path segments `{publisher}` + wire `{model}`. The `@gcp`
// qualifier exists only to keep the catalog id unique vs AI-Studio Gemini ids
// (§C) and is stripped here.
export const parseGcpModelId = (
  modelId: string,
): { publisher: string; model: string } => {
  const withoutQualifier = modelId.endsWith('@gcp')
    ? modelId.slice(0, -'@gcp'.length)
    : modelId;
  const slash = withoutQualifier.indexOf('/');
  if (slash <= 0 || slash >= withoutQualifier.length - 1) {
    throw new Error(
      `Invalid GCP model id "${modelId}" — expected "{publisher}/{model}@gcp"`,
    );
  }
  return {
    publisher: withoutQualifier.slice(0, slash),
    model: withoutQualifier.slice(slash + 1),
  };
};

// ---------------------------------------------------------------------------
// ADC token cache (D-ADC1): keyed by {project}+{location}+{scope}, refreshed at
// `now >= expiry - SKEW`, single-flight per key (a per-key in-flight promise).
// Mint failures are NOT cached (negative results not cached). The bearer is
// NEVER logged — only `{project, location}` may appear in logs.
// ---------------------------------------------------------------------------
const tokenCache = new Map<string, CachedToken>();
const inFlightMints = new Map<string, Promise<string>>();

const cacheKey = (project: string, location: string): string =>
  `${project}+${location}+${GCP_AUTH_SCOPE}`;

// Injectable ADC accessor for tests (a stub mint). Production uses
// google-auth-library's GoogleAuth which honors GOOGLE_APPLICATION_CREDENTIALS
// (SA-JSON) and the GCE/GKE metadata server (workload identity) uniformly.
export type AdcAccessTokenResult = { token: string; expiresAtMs: number };
export type AdcTokenMinter = (scope: string) => Promise<AdcAccessTokenResult>;

let adcMinter: AdcTokenMinter = async (scope) => {
  const auth = new GoogleAuth({ scopes: [scope] });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  if (!accessToken.token) {
    throw new Error('GCP ADC token mint returned no token');
  }
  // google-auth-library caches and refreshes internally; expiry is best-effort
  // exposed on the client credentials. Default to a short TTL when absent so we
  // re-mint conservatively rather than serve a stale token.
  const expiryDate =
    (client.credentials && typeof client.credentials.expiry_date === 'number'
      ? client.credentials.expiry_date
      : undefined) ?? Date.now() + 5 * 60_000;
  return { token: accessToken.token, expiresAtMs: expiryDate };
};

// Test seam: override the ADC minter (e.g. a stub with a fake clock). Returns a
// restore function.
export const __setGcpAdcMinter = (minter: AdcTokenMinter): (() => void) => {
  const previous = adcMinter;
  adcMinter = minter;
  return () => {
    adcMinter = previous;
  };
};

export const __resetGcpTokenCache = (): void => {
  tokenCache.clear();
  inFlightMints.clear();
};

// Mint (or reuse a cached) short-lived ADC bearer for {project, location}.
// Single-flight: concurrent callers for the same key share ONE in-flight mint.
// The returned bearer MUST NOT be logged by any caller.
export const mintGcpAccessToken = async (input: {
  project: string;
  location: string;
  now?: number;
}): Promise<string> => {
  const now = input.now ?? Date.now();
  const key = cacheKey(input.project, input.location);

  const cached = tokenCache.get(key);
  if (cached && now < cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS) {
    return cached.token;
  }

  const existing = inFlightMints.get(key);
  if (existing) return existing;

  const mint = (async () => {
    try {
      const result = await adcMinter(GCP_AUTH_SCOPE);
      tokenCache.set(key, { token: result.token, expiresAtMs: result.expiresAtMs });
      return result.token;
    } finally {
      // Negative results are not cached: clearing the in-flight slot on both
      // success and failure means a failed mint is retried on the next call.
      inFlightMints.delete(key);
    }
  })();

  inFlightMints.set(key, mint);
  return mint;
};

export class GcpProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = buildRuntimeProviderDescriptor({
      providerId: 'gcp',
      ready: this.validateCredential().ok,
    });
  }

  listModels(): ModelCatalogEntry[] {
    return listRuntimeModelsByProvider('gcp');
  }

  // D-ADC2: SYNC validation derived statically from config presence. GCP is
  // AVAILABLE only when both GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are
  // set; the first live ADC mint happens lazily on the first
  // generate/streamGenerate.
  validateCredential(_credential?: string): CredentialValidationResult {
    const project = env.GOOGLE_CLOUD_PROJECT?.trim();
    const location = env.GOOGLE_CLOUD_LOCATION?.trim();
    if (!project || !location) {
      return {
        ok: false,
        message:
          'GCP is not configured (set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION)',
      };
    }
    return { ok: true };
  }

  // D-ERR1: map the GCP `google.rpc.Status` shape by HTTP status. Only 429
  // and 5xx are retryable (mirrors gemini-provider.ts). The `google.rpc.Status`
  // enum string (RESOURCE_EXHAUSTED / PERMISSION_DENIED / NOT_FOUND /
  // UNAUTHENTICATED …) is surfaced as the normalized `code`.
  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'GCP request failed';

    const code =
      (record && typeof record.code === 'string' && record.code) || undefined;

    const status =
      (record && typeof record.status === 'number' && record.status) || undefined;

    const retryable =
      status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: 'gcp',
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as GcpGenerateRequest;
    if (payload.mode !== 'gcp-generate-content') {
      throw new Error('GcpProviderRuntime.generate: unsupported mode');
    }
    return await this.requestJson(
      payload.requestOptions,
      payload.credential,
      payload.signal,
    );
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as GcpStreamGenerateRequest;
    if (payload.mode !== 'gcp-stream-generate-content') {
      throw new Error('GcpProviderRuntime.streamGenerate: unsupported mode');
    }
    return await this.requestSse(
      payload.requestOptions,
      payload.credential,
      payload.signal,
    );
  }

  private buildApiUrl(input: {
    project: string;
    location: string;
    publisher: string;
    model: string;
    stream: boolean;
  }): string {
    const action = input.stream
      ? 'streamGenerateContent'
      : 'generateContent';
    const alt = input.stream ? '?alt=sse' : '';
    return (
      `https://${input.location}-aiplatform.googleapis.com/v1` +
      `/projects/${input.project}/locations/${input.location}` +
      `/publishers/${input.publisher}/models/${encodeURIComponent(input.model)}` +
      `:${action}${alt}`
    );
  }

  // Resolve the bearer: prefer the credential forwarded from the mesh dispatch
  // (the pre-minted ADC bearer carried as a `direct-token` — §B/M2). If absent
  // (e.g. a runtime invoked directly), mint lazily here. The bearer is NEVER
  // logged.
  private async resolveBearer(
    requestOptions: GcpRequestOptions,
    override?: string,
  ): Promise<string> {
    const trimmed = override?.trim();
    if (trimmed) return trimmed;
    return await mintGcpAccessToken({
      project: requestOptions.project,
      location: requestOptions.location,
    });
  }

  private async requestJson(
    requestOptions: GcpRequestOptions,
    credential?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const bearer = await this.resolveBearer(requestOptions, credential);
    const response = await fetch(
      this.buildApiUrl({
        project: requestOptions.project,
        location: requestOptions.location,
        publisher: requestOptions.publisher,
        model: requestOptions.model,
        stream: false,
      }),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(requestOptions.body),
        signal,
      },
    );

    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    return await response.json();
  }

  private async requestSse(
    requestOptions: GcpRequestOptions,
    credential?: string,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<unknown>> {
    const bearer = await this.resolveBearer(requestOptions, credential);
    const response = await fetch(
      this.buildApiUrl({
        project: requestOptions.project,
        location: requestOptions.location,
        publisher: requestOptions.publisher,
        model: requestOptions.model,
        stream: true,
      }),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(requestOptions.body),
        signal,
      },
    );

    if (!response.ok) {
      throw await this.toProviderError(response);
    }
    if (!response.body) {
      return this.emptyStream();
    }

    return this.readSse(response.body);
  }

  // GCP returns the `google.rpc.Status` shape:
  // `{ error: { code, status, message, details[] } }`. Surface `status` (enum
  // string) as the normalized code and the HTTP status for retryability.
  private async toProviderError(response: Response): Promise<Error> {
    const raw = await response.text().catch(() => '');
    let message = `GCP request failed (${response.status})`;
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

  // SSE byte-parsing semantics reused from gemini-provider.ts: GCP
  // streamGenerateContent?alt=sse emits the identical SSE-of-Gemini-JSON
  // envelope.
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
