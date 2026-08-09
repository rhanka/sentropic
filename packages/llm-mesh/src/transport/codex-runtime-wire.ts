import { collectCodexInstructions, prepareCodexResponsesRequest } from '../codex.js';
import type { GenerateRequest } from '../generation.js';
import type { LlmMeshMessage } from '../messages.js';
import type { StreamEvent } from '../streaming.js';

type JsonRecord = Record<string, unknown>;
const asRecord = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value ?? ''); } catch { return String(value ?? ''); }
};

const content = (message: LlmMeshMessage): unknown => {
  if (typeof message.content === 'string') return message.content;
  return message.content.map((part) => {
    if (part.type === 'text') {
      return { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text };
    }
    if (part.type === 'image') {
      const imageUrl = part.url ?? (part.data
        ? `data:${part.mediaType ?? 'application/octet-stream'};base64,${part.data}`
        : '');
      return { type: 'input_image', image_url: imageUrl };
    }
    const fileData = part.url ?? (part.data
      ? `data:${part.mediaType ?? 'application/octet-stream'};base64,${part.data}`
      : '');
    return { type: 'input_file', filename: part.filename, file_data: fileData };
  });
};

const messageInput = (message: LlmMeshMessage): unknown[] => {
  if (message.role === 'system' || message.role === 'developer') return [];
  if (message.role === 'tool') {
    return [{
      type: 'function_call_output',
      call_id: message.toolResult.providerCallId ?? message.toolResult.toolCallId,
      output: stringify(message.toolResult.output),
    }];
  }
  const items: unknown[] = [{ type: 'message', role: message.role, content: content(message) }];
  if (message.role === 'assistant') {
    message.toolCalls?.forEach((call) => items.push({
      type: 'function_call', call_id: call.providerCallId ?? call.toolCallId,
      name: call.name, arguments: call.argumentsText,
    }));
  }
  return items;
};

export const buildCodexRuntimeRequest = (request: GenerateRequest) =>
  prepareCodexResponsesRequest({
    model: request.modelId ?? (typeof request.model === 'string' ? request.model : ''),
    stream: true,
    instructions: collectCodexInstructions(request.messages),
    input: request.messages.flatMap(messageInput),
    ...(request.tools?.length ? {
      tools: request.tools.map((tool) => ({
        type: 'function', name: tool.name, description: tool.description,
        parameters: tool.inputSchema, strict: tool.strict,
      })),
    } : {}),
    ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
    ...(request.reasoning ? { reasoning: { ...request.reasoning } } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.topP !== undefined ? { top_p: request.topP } : {}),
    include: ['reasoning.encrypted_content'],
  });

export const decodeCodexRuntimeEvent = (event: unknown): readonly StreamEvent[] => {
  const record = asRecord(event);
  const type = typeof record?.type === 'string' ? record.type : '';
  if (type === 'response.created') {
    const response = asRecord(record?.response);
    return [{
      type: 'status', data: {
        status: 'started', providerId: 'openai',
        ...(typeof response?.id === 'string' ? { providerResponseId: response.id } : {}),
      },
    }];
  }
  if (type === 'response.output_text.delta' && typeof record?.delta === 'string') {
    return [{ type: 'content_delta', data: { delta: record.delta } }];
  }
  if (type === 'response.reasoning_summary_text.delta' && typeof record?.delta === 'string') {
    return [{ type: 'reasoning_delta', data: { delta: record.delta, kind: 'summary' } }];
  }
  if (type === 'response.output_item.added') {
    const item = asRecord(record?.item);
    if (item?.type === 'function_call') return [{
      type: 'tool_call_start', data: {
        toolCallId: String(item.call_id ?? item.id ?? ''),
        providerCallId: String(item.call_id ?? item.id ?? ''),
        name: String(item.name ?? ''), argumentsText: String(item.arguments ?? ''),
      },
    }];
  }
  if (type === 'response.function_call_arguments.delta' && typeof record?.delta === 'string') {
    return [{
      type: 'tool_call_delta', data: {
        toolCallId: String(record.item_id ?? record.call_id ?? ''), delta: record.delta,
      },
    }];
  }
  if (type === 'response.completed') {
    const response = asRecord(record?.response); const usage = asRecord(response?.usage);
    return [{ type: 'done', data: {
      finishReason: 'stop', providerId: 'openai',
      ...(typeof response?.id === 'string' ? { providerResponseId: response.id } : {}),
      usage: {
        inputTokens: Number(usage?.input_tokens ?? 0),
        outputTokens: Number(usage?.output_tokens ?? 0),
        totalTokens: Number(usage?.total_tokens ?? 0), providerRawUsage: usage,
      },
    } }];
  }
  if (type === 'error' || type === 'response.failed') {
    const failure = asRecord(record?.error) ?? asRecord(asRecord(record?.response)?.error);
    return [{ type: 'error', data: {
      providerId: 'openai', message: String(failure?.message ?? 'Codex request failed'),
      code: String(failure?.code ?? type), retryable: Boolean(failure?.retryable),
    } }];
  }
  return [];
};
