import type { StreamEvent } from '@sentropic/llm-mesh';
import type { GatewayDispatchStreamEvent, GatewayWire } from './ports/dispatch.js';
import { frameAnthropicEvent, frameOpenAiChunk, OPENAI_DONE } from './wire.js';

const anthropicUsage = (usage: Extract<StreamEvent, { type: 'done' }>['data']['usage']) => ({
  input_tokens: usage?.inputTokens ?? 0,
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

export const encodeGatewayStream = (
  wire: GatewayWire,
  requestedModel: string,
  responseId: string,
  events: AsyncIterable<StreamEvent>,
): AsyncGenerator<GatewayDispatchStreamEvent, void, unknown> => wire === 'anthropic-messages'
  ? encodeAnthropicStream(requestedModel, responseId, events)
  : encodeOpenAiStream(requestedModel, responseId, events);

const encodeAnthropicStream = async function* (
  model: string,
  responseId: string,
  events: AsyncIterable<StreamEvent>,
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
      usage: { input_tokens: 0, output_tokens: 0 },
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
        usage: anthropicUsage(event.data.usage),
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
      function: { name: event.data.name, arguments: '' },
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
