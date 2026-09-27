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

class ClaudeCodeFailure extends Error {
  readonly code: string;
  constructor(code: 'unsupported' | 'auth' | 'runner' | 'aborted') {
    super(`Claude CLI ${code === 'aborted' ? 'request aborted' : `${code} unavailable`}`);
    this.code = `claude_cli_${code}`;
    if (code === 'aborted') this.name = 'AbortError';
  }
}
const failure = (code: ConstructorParameters<typeof ClaudeCodeFailure>[0]) => new ClaudeCodeFailure(code);
const textValue = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
const jsonCopy = (value: unknown, canonical = false): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map((entry) => jsonCopy(entry, canonical));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value);
    if (canonical) entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return Object.fromEntries(entries.map(([key, entry]) => [key, jsonCopy(entry, canonical)]));
  }
  throw failure('unsupported');
};
const jsonObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('unsupported');
  return jsonCopy(value) as Record<string, unknown>;
};
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
  const resolution = input && 'material' in input ? input.descriptor : undefined;
  const materialScopes = auth.descriptor?.metadata?.scopes;
  const scopes = auth.type === 'account-transport' ? auth.metadata?.scopes
    : materialScopes !== undefined ? materialScopes : resolution?.metadata?.scopes;
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
      inputSchema: jsonObject(tool.inputSchema) };
  });
  if (tools && new Set(tools.map((tool) => tool.name)).size !== tools.length) throw failure('unsupported');
  const pending = new Map<string, { name: string; toolCallId: string }>(); const seen = new Set<string>();
  const messages: { role: 'user' | 'assistant'; content: ClaudeCodeCliContent[] }[] = [];
  for (const message of request.messages) {
    if (message.role === 'system' || message.role === 'developer' || message.name || message.metadata) throw failure('unsupported');
    if (message.role === 'tool') {
      const result = message.toolResult;
      const matches = [...pending].filter(([id, call]) => id === result.providerCallId || call.toolCallId === result.toolCallId);
      const id = matches.length === 1 ? matches[0][0] : undefined;
      if (!textValue(caps.tools) || result.content || result.error || result.annotations
        || result.metadata || result.continuation || typeof result.output !== 'string'
        || !id || (result.name !== undefined && result.name !== pending.get(id)?.name)
        || (result.providerCallId !== undefined && result.providerCallId !== id)
        || result.toolCallId !== pending.get(id)?.toolCallId
        || (message.content !== '' && message.content !== result.output)) throw failure('unsupported');
      pending.delete(id);
      const content: ClaudeCodeCliContent = { type: 'tool_result',
        tool_use_id: id, content: result.output,
        ...(result.isError !== undefined ? { is_error: result.isError } : {}) };
      const previous = messages[messages.length - 1];
      if (previous?.role === 'user' && previous.content[0]?.type === 'tool_result') previous.content.push(content);
      else messages.push({ role: 'user', content: [content] });
      continue;
    }
    if (pending.size) throw failure('unsupported');
    const content: ClaudeCodeCliContent[] = typeof message.content === 'string'
      ? (message.content.trim() === '' ? [] : [{ type: 'text', text: message.content }])
      : message.content.flatMap((part) => {
        if (part.type !== 'text' || typeof part.text !== 'string') throw failure('unsupported');
        return part.text.trim() === '' ? [] : [{ type: 'text' as const, text: part.text }];
      });
    if (message.role === 'assistant') for (const call of message.toolCalls ?? []) {
      const id = call.providerCallId ?? call.toolCallId;
      if (!textValue(caps.tools) || !textValue(id) || !textValue(call.toolCallId)
        || seen.has(id) || seen.has(call.toolCallId) || call.annotations || call.metadata
        || !tools?.some((tool) => tool.name === call.name)) throw failure('unsupported');
      const input = jsonObject(JSON.parse(call.argumentsText));
      if (call.arguments !== undefined && JSON.stringify(jsonCopy(call.arguments, true))
        !== JSON.stringify(jsonCopy(input, true))) throw failure('unsupported');
      seen.add(id); seen.add(call.toolCallId); pending.set(id, { name: call.name, toolCallId: call.toolCallId });
      content.push({ type: 'tool_use', id, name: call.name, input });
    }
    if (!content.some((part) => part.type !== 'text' || part.text.trim().length > 0)) throw failure('unsupported');
    messages.push({ role: message.role, content });
  }
  if (pending.size) throw failure('unsupported');
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

  private delegatedRequest(request: StreamRequest, context?: ProviderRuntimeContext): StreamRequest {
    // Never let a fallback resolve a second credential instead of the selected auth.
    if (typeof request.auth === 'function' && !context?.auth) throw failure('auth');
    if (request.auth !== undefined && (request.auth !== context?.auth
      || (typeof request.auth !== 'function' && seat(request.auth)))) {
      const { auth: _auth, ...input } = request;
      return input;
    }
    return request;
  }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const auth = this.auth(request, context);
    if (!seat(auth)) {
      if (!this.options.fallback) throw failure('auth');
      return this.options.fallback.stream(this.delegatedRequest(request, context),
        context?.auth || !auth ? context : { ...context, auth });
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
          let argumentsText: string;
          try { argumentsText = JSON.stringify(jsonObject(event.input)); }
          catch { throw failure('runner'); }
          calls.add(event.id);
          yield { type: 'tool_call_start', data: { toolCallId: event.id, providerCallId: event.id,
            name: event.name, argumentsText, arguments: JSON.parse(argumentsText), inputState: 'complete' } };
        } else if (event.type === 'result') {
          if (!['stop', 'length', 'tool_calls'].includes(event.finishReason)
            || (calls.size > 0) !== (event.finishReason === 'tool_calls')) throw failure('runner');
          if (event.usage !== undefined && (!event.usage || typeof event.usage !== 'object'
            || Array.isArray(event.usage))) throw failure('runner');
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
            if (!Number.isSafeInteger(usage.totalTokens)) throw failure('runner');
          }
          done = { type: 'done', data: { finishReason: event.finishReason,
            ...(Object.keys(usage).length ? { usage } : {}), providerId: 'anthropic', modelId: request.modelId } };
        } else throw failure('runner');
      }
      if (!done) throw failure('runner');
      yield done;
    } catch (error) {
      if (controller.signal.aborted) throw failure('aborted');
      if (error instanceof ClaudeCodeFailure) throw error;
      throw failure('runner');
    }
    finally {
      if (cancelRead) controller.signal.removeEventListener('abort', cancelRead);
      abort();
      signal?.removeEventListener('abort', abort);
      // A pending next must not trap caller cancellation; host cancellation owns cleanup.
      try { void Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* private host failure */ }
    }
  }

  async generate(request: GenerateRequest, context?: ProviderRuntimeContext): Promise<GenerateResponse> {
    const auth = this.auth(request, context);
    if (!seat(auth)) {
      if (!this.options.fallback) throw failure('auth');
      return this.options.fallback.generate(this.delegatedRequest(request, context),
        context?.auth || !auth ? context : { ...context, auth });
    }
    let text = ''; const calls: ToolCall[] = [];
    let done: Extract<StreamEvent, { type: 'done' }> | undefined;
    for await (const event of await this.stream(request, context)) {
      if (event.type === 'content_delta') text += event.data.delta;
      if (event.type === 'tool_call_start') calls.push(event.data);
      if (event.type === 'done') done = event;
    }
    return { id: `claude_cli_${globalThis.crypto.randomUUID()}`, providerId: 'anthropic', modelId: request.modelId!,
      message: { role: 'assistant', content: text, ...(calls.length ? { toolCalls: calls } : {}) },
      text, toolCalls: calls, finishReason: done!.data.finishReason!,
      ...(done!.data.usage ? { usage: done!.data.usage } : {}) };
  }
}
