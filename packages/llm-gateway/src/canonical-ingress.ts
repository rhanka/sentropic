import type {
  CapabilityRequirement, GenerateRequest, LlmMeshMessage, MessageContent, ToolDefinition,
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
  const parts: Exclude<MessageContent, string>[number][] = [];
  for (const part of records(content)) {
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
  return parts.length > 0 ? parts : JSON.stringify(content ?? '');
};

const toolCalls = (message: JsonRecord) => records(message.tool_calls).map((call) => {
  const fn = asRecord(call.function);
  return {
    toolCallId: String(call.id ?? ''),
    providerCallId: String(call.id ?? ''),
    name: String(fn?.name ?? ''),
    argumentsText: typeof fn?.arguments === 'string' ? fn.arguments : JSON.stringify(fn?.arguments ?? {}),
  };
});

const normalizeMessage = (message: JsonRecord): LlmMeshMessage => {
  const role = typeof message.role === 'string' ? message.role : 'user';
  if (role === 'tool') {
    const toolCallId = String(message.tool_call_id ?? '');
    return {
      role: 'tool', content: contentParts(message.content),
      toolResult: { toolCallId, providerCallId: toolCallId, output: message.content },
      metadata: { ingress: message },
    };
  }
  if (role === 'assistant') {
    const calls = toolCalls(message);
    return {
      role, content: contentParts(message.content),
      ...(calls.length > 0 ? { toolCalls: calls } : {}), metadata: { ingress: message },
    };
  }
  return {
    role: role === 'system' || role === 'developer' ? role : 'user',
    content: contentParts(message.content), metadata: { ingress: message },
  };
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
  const messages = records(raw.messages).map(normalizeMessage);
  if (wire === 'anthropic-messages' && raw.system !== undefined) {
    messages.unshift({ role: 'system', content: contentParts(raw.system) });
  }
  const tools = normalizeTools(raw.tools);
  const serialized = JSON.stringify(body);
  const required = new Set<CapabilityRequirement>();
  if (tools.length > 0) required.add('tools');
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
