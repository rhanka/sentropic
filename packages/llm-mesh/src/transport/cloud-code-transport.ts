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
    systemInstruction?: unknown;
    tools?: unknown[];
    toolConfig?: unknown;
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

  // P1-2: Always generate a valid UUID v4 for envelope requestId
  const requestId = randomUUID();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${acquisition.material.accessToken}`,
    'User-Agent': CLOUD_CODE_USER_AGENT,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(acquisition.runtime.headers ?? {}),
  };

  const body: CloudCodeEnvelope = {
    project: project.trim(),
    requestId,
    model: request.modelId,
    userAgent: 'antigravity',
    request: {
      contents: request.contents,
      ...(request.generationConfig ? { generationConfig: request.generationConfig } : {}),
      ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
      ...(request.tools?.length ? { tools: request.tools } : {}),
      ...(request.toolConfig ? { toolConfig: request.toolConfig } : {}),
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
  let lastUsage: unknown = null;
  let lastFinishReason: string | undefined;

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
          type CloudCodeStreamChunk = {
            candidates?: Array<{
              content?: { parts?: Array<{
                text?: string; thought?: boolean;
                functionCall?: { id?: string; name?: string; args?: unknown };
              }> };
              finishReason?: string;
            }>;
            usageMetadata?: unknown;
            error?: { message?: string; code?: number };
          };
          const parsed = JSON.parse(dataStr) as CloudCodeStreamChunk & {
            response?: CloudCodeStreamChunk;
          };
          const payload = parsed.response ?? parsed;

          if (payload.error) {
            yield {
              kind: 'error',
              code: String(payload.error.code ?? 'sse_error'),
              message: payload.error.message ?? 'Cloud Code SSE stream error',
            };
            return;
          }

          const parts = payload.candidates?.[0]?.content?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.text) yield {
                kind: part.thought ? 'reasoning' : 'content', delta: part.text,
              };
              if (part.functionCall?.name) yield {
                kind: 'tool-call',
                id: part.functionCall.id ?? part.functionCall.name,
                name: part.functionCall.name,
                arguments: part.functionCall.args ?? {},
              };
            }
          }

          if (payload.usageMetadata) {
            lastUsage = payload.usageMetadata;
          }
          if (typeof payload.candidates?.[0]?.finishReason === 'string') {
            lastFinishReason = payload.candidates[0].finishReason;
          }
        } catch {
          // Ignore unparseable SSE data lines
        }
      }
    }

    // P1-1: Yield done event exactly once after stream completion
    yield {
      kind: 'done', usage: lastUsage ?? {},
      ...(lastFinishReason ? { finishReason: lastFinishReason } : {}),
    };
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

    for (const diagnostic of request.diagnostics ?? []) {
      yield { kind: 'diagnostic', ...diagnostic };
    }

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
        statusCode: response.status,
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
        statusCode: 429,
        retryAfterMs,
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
        statusCode: response.status,
      };
      return;
    }

    if (!response.body) {
      await acquisition.recordOutcome({ status: 'failed', errorCode: 'no_body' });
      yield { kind: 'error', code: 'no_body', message: 'No response body received' };
      return;
    }

    let hasError = false;
    // P0-6: Wrap SSE iteration in try-catch to guarantee recordOutcome on network/stream exception
    try {
      for await (const event of parseCloudCodeSSE(response.body)) {
        if (signal.aborted) {
          return;
        }
        if (event.kind === 'error') {
          hasError = true;
        }
        yield event;
      }
    } catch (streamErr) {
      if (signal.aborted) {
        return;
      }
      await acquisition.recordOutcome({
        status: 'failed',
        errorCode: 'stream_error',
      });
      yield {
        kind: 'error',
        code: 'stream_error',
        message: streamErr instanceof Error ? streamErr.message : String(streamErr),
      };
      return;
    }

    if (!signal.aborted) {
      await acquisition.recordOutcome({
        status: hasError ? 'failed' : 'success',
      });
    }
  }
}
