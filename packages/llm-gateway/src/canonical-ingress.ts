import type {
  CapabilityRequirement, GenerateRequest, LlmMeshMessage, MessageContent, ToolDefinition,
  ToolResultContent,
} from '@sentropic/llm-mesh';
import type { GatewayWire } from './ports/dispatch.js';

export interface CanonicalIngressResult {
  readonly request: GenerateRequest;
  readonly requiredCapabilities: readonly CapabilityRequirement[];
}

type JsonRecord = Record<string, unknown>;
const asRecord = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
const records = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(asRecord).filter((item): item is JsonRecord => Boolean(item)) : [];

const contentParts = (content: unknown): LlmMeshMessage['content'] => {
  if (typeof content === 'string') return content;
  const inputParts = records(content);
  const parts: Exclude<MessageContent, string>[number][] = [];
  for (const part of inputParts) {
    if ((part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'image') {
      const source = asRecord(part.source);
      parts.push({
        type: 'image',
        ...(typeof source?.media_type === 'string' ? { mediaType: source.media_type } : {}),
        ...(typeof source?.data === 'string' ? { data: source.data } : {}),
        ...(typeof source?.url === 'string' ? { url: source.url } : {}),
      });
      continue;
    }
    if (part.type === 'image_url') {
      const image = asRecord(part.image_url);
      const url = typeof part.image_url === 'string' ? part.image_url : image?.url;
      if (typeof url === 'string') parts.push({ type: 'image', url });
    }
  }
  if (inputParts.some((part) => part.type === 'tool_use' || part.type === 'tool_result')) {
    return parts;
  }
  return parts.length > 0 ? parts : JSON.stringify(content ?? '');
};

const openAiToolCalls = (message: JsonRecord) => records(message.tool_calls).map((call) => {
  const fn = asRecord(call.function);
  return {
    toolCallId: String(call.id ?? ''),
    providerCallId: String(call.id ?? ''),
    name: String(fn?.name ?? ''),
    argumentsText: typeof fn?.arguments === 'string' ? fn.arguments : JSON.stringify(fn?.arguments ?? {}),
  };
});

const anthropicToolCalls = (content: unknown) => records(content)
  .filter((part) => part.type === 'tool_use')
  .map((part) => ({
    toolCallId: String(part.id ?? ''),
    providerCallId: String(part.id ?? ''),
    name: String(part.name ?? ''),
    argumentsText: JSON.stringify(part.input ?? {}),
    arguments: part.input ?? {},
  }));

const toolResultContent = (content: unknown): ToolResultContent[] => {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'json', value: content }];
  return records(content).map((part): ToolResultContent => {
    if ((part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string') {
      return { type: 'text', text: part.text };
    }
    if (part.type === 'image') {
      const source = asRecord(part.source);
      return {
        type: 'media',
        mediaType: typeof source?.media_type === 'string'
          ? source.media_type
          : 'application/octet-stream',
        ...(typeof source?.data === 'string' ? { data: source.data } : {}),
        ...(typeof source?.url === 'string' ? { url: source.url } : {}),
      };
    }
    return { type: 'json', value: part };
  });
};

const toolResultOutput = (content: unknown): Record<string, unknown> => {
  if (typeof content === 'string') return { content };
  if (Array.isArray(content)) {
    const parts = records(content);
    if (parts.length === content.length && parts.every((part) =>
      (part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string')) {
      return { content: parts.map((part) => part.text).join('\n') };
    }
  }
  return { content: content ?? '' };
};

const errorMessage = (content: unknown): string => {
  if (typeof content === 'string') return content;
  const text = records(content)
    .filter((part) => (part.type === 'text' || part.type === 'input_text'))
    .map((part) => part.text)
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  return text || 'Tool execution failed';
};

const normalizeMessages = (value: unknown): LlmMeshMessage[] => {
  const output: LlmMeshMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const message of records(value)) {
    const role = typeof message.role === 'string' ? message.role : 'user';
    if (role === 'assistant') {
      const calls = [...openAiToolCalls(message), ...anthropicToolCalls(message.content)];
      calls.forEach((call) => toolNames.set(call.providerCallId, call.name));
      output.push({
        role, content: contentParts(message.content),
        ...(calls.length > 0 ? { toolCalls: calls } : {}), metadata: { ingress: message },
      });
      continue;
    }
    if (role === 'tool') {
      const toolCallId = String(message.tool_call_id ?? '');
      const name = toolNames.get(toolCallId);
      output.push({
        role: 'tool', content: contentParts(message.content),
        toolResult: {
          toolCallId, providerCallId: toolCallId, output: message.content,
          ...(name ? { name } : {}),
        },
        metadata: { ingress: message },
      });
      continue;
    }
    const anthropicResults = role === 'user'
      ? records(message.content).filter((part) => part.type === 'tool_result')
      : [];
    for (const result of anthropicResults) {
      const toolCallId = String(result.tool_use_id ?? '');
      const name = toolNames.get(toolCallId);
      const isError = result.is_error === true;
      output.push({
        role: 'tool', content: contentParts(result.content),
        toolResult: {
          toolCallId, providerCallId: toolCallId,
          ...(name ? { name } : {}),
          output: toolResultOutput(result.content),
          content: toolResultContent(result.content),
          ...(isError ? {
            isError: true,
            error: { type: 'tool_error', message: errorMessage(result.content), retryable: false },
          } : {}),
          metadata: { ingress: result },
        },
        metadata: { ingress: message },
      });
    }
    const residualContent = anthropicResults.length > 0 && Array.isArray(message.content)
      ? message.content.filter((part) => asRecord(part)?.type !== 'tool_result')
      : message.content;
    if (anthropicResults.length > 0 && Array.isArray(residualContent) && residualContent.length === 0) {
      continue;
    }
    output.push({
      role: role === 'system' || role === 'developer' ? role : 'user',
      content: contentParts(residualContent), metadata: { ingress: message },
    });
  }
  return output;
};

const normalizeTools = (value: unknown): ToolDefinition[] => records(value).flatMap((tool) => {
  const fn = asRecord(tool.function) ?? tool;
  const name = fn.name;
  if (typeof name !== 'string') return [];
  return [{
    type: 'function' as const, name,
    ...(typeof fn.description === 'string' ? { description: fn.description } : {}),
    inputSchema: (asRecord(fn.parameters) ?? asRecord(fn.input_schema) ?? {}),
    providerMetadata: { ingress: tool },
  }];
});

export const normalizeGatewayIngress = (
  wire: GatewayWire,
  body: unknown,
): CanonicalIngressResult => {
  const raw = asRecord(body);
  if (!raw || typeof raw.model !== 'string') throw new Error('invalid gateway request');
  const messages = normalizeMessages(raw.messages);
  if (wire === 'anthropic-messages' && raw.system !== undefined) {
    messages.unshift({ role: 'system', content: contentParts(raw.system) });
  }
  const tools = normalizeTools(raw.tools);
  const serialized = JSON.stringify(body);
  const required = new Set<CapabilityRequirement>();
  if (tools.length > 0 || messages.some((message) =>
    message.role === 'tool' || (message.role === 'assistant' && Boolean(message.toolCalls?.length)))) {
    required.add('tools');
  }
  if (serialized.includes('image_url') || serialized.includes('"type":"image"')) {
    required.add('input:image');
  }
  if (raw.reasoning !== undefined || raw.thinking !== undefined) required.add('reasoning');
  if (raw.stream === true) required.add('streaming');
  const request: GenerateRequest = {
    model: raw.model as GenerateRequest['model'], messages,
    ...(tools.length > 0 ? { tools } : {}),
    ...(typeof raw.max_tokens === 'number' ? { maxOutputTokens: raw.max_tokens } : {}),
    ...(typeof raw.max_completion_tokens === 'number'
      ? { maxOutputTokens: raw.max_completion_tokens }
      : {}),
    ...(typeof raw.temperature === 'number' ? { temperature: raw.temperature } : {}),
    ...(typeof raw.top_p === 'number' ? { topP: raw.top_p } : {}),
    providerOptions: { ingressWire: wire, ingressBody: body },
  };
  return { request, requiredCapabilities: [...required] };
};
