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
  const expiresAt = typeof auth.expiresAt === 'string' ? Date.parse(auth.expiresAt) : NaN;
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
