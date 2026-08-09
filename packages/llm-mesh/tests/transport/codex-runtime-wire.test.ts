import { describe, expect, it } from 'vitest';
import {
  buildCodexRuntimeRequest, decodeCodexRuntimeEvent,
} from '../../src/transport/codex-runtime-wire.js';

describe('Codex runtime wire', () => {
  it('preserves instructions, images, tools and tool results', () => {
    const prepared = buildCodexRuntimeRequest({
      providerId: 'openai', modelId: 'gpt-5.6-terra',
      messages: [
        { role: 'system', content: 'System instruction' },
        {
          role: 'user', content: [
            { type: 'text', text: 'Inspect' },
            { type: 'image', mediaType: 'image/png', data: 'AA==' },
          ],
        },
        {
          role: 'assistant', content: '',
          toolCalls: [{
            toolCallId: 'call-1', providerCallId: 'provider-call-1',
            name: 'lookup', argumentsText: '{"id":1}',
          }],
        },
        {
          role: 'tool', content: '{"value":42}',
          toolResult: {
            toolCallId: 'call-1', providerCallId: 'provider-call-1', output: { value: 42 },
          },
        },
      ],
      tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
      reasoning: { effort: 'xhigh' },
    });

    expect(prepared.body).toMatchObject({
      model: 'gpt-5.6-terra', stream: true, store: false,
      instructions: 'System instruction', reasoning: { effort: 'xhigh' },
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
      input: [
        { type: 'message', role: 'user', content: [
          { type: 'input_text', text: 'Inspect' },
          { type: 'input_image', image_url: 'data:image/png;base64,AA==' },
        ] },
        { type: 'message', role: 'assistant' },
        {
          type: 'function_call', call_id: 'provider-call-1',
          name: 'lookup', arguments: '{"id":1}',
        },
        {
          type: 'function_call_output', call_id: 'provider-call-1', output: '{"value":42}',
        },
      ],
    });
  });

  it('maps Codex SSE events to ordered canonical events', () => {
    expect(decodeCodexRuntimeEvent({
      type: 'response.output_text.delta', delta: 'hello',
    })).toEqual([{ type: 'content_delta', data: { delta: 'hello' } }]);
    expect(decodeCodexRuntimeEvent({
      type: 'response.output_item.added',
      item: { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '' },
    })).toEqual([{ type: 'tool_call_start', data: {
      toolCallId: 'call-1', providerCallId: 'call-1', name: 'lookup', argumentsText: '',
    } }]);
    expect(decodeCodexRuntimeEvent({
      type: 'response.completed',
      response: {
        id: 'response-1',
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      },
    })).toEqual([{ type: 'done', data: {
      finishReason: 'stop', providerId: 'openai', providerResponseId: 'response-1',
      usage: {
        inputTokens: 11, outputTokens: 7, totalTokens: 18,
        providerRawUsage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      },
    } }]);
  });
});
