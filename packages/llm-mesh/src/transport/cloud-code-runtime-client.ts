import type { AccountTransportAcquisition } from '../account-transports.js';
import type { AccountTransportAuthMaterial } from '../auth.js';
import { getSecretAuthMaterial } from '../auth.js';
import type { GeminiAdapterClient } from '../adapters.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { LlmMeshMessage } from '../messages.js';
import type { ProviderRuntimeContext } from '../registry.js';
import type { ProviderEvent, ProviderRequest } from '../service/facade.js';
import type { StreamEvent, TokenUsage } from '../streaming.js';
import type { ToolCall } from '../tools.js';
import { CloudCodeProviderAdapter } from './cloud-code-transport.js';

const asSchema = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

/** Project JSON Schema onto the subset accepted by the Cloud Code Gemini wire. */
const cloudCodeSchema = (value: unknown): Record<string, unknown> => {
  const input = asSchema(value);
  if (!input) return {};
  const output: Record<string, unknown> = {};
  const declaredTypes = Array.isArray(input.type) ? input.type : undefined;
  const type = declaredTypes?.find((entry) => entry !== 'null') ?? input.type;
  if (typeof type === 'string') output.type = type;
  if (declaredTypes?.includes('null')) output.nullable = true;
  for (const key of ['format', 'title', 'description'] as const) {
    if (typeof input[key] === 'string') output[key] = input[key];
  }
  for (const key of ['nullable', 'minItems', 'maxItems', 'minimum', 'maximum'] as const) {
    if (typeof input[key] === 'boolean' || typeof input[key] === 'number') {
      output[key] = input[key];
    }
  }
  if (Array.isArray(input.enum) && input.enum.every((entry) => typeof entry === 'string')) {
    output.enum = input.enum;
  } else if (typeof input.const === 'string') {
    output.enum = [input.const];
  }
  if (input.items !== undefined) output.items = cloudCodeSchema(input.items);
  const properties = asSchema(input.properties);
  if (properties) {
    output.properties = Object.fromEntries(Object.entries(properties).map(
      ([key, schema]) => [key, cloudCodeSchema(schema)],
    ));
  }
  if (Array.isArray(input.required)) {
    output.required = input.required.filter((entry) => typeof entry === 'string');
  }
  const alternatives = Array.isArray(input.anyOf)
    ? input.anyOf
    : Array.isArray(input.oneOf) ? input.oneOf : undefined;
  if (alternatives) output.anyOf = alternatives.map(cloudCodeSchema);
  return output;
};

const messageParts = (message: LlmMeshMessage): unknown[] => {
  if (typeof message.content === 'string') return [{ text: message.content }];
  return message.content.map((part) => {
    if (part.type === 'text') return { text: part.text };
    if (part.type === 'image') return part.data
      ? { inlineData: { mimeType: part.mediaType ?? 'application/octet-stream', data: part.data } }
      : { fileData: { mimeType: part.mediaType, fileUri: part.url } };
    return part.data
      ? { inlineData: { mimeType: part.mediaType ?? 'application/octet-stream', data: part.data } }
      : { fileData: { mimeType: part.mediaType, fileUri: part.url } };
  });
};

const contents = (messages: readonly LlmMeshMessage[]) => messages.flatMap((message) => {
  if (message.role === 'system' || message.role === 'developer') return [];
  if (message.role === 'tool') return [{
    role: 'user', parts: [{ functionResponse: {
      id: message.toolResult.providerCallId ?? message.toolResult.toolCallId,
      name: message.toolResult.name, response: message.toolResult.output,
    } }],
  }];
  const parts = messageParts(message);
  if (message.role === 'assistant') message.toolCalls?.forEach((call) => parts.push({
    functionCall: {
      id: call.providerCallId ?? call.toolCallId, name: call.name,
      args: call.arguments ?? (() => {
        try { return JSON.parse(call.argumentsText); } catch { return call.argumentsText; }
      })(),
    },
  }));
  return [{ role: message.role === 'assistant' ? 'model' : 'user', parts }];
});

const providerRequest = (request: GenerateRequest): ProviderRequest => ({
  modelId: request.modelId ?? (typeof request.model === 'string' ? request.model : ''),
  contents: contents(request.messages),
  systemInstruction: {
    parts: request.messages
      .filter((message) => message.role === 'system' || message.role === 'developer')
      .flatMap(messageParts),
  },
  ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map((tool) => ({
    name: tool.name, description: tool.description, parameters: cloudCodeSchema(tool.inputSchema),
  })) }] } : {}),
  generationConfig: {
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.topP !== undefined ? { topP: request.topP } : {}),
    ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
    ...(request.reasoning ? { thinkingConfig: request.reasoning } : {}),
  },
});

const usage = (value: unknown): TokenUsage => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const inputTokens = Number(record.promptTokenCount ?? record.promptTokens ?? 0);
  const outputTokens = Number(record.candidatesTokenCount ?? record.outputTokens ?? 0);
  return {
    inputTokens, outputTokens,
    totalTokens: Number(record.totalTokenCount ?? inputTokens + outputTokens),
    providerRawUsage: value,
  };
};

export class CloudCodeRuntimeClient implements GeminiAdapterClient {
  private readonly adapter: CloudCodeProviderAdapter;
  constructor(fetchFn: typeof fetch = fetch) { this.adapter = new CloudCodeProviderAdapter(fetchFn); }

  async stream(request: StreamRequest, context?: ProviderRuntimeContext): Promise<StreamResult> {
    const auth = getSecretAuthMaterial(context?.auth);
    if (!auth || auth.type !== 'account-transport' || !auth.accessToken) {
      throw Object.assign(new Error('Cloud Code account token is missing'), { status: 401 });
    }
    const material = auth as AccountTransportAuthMaterial;
    const metadata = material.metadata;
    const acquisition: AccountTransportAcquisition = {
      material,
      descriptor: { sourceType: 'account-transport', accountProviderId: material.provider },
      lease: {
        leaseId: String(metadata?.leaseId ?? 'route'), accountId: material.accountId ?? 'route',
        stableSessionId: String(metadata?.stableSessionId ?? 'route'),
        createdAt: new Date().toISOString(),
      },
      reservation: {
        reservationId: 'route', accountId: material.accountId ?? 'route', leaseId: 'route',
        expiresAt: new Date().toISOString(),
      },
      runtime: { stableSessionId: String(metadata?.stableSessionId ?? 'route'), metadata },
      async recordOutcome() {},
    };
    return this.events(this.adapter.execute(
      acquisition, providerRequest(request), request.signal ?? new AbortController().signal,
    ));
  }

  private async *events(source: AsyncIterable<ProviderEvent>): AsyncGenerator<StreamEvent> {
    for await (const event of source) {
      if (event.kind === 'content') yield { type: 'content_delta', data: { delta: event.delta } };
      else if (event.kind === 'reasoning') yield {
        type: 'reasoning_delta', data: { delta: event.delta, kind: 'summary' },
      };
      else if (event.kind === 'tool-call') yield {
        type: 'tool_call_start', data: {
          toolCallId: event.id, providerCallId: event.id, name: event.name,
          argumentsText: JSON.stringify(event.arguments), arguments: event.arguments,
        },
      };
      else if (event.kind === 'error') yield { type: 'error', data: {
        providerId: 'gemini', message: event.message, code: event.code,
        retryable: event.statusCode === 429 || Boolean(event.statusCode && event.statusCode >= 500),
        ...(event.statusCode ? { statusCode: event.statusCode } : {}),
        ...(event.retryAfterMs ? { retryAfterMs: event.retryAfterMs } : {}),
      } };
      else yield { type: 'done', data: { finishReason: 'stop', usage: usage(event.usage) } };
    }
  }

  async generate(request: GenerateRequest, context?: ProviderRuntimeContext): Promise<GenerateResponse> {
    let text = ''; let finalUsage: TokenUsage | undefined; const calls: ToolCall[] = [];
    for await (const event of await this.stream(request, context)) {
      if (event.type === 'content_delta') text += event.data.delta;
      else if (event.type === 'tool_call_start') calls.push(event.data);
      else if (event.type === 'error') throw Object.assign(new Error(event.data.message), event.data);
      else if (event.type === 'done') finalUsage = event.data.usage;
    }
    return {
      id: 'cloud_code_response', providerId: 'gemini',
      modelId: request.modelId ?? 'gemini-3.5-flash',
      message: { role: 'assistant', content: text, ...(calls.length ? { toolCalls: calls } : {}) },
      text, toolCalls: calls, finishReason: calls.length ? 'tool_calls' : 'stop',
      ...(finalUsage ? { usage: finalUsage } : {}),
    };
  }
}
