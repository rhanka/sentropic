import type { GenerateRequest, MessageContent, StreamEvent } from '@sentropic/llm-mesh';
import type { GatewayDispatchStreamEvent, GatewayWire } from './ports/dispatch.js';
import { frameAnthropicEvent, frameOpenAiChunk, OPENAI_DONE } from './wire.js';

const anthropicOutputUsage = (
  usage: Extract<StreamEvent, { type: 'done' }>['data']['usage'],
) => ({
  output_tokens: usage?.outputTokens ?? 0,
});

const openAiUsage = (usage: Extract<StreamEvent, { type: 'done' }>['data']['usage']) => ({
  prompt_tokens: usage?.inputTokens ?? 0,
  completion_tokens: usage?.outputTokens ?? 0,
  total_tokens: usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
});

const openAiStopReason = (reason: Extract<StreamEvent, { type: 'done' }>['data']['finishReason']) =>
  reason === 'tool_calls' ? 'tool_calls' : reason === 'length' ? 'length' : 'stop';

const anthropicStopReason = (reason: Extract<StreamEvent, { type: 'done' }>['data']['finishReason']) =>
  reason === 'tool_calls' ? 'tool_use'
    : reason === 'length' ? 'max_tokens'
      : reason === 'content_filter' ? 'refusal'
        : 'end_turn';

const raw = (value: string): GatewayDispatchStreamEvent => ({ raw: value });

const projectValue = (value: unknown, key = ''): unknown => {
  if (typeof value === 'string') {
    if (/^(data|base64|blob|bytes)$/i.test(key) || value.startsWith('data:')) return '[binary]';
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => projectValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) =>
      [entryKey, projectValue(entryValue, entryKey)]),
  );
  return value;
};

const projectContent = (content: MessageContent) => typeof content === 'string'
  ? content
  : content.map((part) => part.type === 'text'
    ? { type: part.type, text: part.text }
    : part.type === 'reasoning'
      ? {
        type: part.type, text: part.text,
        ...(part.signature ? { signature: '[signature]' } : {}),
        ...(part.redacted ? { redacted: true } : {}),
      }
      : {
        type: part.type,
        ...(part.mediaType ? { mediaType: part.mediaType } : {}),
        ...(part.url ? { url: projectValue(part.url) } : {}),
        ...(part.type === 'file' && part.filename ? { filename: part.filename } : {}),
        ...(part.data ? { data: '[binary]' } : {}),
      });

export const estimateAnthropicInputTokens = (request: GenerateRequest): number => {
  const messages = request.messages.map((message) => ({
    role: message.role,
    content: projectContent(message.content),
    ...('toolCalls' in message && message.toolCalls ? {
      toolCalls: message.toolCalls.map((call) => ({
        name: call.name,
        arguments: projectValue(call.arguments ?? call.argumentsText),
      })),
    } : {}),
    ...('toolResult' in message ? {
      toolResult: {
        name: message.toolResult.name,
        content: message.toolResult.content?.map((part) => projectValue(part)),
        ...(!message.toolResult.content
          ? { output: projectValue(message.toolResult.output) }
          : {}),
      },
    } : {}),
  }));
  const tools = request.tools?.map((tool) => ({
    type: tool.type, name: tool.name, description: tool.description,
    inputSchema: projectValue(tool.inputSchema),
  }));
  const bytes = new TextEncoder().encode(JSON.stringify({ messages, tools })).byteLength;
  return Math.max(1, Math.ceil(bytes / 4));
};

export interface GatewayStreamUsageHints {
  readonly anthropicInputTokens?: number;
}

export const encodeGatewayStream = (
  wire: GatewayWire,
  requestedModel: string,
  responseId: string,
  events: AsyncIterable<StreamEvent>,
  usageHints?: GatewayStreamUsageHints,
): AsyncGenerator<GatewayDispatchStreamEvent, void, unknown> => wire === 'anthropic-messages'
  ? encodeAnthropicStream(
    requestedModel, responseId, events,
    Math.max(0, Math.floor(usageHints?.anthropicInputTokens ?? 0)),
  )
  : encodeOpenAiStream(requestedModel, responseId, events);

const encodeAnthropicStream = async function* (
  model: string,
  responseId: string,
  events: AsyncIterable<StreamEvent>,
  inputTokens: number,
): AsyncGenerator<GatewayDispatchStreamEvent> {
  const opened: number[] = [];
  const textIndexes = new Map<number, number>();
  const toolIndexes = new Map<string, number>();
  let reasoningIndex: number | undefined;
  let activeToolIndex: number | undefined;
  let nextIndex = 0;
  yield raw(frameAnthropicEvent('message_start', {
    type: 'message_start', message: {
      id: responseId, type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  }));
  for await (const event of events) {
    if (event.type === 'content_delta' || event.type === 'reasoning_delta') {
      const sourceIndex = event.type === 'content_delta' ? event.data.index ?? 0 : 0;
      let index = event.type === 'reasoning_delta'
        ? reasoningIndex
        : textIndexes.get(sourceIndex);
      if (index === undefined) {
        index = nextIndex;
        nextIndex += 1;
        opened.push(index);
        if (event.type === 'reasoning_delta') reasoningIndex = index;
        else textIndexes.set(sourceIndex, index);
        yield raw(frameAnthropicEvent('content_block_start', {
          type: 'content_block_start', index,
          content_block: event.type === 'content_delta'
            ? { type: 'text', text: '' }
            : { type: 'thinking', thinking: '' },
        }));
      }
      yield raw(frameAnthropicEvent('content_block_delta', {
        type: 'content_block_delta', index,
        delta: event.type === 'content_delta'
          ? { type: 'text_delta', text: event.data.delta }
          : { type: 'thinking_delta', thinking: event.data.delta },
      }));
    } else if (event.type === 'tool_call_start') {
      const thoughtSignature = typeof event.data.metadata?.thoughtSignature === 'string'
        ? event.data.metadata.thoughtSignature
        : undefined;
      if (thoughtSignature) {
        const signatureIndex = nextIndex;
        nextIndex += 1;
        yield raw(frameAnthropicEvent('content_block_start', {
          type: 'content_block_start', index: signatureIndex,
          content_block: { type: 'thinking', thinking: '' },
        }));
        yield raw(frameAnthropicEvent('content_block_delta', {
          type: 'content_block_delta', index: signatureIndex,
          delta: { type: 'signature_delta', signature: thoughtSignature },
        }));
        yield raw(frameAnthropicEvent('content_block_stop', {
          type: 'content_block_stop', index: signatureIndex,
        }));
      }
      const index = nextIndex;
      nextIndex += 1;
      opened.push(index);
      toolIndexes.set(event.data.toolCallId, index);
      activeToolIndex = index;
      yield raw(frameAnthropicEvent('content_block_start', {
        type: 'content_block_start', index,
        content_block: {
          type: 'tool_use', id: event.data.providerCallId ?? event.data.toolCallId,
          name: event.data.name, input: {},
        },
      }));
      if (event.data.argumentsText) {
        yield raw(frameAnthropicEvent('content_block_delta', {
          type: 'content_block_delta', index,
          delta: { type: 'input_json_delta', partial_json: event.data.argumentsText },
        }));
      }
    } else if (event.type === 'tool_call_delta') {
      const index = toolIndexes.get(event.data.toolCallId) ?? activeToolIndex ?? 0;
      yield raw(frameAnthropicEvent('content_block_delta', {
        type: 'content_block_delta', index,
        delta: { type: 'input_json_delta', partial_json: event.data.delta },
      }));
    } else if (event.type === 'error') {
      yield raw(frameAnthropicEvent('error', {
        type: 'error', error: { type: 'api_error', message: event.data.message },
      }));
    } else if (event.type === 'done') {
      for (const index of opened) {
        yield raw(frameAnthropicEvent('content_block_stop', { type: 'content_block_stop', index }));
      }
      yield raw(frameAnthropicEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: anthropicStopReason(event.data.finishReason), stop_sequence: null },
        usage: anthropicOutputUsage(event.data.usage),
      }));
      yield raw(frameAnthropicEvent('message_stop', { type: 'message_stop' }));
    }
  }
};

const encodeOpenAiStream = async function* (
  model: string,
  responseId: string,
  events: AsyncIterable<StreamEvent>,
): AsyncGenerator<GatewayDispatchStreamEvent> {
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null, usage?: unknown) =>
    raw(frameOpenAiChunk({
      id: responseId, object: 'chat.completion.chunk', model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    }));
  yield chunk({ role: 'assistant', content: '' });
  for await (const event of events) {
    if (event.type === 'content_delta') yield chunk({ content: event.data.delta });
    else if (event.type === 'reasoning_delta') yield chunk({ reasoning_content: event.data.delta });
    else if (event.type === 'tool_call_start') yield chunk({ tool_calls: [{
      index: 0, id: event.data.providerCallId ?? event.data.toolCallId, type: 'function',
      function: { name: event.data.name, arguments: event.data.argumentsText },
    }] });
    else if (event.type === 'tool_call_delta') yield chunk({ tool_calls: [{
      index: 0, function: { arguments: event.data.delta },
    }] });
    else if (event.type === 'error') yield raw(frameOpenAiChunk({
      error: { message: event.data.message, type: 'server_error', code: event.data.code },
    }));
    else if (event.type === 'done') {
      yield chunk({}, openAiStopReason(event.data.finishReason), openAiUsage(event.data.usage));
      yield raw(OPENAI_DONE);
    }
  }
};
