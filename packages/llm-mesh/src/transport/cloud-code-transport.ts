import { randomUUID } from 'crypto';
import type { AccountTransportAcquisition } from '../account-transports.js';
import type {
  ProviderAdapter,
  ProviderEvent,
  ProviderRequest,
} from '../service/facade.js';

export const CLOUD_CODE_STREAM_URL =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse';
export const CLOUD_CODE_USER_AGENT =
  'antigravity/cli/1.1.10 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)';

export interface CloudCodeEnvelope {
  project: string;
  requestId: string;
  model: string;
  userAgent: string;
  request: {
    contents: unknown[];
    generationConfig?: unknown;
  };
}

export function buildCloudCodeRequest(
  acquisition: AccountTransportAcquisition,
  request: ProviderRequest,
): { url: string; headers: Record<string, string>; body: CloudCodeEnvelope } {
  const project =
    (acquisition.runtime.metadata?.cloudaicompanionProject as string | undefined) ??
    (acquisition.material.metadata?.cloudaicompanionProject as string | undefined);

  if (!project || typeof project !== 'string' || project.trim().length === 0) {
    throw new Error(
      'Cloud Code transport error: cloudaicompanionProject is required in acquisition runtime metadata',
    );
  }

  const requestId = acquisition.reservation.reservationId
    ? acquisition.reservation.reservationId.replace(/^reservation_/, '')
    : randomUUID();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${acquisition.material.accessToken}`,
    'User-Agent': CLOUD_CODE_USER_AGENT,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(acquisition.runtime.headers ?? {}),
  };

  const body: CloudCodeEnvelope = {
    project: project.trim(),
    requestId: requestId.includes('-') ? requestId : randomUUID(),
    model: request.modelId,
    userAgent: 'antigravity',
    request: {
      contents: request.contents,
      ...(request.generationConfig ? { generationConfig: request.generationConfig } : {}),
    },
  };

  return {
    url: CLOUD_CODE_STREAM_URL,
    headers,
    body,
  };
}

export async function* parseCloudCodeSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<ProviderEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
              finishReason?: string;
            }>;
            usageMetadata?: unknown;
            error?: { message?: string; code?: number };
          };

          if (parsed.error) {
            yield {
              kind: 'error',
              code: String(parsed.error.code ?? 'sse_error'),
              message: parsed.error.message ?? 'Cloud Code SSE stream error',
            };
            return;
          }

          const parts = parsed.candidates?.[0]?.content?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.text) {
                yield { kind: 'content', delta: part.text };
              }
            }
          }

          if (parsed.usageMetadata) {
            yield { kind: 'done', usage: parsed.usageMetadata };
          }
        } catch {
          // Ignore unparseable SSE data lines
        }
      }
    }

    yield { kind: 'done', usage: {} };
  } finally {
    reader.releaseLock();
  }
}

export class CloudCodeProviderAdapter implements ProviderAdapter {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async *execute(
    acquisition: AccountTransportAcquisition,
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    if (signal.aborted) {
      // Q2B: abort = 0 outcome, handle via release
      return;
    }

    const { url, headers, body } = buildCloudCodeRequest(acquisition, request);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) {
        // Abort -> no outcome recorded
        return;
      }
      await acquisition.recordOutcome({
        status: 'failed',
        errorCode: 'network_error',
      });
      yield {
        kind: 'error',
        code: 'network_error',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    if (signal.aborted) {
      return;
    }

    if (response.status === 401 || response.status === 403) {
      await acquisition.recordOutcome({
        status: 'auth_failed',
        providerStatusCode: response.status,
      });
      yield {
        kind: 'error',
        code: 'auth_failed',
        message: `Cloud Code authentication failed (${response.status})`,
      };
      return;
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      let retryAfterMs: number | undefined;
      if (retryAfterHeader) {
        const parsedSeconds = Number.parseInt(retryAfterHeader, 10);
        if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
          retryAfterMs = parsedSeconds * 1000;
        }
      }
      await acquisition.recordOutcome({
        status: 'rate_limited',
        providerStatusCode: 429,
        retryAfterMs,
      });
      yield {
        kind: 'error',
        code: 'rate_limited',
        message: 'Cloud Code rate limit exceeded (429)',
      };
      return;
    }

    if (!response.ok) {
      await acquisition.recordOutcome({
        status: 'failed',
        providerStatusCode: response.status,
      });
      yield {
        kind: 'error',
        code: 'http_error',
        message: `Cloud Code HTTP error (${response.status})`,
      };
      return;
    }

    if (!response.body) {
      await acquisition.recordOutcome({ status: 'failed', errorCode: 'no_body' });
      yield { kind: 'error', code: 'no_body', message: 'No response body received' };
      return;
    }

    let hasError = false;
    for await (const event of parseCloudCodeSSE(response.body)) {
      if (signal.aborted) {
        return;
      }
      if (event.kind === 'error') {
        hasError = true;
      }
      yield event;
    }

    if (!signal.aborted) {
      await acquisition.recordOutcome({
        status: hasError ? 'failed' : 'success',
      });
    }
  }
}
