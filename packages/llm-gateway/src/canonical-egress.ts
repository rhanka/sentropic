import type { GenerateResponse, TokenUsage } from '@sentropic/llm-mesh';
import type { GatewayWire, ProviderResponseHeaders } from './ports/dispatch.js';

export interface CanonicalGatewayResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: ProviderResponseHeaders;
}

const usageFor = (wire: GatewayWire, usage?: TokenUsage): Record<string, number> | undefined => {
  if (!usage) return undefined;
  if (wire === 'anthropic-messages') {
    return { input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0 };
  }
  return {
    prompt_tokens: usage.inputTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    ...(usage.reasoningTokens !== undefined ? { reasoning_tokens: usage.reasoningTokens } : {}),
  };
};

const safeHeaders = (metadata?: Record<string, unknown>): ProviderResponseHeaders | undefined => {
  const value = metadata?.responseHeaders;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string'));
};

const anthropicStopReason = (reason: GenerateResponse['finishReason']): string | null => ({
  stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use',
  content_filter: 'refusal', error: 'error', cancelled: 'error', unknown: null,
})[reason];

const openAiFinishReason = (reason: GenerateResponse['finishReason']): string | null => ({
  stop: 'stop', length: 'length', tool_calls: 'tool_calls',
  content_filter: 'content_filter', error: 'stop', cancelled: 'stop', unknown: null,
})[reason];

export const encodeGatewayResponse = (
  wire: GatewayWire,
  response: GenerateResponse,
): CanonicalGatewayResponse => {
  const headers = safeHeaders(response.providerMetadata);
  if (wire === 'anthropic-messages') {
    const content: unknown[] = response.text ? [{ type: 'text', text: response.text }] : [];
    response.toolCalls.forEach((call) => content.push({
      type: 'tool_use', id: call.providerCallId ?? call.toolCallId, name: call.name,
      input: call.arguments ?? (() => {
        try { return JSON.parse(call.argumentsText); } catch { return call.argumentsText; }
      })(),
    }));
    return {
      status: 200,
      body: {
        id: response.id, type: 'message', role: 'assistant', model: response.modelId,
        content, stop_reason: anthropicStopReason(response.finishReason), stop_sequence: null,
        ...(usageFor(wire, response.usage) ? { usage: usageFor(wire, response.usage) } : {}),
      },
      ...(headers ? { headers } : {}),
    };
  }
  const toolCalls = response.toolCalls.map((call) => ({
    id: call.providerCallId ?? call.toolCallId, type: 'function',
    function: { name: call.name, arguments: call.argumentsText },
  }));
  return {
    status: 200,
    body: {
      id: response.id, object: 'chat.completion', model: response.modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant', content: response.text,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: openAiFinishReason(response.finishReason),
      }],
      ...(usageFor(wire, response.usage) ? { usage: usageFor(wire, response.usage) } : {}),
    },
    ...(headers ? { headers } : {}),
  };
};
