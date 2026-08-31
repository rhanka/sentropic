import type {
  GenerateRequest,
  GenerateResponse,
  PlannedRouteTarget,
  StreamEvent as MeshStreamEvent,
  StreamRequest,
  StreamResult,
  VerifiedRoutingSubject,
} from '@sentropic/llm-mesh';
import type OpenAI from 'openai';
import { toMeshTokenUsage } from '../llm-metering';
import { isProviderId } from '../provider-runtime';
import { callLLM, callLLMStream } from './index';
export interface GatewayRuntimeDispatchPort {
  generate(
    subject: VerifiedRoutingSubject,
    workspaceId: string | undefined,
    target: PlannedRouteTarget,
    request: GenerateRequest,
  ): Promise<GenerateResponse>;
  stream(
    subject: VerifiedRoutingSubject,
    workspaceId: string | undefined,
    target: PlannedRouteTarget,
    request: StreamRequest,
  ): Promise<StreamResult>;
}
const textContent = (content: GenerateRequest['messages'][number]['content']): string =>
  typeof content === 'string'
    ? content
    : content.map((part) => 'text' in part ? part.text : part.url ?? '').join('');
const toMessages = (
  messages: GenerateRequest['messages'],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => messages.map((message) => {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolResult.toolCallId,
      content: typeof message.toolResult.output === 'string'
        ? message.toolResult.output
        : JSON.stringify(message.toolResult.output),
    };
  }
  const base = { role: message.role, content: textContent(message.content) };
  if (message.role !== 'assistant' || !message.toolCalls?.length) {
    return base as OpenAI.Chat.Completions.ChatCompletionMessageParam;
  }
  return {
    ...base,
    role: 'assistant',
    tool_calls: message.toolCalls.map((tool) => ({
      id: tool.providerCallId ?? tool.toolCallId,
      type: 'function' as const,
      function: { name: tool.name, arguments: tool.argumentsText },
    })),
  };
});
const toTools = (request: GenerateRequest): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined =>
  request.tools?.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: tool.inputSchema,
      ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    },
  }));
const providerFor = (target: PlannedRouteTarget) => {
  if (!isProviderId(target.providerId)) throw new Error(`unsupported provider: ${target.providerId}`);
  return target.providerId;
};
const common = (
  subject: VerifiedRoutingSubject,
  workspaceId: string | undefined,
  target: PlannedRouteTarget,
  request: GenerateRequest,
) => ({
  providerId: providerFor(target),
  model: target.modelId,
  userId: subject.principalRef,
  ...(workspaceId ? { workspaceId } : {}),
  messages: toMessages(request.messages),
  ...(toTools(request) ? { tools: toTools(request) } : {}),
  ...(typeof request.toolChoice === 'string' ? { toolChoice: request.toolChoice } : {}),
  ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
  ...(request.signal ? { signal: request.signal } : {}),
});
const mapStreamEvent = (event: { type: string; data: unknown }, providerId: string): MeshStreamEvent => {
  const data = (event.data ?? {}) as Record<string, unknown>;
  if (event.type === 'status') {
    return { type: 'status', data: { status: String(data.state ?? data.status ?? 'started') } };
  }
  if (event.type === 'content_delta' || event.type === 'reasoning_delta') {
    return { type: event.type, data: { delta: String(data.delta ?? '') } };
  }
  if (event.type === 'tool_call_start') {
    const id = String(data.tool_call_id ?? data.toolCallId ?? 'tool');
    return { type: 'tool_call_start', data: {
      toolCallId: id, providerCallId: id, name: String(data.name ?? 'tool'),
      argumentsText: String(data.args ?? ''),
    } };
  }
  if (event.type === 'tool_call_delta') {
    return { type: 'tool_call_delta', data: {
      toolCallId: String(data.tool_call_id ?? data.toolCallId ?? 'tool'),
      delta: String(data.delta ?? ''),
    } };
  }
  if (event.type === 'done') {
    return { type: 'done', data: {
      finishReason: 'stop', ...(toMeshTokenUsage(data.usage) ? { usage: toMeshTokenUsage(data.usage) } : {}),
    } };
  }
  return { type: 'error', data: {
    providerId: providerId as never,
    message: String(data.message ?? 'provider stream failed'), retryable: false,
  } };
};

export const applicationGatewayRuntime: GatewayRuntimeDispatchPort = {
  async generate(subject, workspaceId, target, request) {
    const response = await callLLM(common(subject, workspaceId, target, request));
    const choice = response.choices[0];
    const toolCalls = choice?.message.tool_calls?.flatMap((tool) => {
      const value = tool as { id: string; function?: { name: string; arguments: string } };
      return value.function ? [{
        toolCallId: value.id, providerCallId: value.id,
        name: value.function.name, argumentsText: value.function.arguments,
      }] : [];
    }) ?? [];
    return {
      id: response.id, providerId: providerFor(target), modelId: target.modelId,
      message: { role: 'assistant', content: choice?.message.content ?? '', toolCalls },
      text: choice?.message.content ?? '', toolCalls,
      finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
      ...(toMeshTokenUsage(response.usage) ? { usage: toMeshTokenUsage(response.usage) } : {}),
    };
  },
  async stream(subject, workspaceId, target, request) {
    const source = callLLMStream({
      ...common(subject, workspaceId, target, request),
      ...(request.previousResponseId ? { previousResponseId: request.previousResponseId } : {}),
    });
    return (async function* () {
      for await (const event of source) yield mapStreamEvent(event, target.providerId);
    })();
  },
};
