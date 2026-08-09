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

export interface CloudCodeSchemaProjection {
  readonly schema: Record<string, unknown>;
  readonly droppedConstraints: readonly string[];
}

/**
 * Project JSON Schema onto the Cloud Code subset and return every lossy step.
 * The provider request carries only `schema`; diagnostics travel on the local
 * canonical stream so weakening is observable without sending unknown fields
 * to Google.
 */
export const projectCloudCodeSchema = (
  value: unknown,
  path = '$',
): CloudCodeSchemaProjection => {
  const input = asSchema(value);
  if (!input) return { schema: {}, droppedConstraints: [`${path}:non-object-schema`] };
  const output: Record<string, unknown> = {};
  const dropped: string[] = [];
  const handled = new Set([
    'type', 'format', 'title', 'description', 'nullable', 'minItems', 'maxItems',
    'minimum', 'maximum', 'enum', 'const', 'items', 'properties', 'required',
    'anyOf', 'oneOf', 'default', 'examples',
  ]);
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
  if (input.items !== undefined) {
    const projected = projectCloudCodeSchema(input.items, `${path}.items`);
    output.items = projected.schema;
    dropped.push(...projected.droppedConstraints);
  }
  const properties = asSchema(input.properties);
  if (properties) {
    output.properties = Object.fromEntries(Object.entries(properties).map(([key, schema]) => {
      const projected = projectCloudCodeSchema(schema, `${path}.properties.${key}`);
      dropped.push(...projected.droppedConstraints);
      return [key, projected.schema];
    }));
  }
  if (Array.isArray(input.required)) {
    output.required = input.required.filter((entry) => typeof entry === 'string');
  }
  const alternatives = Array.isArray(input.anyOf)
    ? input.anyOf
    : Array.isArray(input.oneOf) ? input.oneOf : undefined;
  if (alternatives) {
    output.anyOf = alternatives.map((alternative, index) => {
      const projected = projectCloudCodeSchema(alternative, `${path}.anyOf[${index}]`);
      dropped.push(...projected.droppedConstraints);
      return projected.schema;
    });
    if (Array.isArray(input.oneOf)) dropped.push(`${path}:oneOf->anyOf`);
  }
  if (Array.isArray(input.enum) && !input.enum.every((entry) => typeof entry === 'string')) {
    dropped.push(`${path}:non-string-enum`);
  }
  if (input.const !== undefined && typeof input.const !== 'string') {
    dropped.push(`${path}:non-string-const`);
  }
  for (const key of Object.keys(input)) {
    if (!handled.has(key)) dropped.push(`${path}:${key}`);
  }
  return { schema: output, droppedConstraints: [...new Set(dropped)].sort() };
};

const messageParts = (message: LlmMeshMessage): unknown[] => {
  if (typeof message.content === 'string') return [{ text: message.content }];
  return message.content.map((part) => {
    if (part.type === 'text') return { text: part.text };
    if (part.type === 'reasoning') return {
      text: part.text,
      thought: true,
      ...(part.signature ? { thoughtSignature: part.signature } : {}),
    };
    if (part.type === 'image') return part.data
      ? { inlineData: { mimeType: part.mediaType ?? 'application/octet-stream', data: part.data } }
      : { fileData: { mimeType: part.mediaType, fileUri: part.url } };
    return part.data
      ? { inlineData: { mimeType: part.mediaType ?? 'application/octet-stream', data: part.data } }
      : { fileData: { mimeType: part.mediaType, fileUri: part.url } };
  });
};

const cloudCodeToolConfig = (request: GenerateRequest): unknown => {
  if (!request.toolChoice) return undefined;
  const choice = request.toolChoice;
  const mode = choice === 'required' || (typeof choice === 'object' && choice.type === 'tool')
    ? 'ANY'
    : choice === 'none' ? 'NONE' : 'AUTO';
  return {
    functionCallingConfig: {
      mode,
      ...(typeof choice === 'object' && choice.type === 'tool'
        ? { allowedFunctionNames: [choice.name] }
        : {}),
    },
  };
};

const cloudCodeThinkingConfig = (request: GenerateRequest): unknown => {
  if (!request.reasoning) return undefined;
  const config = {
    ...(request.reasoning.effort && request.reasoning.effort !== 'none'
      ? {
          thinkingLevel: request.reasoning.effort === 'low'
            ? 'LOW'
            : request.reasoning.effort === 'medium' ? 'MEDIUM' : 'HIGH',
        }
      : {}),
    ...(request.reasoning.enabled !== undefined
      ? { includeThoughts: request.reasoning.enabled }
      : {}),
    ...(request.reasoning.budgetTokens !== undefined
      ? { thinkingBudget: request.reasoning.budgetTokens }
      : {}),
  };
  return Object.keys(config).length > 0 ? config : undefined;
};

const functionResponse = (output: unknown): Record<string, unknown> =>
  asSchema(output) ?? { output: output ?? null };

const contents = (messages: readonly LlmMeshMessage[]) => messages.flatMap((message) => {
  if (message.role === 'system' || message.role === 'developer') return [];
  if (message.role === 'tool') return [{
    role: 'user', parts: [{ functionResponse: {
      id: message.toolResult.providerCallId ?? message.toolResult.toolCallId,
      name: message.toolResult.name, response: functionResponse(message.toolResult.output),
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

const providerRequest = (request: GenerateRequest): ProviderRequest => {
  const projections = request.tools?.map((tool) => ({
    tool,
    projection: projectCloudCodeSchema(tool.inputSchema, `tools.${tool.name}`),
  })) ?? [];
  const droppedConstraints = projections.flatMap(({ projection }) =>
    projection.droppedConstraints);
  return {
    modelId: request.modelId ?? (typeof request.model === 'string' ? request.model : ''),
    contents: contents(request.messages),
    systemInstruction: {
      parts: request.messages
        .filter((message) => message.role === 'system' || message.role === 'developer')
        .flatMap(messageParts),
    },
    ...(projections.length ? { tools: [{ functionDeclarations: projections.map(({ tool, projection }) => ({
      name: tool.name, description: tool.description, parameters: projection.schema,
    })) }] } : {}),
    ...(droppedConstraints.length > 0 ? { diagnostics: [{
      code: 'cloud-code-schema-projection-loss',
      message: `Cloud Code schema projection omitted ${droppedConstraints.length} constraint(s)`,
      metadata: { droppedConstraints },
    }] } : {}),
    ...(cloudCodeToolConfig(request) ? { toolConfig: cloudCodeToolConfig(request) } : {}),
    generationConfig: {
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { topP: request.topP } : {}),
      ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      ...(cloudCodeThinkingConfig(request)
        ? { thinkingConfig: cloudCodeThinkingConfig(request) }
        : {}),
    },
  };
};

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
    let sawToolCall = false;
    for await (const event of source) {
      if (event.kind === 'content') yield { type: 'content_delta', data: { delta: event.delta } };
      else if (event.kind === 'reasoning') yield {
        type: 'reasoning_delta', data: { delta: event.delta, kind: 'summary' },
      };
      else if (event.kind === 'tool-call') {
        sawToolCall = true;
        yield { type: 'tool_call_start', data: {
          toolCallId: event.id, providerCallId: event.id, name: event.name,
          argumentsText: JSON.stringify(event.arguments), arguments: event.arguments,
        } };
      }
      else if (event.kind === 'diagnostic') yield {
        type: 'status', data: {
          status: 'schema_projection', providerId: 'gemini',
          message: event.message,
          metadata: { code: event.code, ...(event.metadata ?? {}) },
        },
      };
      else if (event.kind === 'error') yield { type: 'error', data: {
        providerId: 'gemini', message: event.message, code: event.code,
        retryable: event.statusCode === 429 || Boolean(event.statusCode && event.statusCode >= 500),
        ...(event.statusCode ? { statusCode: event.statusCode } : {}),
        ...(event.retryAfterMs ? { retryAfterMs: event.retryAfterMs } : {}),
      } };
      else yield { type: 'done', data: {
        finishReason: sawToolCall || event.finishReason === 'FUNCTION_CALL'
          ? 'tool_calls'
          : event.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
        usage: usage(event.usage),
      } };
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
