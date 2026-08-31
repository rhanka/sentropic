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
  for await (const frame of encodeGatewayStream(
    wire, 'requested-model', 'response-1', source(), { anthropicInputTokens: 11 },
  )) {
    text += frame.raw;
  }
  return parseSse(text);
};

const sourceWithCompleteArgumentsAtStart = async function* (): AsyncGenerator<StreamEvent> {
  yield {
    type: 'tool_call_start',
    data: {
      toolCallId: 'call-cloud', providerCallId: 'provider-cloud', name: 'Bash',
      argumentsText: '{"command":"pwd"}', arguments: { command: 'pwd' },
      metadata: { thoughtSignature: 'cloud-signature' },
    },
  };
  yield {
    type: 'done',
    data: { finishReason: 'tool_calls' },
  };
};

const collectCompleteArguments = async (
  wire: 'anthropic-messages' | 'openai-chat-completions',
) => {
  let text = '';
  for await (const frame of encodeGatewayStream(
    wire, 'gemini-3.1-flash-lite', 'response-cloud', sourceWithCompleteArgumentsAtStart(),
  )) text += frame.raw;
  return parseSse(text);
};

describe('canonical gateway streams', () => {
  it('consumes one canonical source without a shadow replay', async () => {
    let starts = 0;
    const once = async function* (): AsyncGenerator<StreamEvent> {
      starts += 1;
      yield { type: 'content_delta', data: { delta: 'one' } };
      yield { type: 'done', data: { finishReason: 'stop' } };
    };
    let output = '';
    for await (const frame of encodeGatewayStream(
      'openai-chat-completions', 'gpt-5.6-terra', 'response-once', once(),
    )) output += frame.raw;

    expect(starts).toBe(1);
    expect(output).toContain('data: [DONE]');
  });

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
    expect(JSON.parse(frames[0]!.data)).toMatchObject({
      message: { usage: { input_tokens: 11, output_tokens: 0 } },
    });
    expect(JSON.parse(frames.at(-2)!.data)).toMatchObject({
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 7 },
    });
    expect(JSON.parse(frames.at(-2)!.data).usage).not.toHaveProperty('input_tokens');
    const reasoning = JSON.parse(frames[1]!.data);
    const text = JSON.parse(frames[3]!.data);
    expect(reasoning).toMatchObject({ index: 0, content_block: { type: 'thinking' } });
    expect(text).toMatchObject({ index: 1, content_block: { type: 'text' } });
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

  it('forwards complete Cloud Code arguments carried by tool_call_start', async () => {
    const anthropic = await collectCompleteArguments('anthropic-messages');
    expect(anthropic.map((frame) => JSON.parse(frame.data)).find((payload) =>
      payload.delta?.type === 'signature_delta')).toMatchObject({
      delta: { type: 'signature_delta', signature: 'cloud-signature' },
    });
    expect(anthropic.map((frame) => JSON.parse(frame.data)).find((payload) =>
      payload.delta?.type === 'input_json_delta')).toMatchObject({
      delta: { type: 'input_json_delta', partial_json: '{"command":"pwd"}' },
    });

    const openai = await collectCompleteArguments('openai-chat-completions');
    expect(JSON.parse(openai[1]!.data)).toMatchObject({
      choices: [{ delta: { tool_calls: [{
        function: { name: 'Bash', arguments: '{"command":"pwd"}' },
      }] } }],
    });
  });
});
