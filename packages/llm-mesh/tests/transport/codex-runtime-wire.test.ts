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
      toolChoice: { type: 'tool', name: 'lookup' },
      parallelToolCalls: false,
      reasoning: { effort: 'xhigh' },
    });

    expect(prepared.body).toMatchObject({
      model: 'gpt-5.6-terra', stream: true, store: false,
      instructions: 'System instruction', reasoning: { effort: 'xhigh' },
      tool_choice: { type: 'function', name: 'lookup' }, parallel_tool_calls: false,
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

  it('omits the maximum output token cap (rejected by the Codex backend)', () => {
    const request = {
      providerId: 'openai' as const, modelId: 'gpt-5.6-terra' as const,
      messages: [{ role: 'user' as const, content: 'hello' }],
    };

    // Live-proven: chatgpt.com/backend-api/codex/responses answers 400
    // `Unsupported parameter: max_output_tokens`. The Codex wire must not
    // send it; other transports keep their own limit mapping. The cap is
    // NOT applied by Codex.
    expect(buildCodexRuntimeRequest({ ...request, maxOutputTokens: 321 }).body)
      .not.toHaveProperty('max_output_tokens');
    expect(buildCodexRuntimeRequest(request).body).not.toHaveProperty('max_output_tokens');
  });

  it('treats output_item.done function calls as authoritative argument snapshots', () => {
    expect(decodeCodexRuntimeEvent({
      type: 'response.output_item.done',
      item: {
        type: 'function_call', id: 'item-1', call_id: 'call-1',
        name: 'lookup', arguments: '{"id":1,"full":true}',
      },
    })).toEqual([{ type: 'tool_call_start', data: {
      toolCallId: 'item-1', providerCallId: 'call-1', name: 'lookup',
      argumentsText: '{"id":1,"full":true}',
    } }]);
  });

  it('deduplicates completed text snapshots (deltas already carried the text)', () => {
    expect(decodeCodexRuntimeEvent({
      type: 'response.output_text.done', item_id: 'msg-1', output_index: 0, text: 'hello',
    })).toEqual([]);
    expect(decodeCodexRuntimeEvent({
      type: 'response.output_item.done',
      item: {
        type: 'message', id: 'msg-1',
        content: [{ type: 'output_text', text: 'hello' }],
      },
    })).toEqual([]);
    expect(decodeCodexRuntimeEvent({
      type: 'response.output_item.done',
      item: {
        type: 'reasoning', id: 'rs-1',
        summary: [{ type: 'summary_text', text: 'thought a bit' }],
      },
    })).toEqual([]);
  });

  it('decodes incomplete terminals with usage instead of reporting success', () => {
    expect(decodeCodexRuntimeEvent({
      type: 'response.incomplete',
      response: {
        id: 'response-2', incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 9, output_tokens: 12, total_tokens: 21 },
      },
    })).toEqual([{ type: 'done', data: {
      finishReason: 'length', providerId: 'openai', providerResponseId: 'response-2',
      usage: {
        inputTokens: 9, outputTokens: 12, totalTokens: 21,
        providerRawUsage: { input_tokens: 9, output_tokens: 12, total_tokens: 21 },
      },
    } }]);
    const [filtered] = decodeCodexRuntimeEvent({
      type: 'response.incomplete',
      response: {
        id: 'response-3', incomplete_details: { reason: 'content_filter' },
        usage: { input_tokens: 9, output_tokens: 1, total_tokens: 10 },
      },
    });
    expect(filtered).toMatchObject({ type: 'done', data: { finishReason: 'content_filter' } });
  });

  it('decodes failure terminals as errors with the provider message', () => {
    expect(decodeCodexRuntimeEvent({
      type: 'response.failed',
      response: { id: 'response-4', error: { message: 'boom', code: 'server_error' } },
    })).toEqual([{ type: 'error', data: {
      providerId: 'openai', message: 'boom', code: 'server_error', retryable: false,
    } }]);
  });

  it('maps Codex SSE events to ordered canonical events', () => {
    expect(decodeCodexRuntimeEvent({
      type: 'response.output_text.delta', delta: 'hello',
    })).toEqual([{ type: 'content_delta', data: { delta: 'hello' } }]);
    expect(decodeCodexRuntimeEvent({
      type: 'response.output_item.added',
      item: {
        type: 'function_call', id: 'item-1', call_id: 'call-1',
        name: 'lookup', arguments: '',
      },
    })).toEqual([{ type: 'tool_call_start', data: {
      toolCallId: 'item-1', providerCallId: 'call-1', name: 'lookup', argumentsText: '',
    } }]);
    expect(decodeCodexRuntimeEvent({
      type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"id":',
    })).toEqual([{ type: 'tool_call_delta', data: {
      toolCallId: 'item-1', delta: '{"id":',
    } }]);
    expect(decodeCodexRuntimeEvent({
      type: 'response.completed',
      response: {
        id: 'response-1',
        output: [{ type: 'function_call', id: 'item-1', call_id: 'call-1' }],
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      },
    })).toEqual([{ type: 'done', data: {
      finishReason: 'tool_calls', providerId: 'openai', providerResponseId: 'response-1',
      usage: {
        inputTokens: 11, outputTokens: 7, totalTokens: 18,
        providerRawUsage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      },
    } }]);
  });
});
