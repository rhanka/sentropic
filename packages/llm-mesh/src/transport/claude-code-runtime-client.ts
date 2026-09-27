import type { AnthropicAdapterClient } from '../adapters.js';
import { getSecretAuthMaterial, type AuthInput } from '../auth.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { ProviderRuntimeContext } from '../registry.js';
import type { StreamEvent, TokenUsage } from '../streaming.js';
import type { ToolCall } from '../tools.js';

/** In-process secret boundary. Never serialize this input into logs, argv or env. */
export interface ClaudeCodeAccessProjection {
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly scopes: readonly string[];
}

export type ClaudeCodeCliContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ClaudeCodeCliRequest {
  readonly modelId: string;
  readonly messages: readonly {
    role: 'user' | 'assistant'; content: readonly ClaudeCodeCliContent[];
  }[];
  readonly tools?: readonly { name: string; description?: string; inputSchema: Record<string, unknown> }[];
}

/** Normalized by the trusted host; raw CLI output must never cross this seam. */
export type ClaudeCodeCliEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'result'; finishReason: 'stop' | 'length' | 'tool_calls';
      usage?: { inputTokens?: number; outputTokens?: number } }
  | { type: 'error' };

export interface ClaudeCodeCliRunner {
  /** Abort/iterator return kills and reaps children; result certifies cleanup. */
  run(input: { access: ClaudeCodeAccessProjection; request: ClaudeCodeCliRequest;
    signal: AbortSignal }): AsyncIterable<ClaudeCodeCliEvent>;
}

/** Trusted host attestations, never inferred from the installed CLI version. */
export interface ClaudeCodeCliCapabilities {
  readonly protocol: 'claude-code-stream-json-v1';
  readonly cliVersion: string;
  readonly source: string;
  readonly qualificationRef: string;
  readonly history?: string;
  readonly tools?: string;
}

export interface ClaudeCodeRuntimeClientOptions {
  readonly runner: ClaudeCodeCliRunner;
  readonly capabilities: ClaudeCodeCliCapabilities;
  readonly fallback?: AnthropicAdapterClient;
  readonly now?: () => number;
}

const failure = (code: 'unsupported' | 'auth' | 'runner' | 'aborted') => Object.assign(
  new Error(`Claude CLI ${code === 'aborted' ? 'request aborted' : `${code} unavailable`}`),
  { code: `claude_cli_${code}`, ...(code === 'aborted' ? { name: 'AbortError' } : {}) },
);
const textValue = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
const seat = (input?: AuthInput) => {
  const auth = getSecretAuthMaterial(input);
  return auth?.type === 'claude-code-account'
    || (auth?.type === 'account-transport' && auth.provider === 'claude-code');
};

const projectAccess = (input: AuthInput | undefined, now: number): ClaudeCodeAccessProjection => {
  const auth = getSecretAuthMaterial(input);
  if (!auth || (auth.type !== 'account-transport' && auth.type !== 'claude-code-account')
    || auth.provider !== 'claude-code' || ('status' in auth && auth.status === 'planned')) throw failure('auth');
  const expiresAt = 'expiresAt' in auth && typeof auth.expiresAt === 'string' ? Date.parse(auth.expiresAt) : NaN;
  const descriptor = auth.descriptor ?? (input && 'material' in input ? input.descriptor : undefined);
  const scopes = auth.type === 'account-transport' ? auth.metadata?.scopes : descriptor?.metadata?.scopes;
  if (!textValue(auth.accessToken) || !Number.isFinite(now) || !Number.isFinite(expiresAt)
    || expiresAt <= now || !Array.isArray(scopes) || !scopes.length
    || !scopes.every(textValue) || !scopes.includes('user:inference')) throw failure('auth');
  return { accessToken: auth.accessToken, expiresAt, scopes: [...scopes] };
};

const projectRequest = (request: StreamRequest, caps: ClaudeCodeCliCapabilities): ClaudeCodeCliRequest => {
  if (caps?.protocol !== 'claude-code-stream-json-v1' || !textValue(caps.cliVersion)
    || !textValue(caps.source) || !textValue(caps.qualificationRef)) throw failure('unsupported');
  if (request.providerId !== undefined && request.providerId !== 'anthropic') throw failure('unsupported');
  if (request.model !== undefined || !textValue(request.modelId)
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(request.modelId)) throw failure('unsupported');
  if ([request.temperature, request.topP, request.maxOutputTokens, request.reasoning,
    request.providerOptions, request.previousResponseId, request.parallelToolCalls].some((v) => v !== undefined)
    || (request.responseFormat !== undefined && request.responseFormat.type !== 'text')
    || (request.toolChoice !== undefined && request.toolChoice !== 'auto')) throw failure('unsupported');
  if (!request.messages.length || (!textValue(caps.history)
    && (request.messages.length !== 1 || request.messages[0].role !== 'user'))) throw failure('unsupported');
  const tools = request.tools?.map((tool) => {
    if (!textValue(caps.tools) || tool.type !== 'function' || !textValue(tool.name)
      || tool.strict !== undefined || tool.annotations || tool.metadata || tool.providerMetadata) throw failure('unsupported');
    return { name: tool.name, ...(tool.description !== undefined ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema };
  });
  if (tools && new Set(tools.map((tool) => tool.name)).size !== tools.length) throw failure('unsupported');
  const messages: ClaudeCodeCliRequest['messages'] = request.messages.map((message) => {
    if (message.role === 'system' || message.role === 'developer' || message.name || message.metadata) throw failure('unsupported');
    if (message.role === 'tool') {
      if (!textValue(caps.tools) || message.toolResult.content || message.toolResult.error
        || typeof message.toolResult.output !== 'string') throw failure('unsupported');
      return { role: 'user', content: [{ type: 'tool_result',
        tool_use_id: message.toolResult.providerCallId ?? message.toolResult.toolCallId,
        content: message.toolResult.output, ...(message.toolResult.isError !== undefined
          ? { is_error: message.toolResult.isError } : {}) }] };
    }
    const content: ClaudeCodeCliContent[] = typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : message.content.map((part) => {
        if (part.type !== 'text') throw failure('unsupported');
        return { type: 'text', text: part.text };
      });
    if (message.role === 'assistant') for (const call of message.toolCalls ?? []) {
      if (!textValue(caps.tools)) throw failure('unsupported');
      content.push({ type: 'tool_use', id: call.providerCallId ?? call.toolCallId,
        name: call.name, input: JSON.parse(call.argumentsText) });
    }
    return { role: message.role, content };
  });
  return { modelId: request.modelId, messages, ...(tools?.length ? { tools } : {}) };
};

export class ClaudeCodeRuntimeClient implements AnthropicAdapterClient {
  private readonly capabilities: ClaudeCodeCliCapabilities;
  constructor(private readonly options: ClaudeCodeRuntimeClientOptions) {
    this.capabilities = { ...options.capabilities };
  }

  private auth(request: GenerateRequest, context?: ProviderRuntimeContext): AuthInput | undefined {
    return context?.auth ?? (typeof request.auth === 'function' ? undefined : request.auth);
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const auth = this.auth(request, context);
    if (!seat(auth)) {
      if (!this.options.fallback) throw failure('auth');
      return this.options.fallback.stream(request, context);
    }
    if (request.signal?.aborted) throw failure('aborted');
    const access = projectAccess(auth, (this.options.now ?? Date.now)());
    let projected: ClaudeCodeCliRequest;
    try { projected = projectRequest(request, this.capabilities); }
    catch { throw failure('unsupported'); }
    return this.events(access, projected, request.signal);
  }

  private async *events(access: ClaudeCodeAccessProjection, request: ClaudeCodeCliRequest,
    signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const controller = new AbortController();
    const abort = () => controller.abort(); // Never forward the caller's possibly secret reason.
    signal?.addEventListener('abort', abort, { once: true });
    let iterator: AsyncIterator<ClaudeCodeCliEvent> | undefined;
    let cancelRead: (() => void) | undefined;
    try {
      if (signal?.aborted) abort();
      if (controller.signal.aborted) throw failure('aborted');
      if (access.expiresAt <= (this.options.now ?? Date.now)()) throw failure('auth');
      iterator = this.options.runner.run({ access, request, signal: controller.signal })[Symbol.asyncIterator]();
      let done: Extract<StreamEvent, { type: 'done' }> | undefined;
      const calls = new Set<string>();
      while (true) {
        if (controller.signal.aborted) throw failure('aborted');
        const cancelled = new Promise<never>((_, reject) => {
          cancelRead = () => reject(failure('aborted'));
          controller.signal.addEventListener('abort', cancelRead, { once: true });
        });
        const next = await Promise.race([iterator.next(), cancelled]);
        controller.signal.removeEventListener('abort', cancelRead!);
        if (controller.signal.aborted) throw failure('aborted');
        if (next.done) break;
        const event = next.value;
        if (done || !event) throw failure('runner');
        if (event.type === 'text_delta' && typeof event.text === 'string') {
          yield { type: 'content_delta', data: { delta: event.text } };
        } else if (event.type === 'tool_use') {
          if (!textValue(event.id) || calls.has(event.id)
            || !request.tools?.some((tool) => tool.name === event.name)
            || !event.input || typeof event.input !== 'object' || Array.isArray(event.input)) throw failure('runner');
          const argumentsText = JSON.stringify(event.input);
          calls.add(event.id);
          yield { type: 'tool_call_start', data: { toolCallId: event.id, providerCallId: event.id,
            name: event.name, argumentsText, arguments: JSON.parse(argumentsText), inputState: 'complete' } };
        } else if (event.type === 'result') {
          if (!['stop', 'length', 'tool_calls'].includes(event.finishReason)
            || (calls.size > 0) !== (event.finishReason === 'tool_calls')) throw failure('runner');
          const usage: TokenUsage = {};
          for (const key of ['inputTokens', 'outputTokens'] as const) {
            const value = event.usage?.[key];
            if (value !== undefined) {
              if (!Number.isSafeInteger(value) || value < 0) throw failure('runner');
              usage[key] = value;
            }
          }
          if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
            usage.totalTokens = usage.inputTokens + usage.outputTokens;
          }
          done = { type: 'done', data: { finishReason: event.finishReason,
            ...(event.usage ? { usage } : {}), providerId: 'anthropic', modelId: request.modelId } };
        } else throw failure('runner');
      }
      if (!done) throw failure('runner');
      yield done;
    } catch { throw failure(controller.signal.aborted ? 'aborted' : 'runner'); }
    finally {
      if (cancelRead) controller.signal.removeEventListener('abort', cancelRead);
      abort();
      signal?.removeEventListener('abort', abort);
      // A pending next must not trap caller cancellation; host cancellation owns cleanup.
      try { void Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* private host failure */ }
    }
  }

  async generate(request: GenerateRequest, context?: ProviderRuntimeContext): Promise<GenerateResponse> {
    if (!seat(this.auth(request, context))) {
      if (!this.options.fallback) throw failure('auth');
      return this.options.fallback.generate(request, context);
    }
    let text = ''; const calls: ToolCall[] = [];
    let done: Extract<StreamEvent, { type: 'done' }> | undefined;
    for await (const event of await this.stream(request, context)) {
      if (event.type === 'content_delta') text += event.data.delta;
      if (event.type === 'tool_call_start') calls.push(event.data);
      if (event.type === 'done') done = event;
    }
    return { id: 'claude_cli_response', providerId: 'anthropic', modelId: request.modelId!,
      message: { role: 'assistant', content: text, ...(calls.length ? { toolCalls: calls } : {}) },
      text, toolCalls: calls, finishReason: done!.data.finishReason!,
      ...(done!.data.usage ? { usage: done!.data.usage } : {}) };
  }
}
