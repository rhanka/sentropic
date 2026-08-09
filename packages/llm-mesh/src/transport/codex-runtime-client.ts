import { getSecretAuthMaterial } from '../auth.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { OpenAIAdapterClient } from '../adapters.js';
import type { ProviderRuntimeContext } from '../registry.js';
import type { StreamEvent, TokenUsage } from '../streaming.js';
import type { ToolCall } from '../tools.js';
import { buildCodexRuntimeRequest, decodeCodexRuntimeEvent } from './codex-runtime-wire.js';

export interface CodexRuntimeClientOptions {
  readonly fetch?: typeof fetch;
  readonly originator?: string;
  readonly userAgent?: string;
}

const parseSse = async function* (body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const payload = block.split('\n').filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim()).join('\n');
        if (payload && payload !== '[DONE]') yield JSON.parse(payload);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally { reader.releaseLock(); }
};

const tokenUsage = (event: StreamEvent): TokenUsage | undefined =>
  event.type === 'done' ? event.data.usage : undefined;

export class CodexRuntimeClient implements OpenAIAdapterClient {
  private readonly fetchFn: typeof fetch;
  private readonly originator: string;
  private readonly userAgent: string;

  constructor(options: CodexRuntimeClientOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.originator = options.originator ?? 'sentropic-llm-mesh';
    this.userAgent = options.userAgent ?? '@sentropic/llm-mesh';
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const auth = getSecretAuthMaterial(context?.auth);
    if (!auth || !('accessToken' in auth) || !auth.accessToken) {
      throw Object.assign(new Error('Codex account token is missing'), { status: 401 });
    }
    const prepared = buildCodexRuntimeRequest(request);
    const metadata = 'metadata' in auth ? auth.metadata : undefined;
    const stableSessionId = typeof metadata?.stableSessionId === 'string'
      ? metadata.stableSessionId : undefined;
    const accountId = 'accountId' in auth ? auth.accountId : undefined;
    const response = await this.fetchFn(prepared.url, {
      method: 'POST', signal: request.signal,
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json', accept: 'text/event-stream',
        originator: this.originator, 'user-agent': this.userAgent,
        session_id: stableSessionId ?? `codex_${Date.now().toString(36)}`,
        ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
      },
      body: JSON.stringify(prepared.body),
    });
    if (!response.ok || !response.body) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw Object.assign(new Error(`Codex HTTP error (${response.status})`), {
        status: response.status,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1_000 }
          : {}),
      });
    }
    return (async function* (): AsyncGenerator<StreamEvent> {
      for await (const raw of parseSse(response.body!)) {
        for (const event of decodeCodexRuntimeEvent(raw)) yield event;
      }
    })();
  }

  async generate(request: GenerateRequest, context?: ProviderRuntimeContext): Promise<GenerateResponse> {
    const stream = await this.stream(request, context);
    let text = ''; let usage: TokenUsage | undefined; let responseId = 'codex_response';
    let finishReason: GenerateResponse['finishReason'] = 'unknown';
    const toolCalls = new Map<string, ToolCall>();
    for await (const event of stream) {
      if (event.type === 'content_delta') text += event.data.delta;
      else if (event.type === 'tool_call_start') toolCalls.set(event.data.toolCallId, event.data);
      else if (event.type === 'tool_call_delta') {
        const current = toolCalls.get(event.data.toolCallId);
        if (current) toolCalls.set(event.data.toolCallId, {
          ...current, argumentsText: `${current.argumentsText}${event.data.delta}`,
        });
      } else if (event.type === 'error') {
        throw Object.assign(new Error(event.data.message), event.data);
      } else if (event.type === 'done') {
        usage = tokenUsage(event); responseId = event.data.providerResponseId ?? responseId;
        finishReason = event.data.finishReason ?? 'unknown';
      }
    }
    const calls = [...toolCalls.values()];
    // The live Codex backend can emit function-call items incrementally while
    // omitting them from response.completed.output. Collected calls are the
    // authoritative terminal signal for the canonical response.
    if (calls.length > 0) finishReason = 'tool_calls';
    return {
      id: responseId, providerId: 'openai',
      modelId: request.modelId ?? 'gpt-5.6-terra',
      message: {
        role: 'assistant', content: text,
        ...(calls.length > 0 ? { toolCalls: calls } : {}),
      },
      text, toolCalls: calls, finishReason, ...(usage ? { usage } : {}),
    };
  }
}
