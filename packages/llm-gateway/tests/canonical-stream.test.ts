import type { StreamEvent } from '@sentropic/llm-mesh';
import { describe, expect, it } from 'vitest';
import { encodeGatewayStream } from '../src/canonical-stream.js';
import { parseSse } from '../src/wire.js';

const source = async function* (): AsyncGenerator<StreamEvent> {
  yield { type: 'reasoning_delta', data: { delta: 'Think' } };
  yield { type: 'content_delta', data: { delta: 'Done.', index: 1 } };
  yield {
    type: 'tool_call_start',
    data: { toolCallId: 'call-1', providerCallId: 'provider-call-1', name: 'lookup', argumentsText: '' },
  };
  yield {
    type: 'tool_call_delta',
    data: { toolCallId: 'call-1', delta: '{"id":1}' },
  };
  yield {
    type: 'done',
    data: {
      finishReason: 'tool_calls',
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    },
  };
};

const collect = async (wire: 'anthropic-messages' | 'openai-chat-completions') => {
  let text = '';
  for await (const frame of encodeGatewayStream(wire, 'requested-model', 'response-1', source())) {
    text += frame.raw;
  }
  return parseSse(text);
};

describe('canonical gateway streams', () => {
  it('preserves Anthropic block boundaries and terminal ordering', async () => {
    const frames = await collect('anthropic-messages');

    expect(frames.map((frame) => frame.event)).toEqual([
      'message_start',
      'content_block_start', 'content_block_delta',
      'content_block_start', 'content_block_delta',
      'content_block_start', 'content_block_delta',
      'content_block_stop', 'content_block_stop', 'content_block_stop',
      'message_delta', 'message_stop',
    ]);
    expect(JSON.parse(frames[6]!.data)).toMatchObject({
      delta: { type: 'input_json_delta', partial_json: '{"id":1}' },
    });
    expect(JSON.parse(frames.at(-2)!.data)).toMatchObject({
      delta: { stop_reason: 'tool_calls' },
      usage: { input_tokens: 12, output_tokens: 7 },
    });
  });

  it('preserves OpenAI reasoning, tool deltas, usage and DONE', async () => {
    const frames = await collect('openai-chat-completions');
    const payloads = frames.slice(0, -1).map((frame) => JSON.parse(frame.data));

    expect(payloads[1]).toMatchObject({
      choices: [{ delta: { reasoning_content: 'Think' } }],
    });
    expect(payloads[4]).toMatchObject({
      choices: [{ delta: { tool_calls: [{ function: { arguments: '{"id":1}' } }] } }],
    });
    expect(payloads.at(-1)).toMatchObject({
      choices: [{ finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    });
    expect(frames.at(-1)?.data).toBe('[DONE]');
  });
});
