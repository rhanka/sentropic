/**
 * Responses egress (spec §16.5): shared item/usage/terminal builders for the
 * JSON envelope and the SSE encoder. No fabricated counts, no invented ids.
 */
import { describe, expect, it } from 'vitest';

import {
  buildResponsesJson,
  createResponsesAccumulator,
  DEFAULT_RESPONSES_LIMITS,
  functionCallItem,
  messageItem,
  reasoningItem,
  ResponsesBoundError,
  responsesTerminal,
  responsesUsage,
} from '../src/responses-egress.js';

describe('responses egress builders (spec §16.5)', () => {
  it('maps terminal reasons to completed/incomplete/failed without invention', () => {
    expect(responsesTerminal('stop')).toEqual({ status: 'completed', incomplete_details: null });
    expect(responsesTerminal('tool_calls')).toEqual({ status: 'completed', incomplete_details: null });
    expect(responsesTerminal('length')).toEqual({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    });
    expect(responsesTerminal('content_filter')).toEqual({
      status: 'incomplete', incomplete_details: { reason: 'content_filter' },
    });
    expect(responsesTerminal('error').status).toBe('failed');
    expect(responsesTerminal('cancelled').status).toBe('failed');
    expect(responsesTerminal('unknown').status).toBe('failed');
  });

  it('maps usage with native detail and computes totals from known components', () => {
    expect(responsesUsage(undefined)).toBeNull();
    expect(responsesUsage({})).toBeNull();
    expect(responsesUsage({
      inputTokens: 11, outputTokens: 7,
      providerRawUsage: {
        input_tokens: 11, output_tokens: 7, total_tokens: 18,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 },
      },
    })).toEqual({
      input_tokens: 11, output_tokens: 7, total_tokens: 18,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens_details: { reasoning_tokens: 2 },
    });
    expect(responsesUsage({ inputTokens: 5, outputTokens: 9 })).toMatchObject({
      input_tokens: 5, output_tokens: 9, total_tokens: 14,
    });
  });

  it('builds message items with annotated text parts and nothing else', () => {
    expect(messageItem('msg_0', 'hi')).toEqual({
      type: 'message', id: 'msg_0', role: 'assistant',
      content: [{ type: 'output_text', text: 'hi', annotations: [] }],
    });
  });

  it('keeps function_call id distinct from the echoed call_id', () => {
    expect(functionCallItem('fc_0', {
      toolCallId: 'item-1', providerCallId: 'call-1', name: 'lookup', argumentsText: '{"id":1}',
    })).toEqual({
      type: 'function_call', id: 'fc_0', call_id: 'call-1', name: 'lookup', arguments: '{"id":1}',
    });
  });

  it('builds reasoning items from completed summaries only', () => {
    expect(reasoningItem('rs_0', 'thought a bit')).toEqual({
      type: 'reasoning', id: 'rs_0', summary: [{ type: 'summary_text', text: 'thought a bit' }],
    });
  });

  it('freezes the §16.7 engineering-default bounds', () => {
    expect(DEFAULT_RESPONSES_LIMITS).toEqual({ maxOutputItems: 1024, maxAccumulatedBytes: 8_388_608 });
  });
});

describe('responses accumulator (spec §16.5)', () => {
  const done = (finishReason: 'stop' | 'tool_calls' | 'length', usage?: { inputTokens: number; outputTokens: number; totalTokens: number }) => ({
    type: 'done' as const,
    data: { finishReason, ...(usage ? { usage } : {}) },
  });

  it('assembles ordered items with stable ids across text, tools and reasoning', () => {
    const acc = createResponsesAccumulator();
    acc.observe({ type: 'content_delta', data: { delta: 'hi' } });
    acc.observe({ type: 'tool_call_start', data: {
      toolCallId: 'c1', providerCallId: 'call_1', name: 'get_time', argumentsText: '',
    } });
    acc.observe({ type: 'reasoning_delta', data: { delta: 'thinking', kind: 'summary' } });
    acc.observe({ type: 'tool_call_delta', data: { toolCallId: 'c1', delta: '{"x":1}' } });
    acc.observe(done('tool_calls', { inputTokens: 4, outputTokens: 2, totalTokens: 6 }));
    const snap = acc.snapshot();
    expect(snap.items.map((item) => [item.type, item.id])).toEqual([
      ['message', 'msg_0'], ['function_call', 'fc_0'], ['reasoning', 'rs_0'],
    ]);
    expect(snap.items[1]).toMatchObject({ call_id: 'call_1', arguments: '{"x":1}' });
    expect(snap.terminal).toMatchObject({ finishReason: 'tool_calls' });
    expect(snap.usage).toMatchObject({ inputTokens: 4, totalTokens: 6 });
  });

  it('lets completed snapshots win over fragments without duplication', () => {
    const acc = createResponsesAccumulator();
    acc.observe({ type: 'tool_call_start', data: {
      toolCallId: 'c1', providerCallId: 'call_1', name: 'lookup', argumentsText: '',
    } });
    acc.observe({ type: 'tool_call_delta', data: { toolCallId: 'c1', delta: '{"id":' } });
    acc.observe({ type: 'tool_call_start', data: {
      toolCallId: 'c1', providerCallId: 'call_1', name: 'lookup', argumentsText: '{"id":1}',
    } });
    expect(acc.snapshot().items).toEqual([expect.objectContaining({ arguments: '{"id":1}' })]);
  });

  it('lets summary completions win and never renders hidden text', () => {
    const acc = createResponsesAccumulator();
    acc.observe({ type: 'reasoning_delta', data: { delta: 'partial', kind: 'summary' } });
    acc.observe({ type: 'reasoning_delta', data: { delta: 'secret', kind: 'hidden' } });
    acc.observe({ type: 'reasoning_delta', data: { delta: 'full summary', kind: 'summary_done' } });
    expect(acc.snapshot().items).toEqual([expect.objectContaining({
      summary: [{ type: 'summary_text', text: 'full summary' }],
    })]);
  });

  it('fails deltas for unknown calls and overflowing output instead of truncating', () => {
    const acc = createResponsesAccumulator();
    expect(() => acc.observe({ type: 'tool_call_delta', data: { toolCallId: 'ghost', delta: 'x' } }))
      .toThrowError(ResponsesBoundError);
    const tiny = createResponsesAccumulator({ maxOutputItems: 1024, maxAccumulatedBytes: 8 });
    expect(() => tiny.observe({ type: 'content_delta', data: { delta: 'way too long' } }))
      .toThrowError(expect.objectContaining({ code: 'responses_overflow' }));
  });

  it('ingests one-shot JSON responses through the same buffers', () => {
    const acc = createResponsesAccumulator();
    acc.ingest({
      id: 'resp-1', providerId: 'openai', modelId: 'gpt-6.1-sol',
      message: { role: 'assistant', content: 'done' },
      text: 'done', toolCalls: [], finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
    });
    const snap = acc.snapshot();
    expect(snap.items).toEqual([messageItem('msg_0', 'done')]);
    expect(snap.terminal).toMatchObject({ finishReason: 'stop' });
  });
});

describe('responses JSON envelope (spec §16.5)', () => {
  const base = {
    responseId: 'resp_1', model: 'gpt-6.1-sol', createdAt: 1_700_000_000,
    response: {
      id: 'resp_1', providerId: 'openai' as const, modelId: 'gpt-6.1-sol',
      message: { role: 'assistant' as const, content: 'hi' },
      text: 'hi', toolCalls: [], finishReason: 'stop' as const,
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    },
  };

  it('emits the response envelope with ordered output and no fabricated counts', () => {
    expect(buildResponsesJson(base)).toEqual({
      id: 'resp_1', object: 'response', created_at: 1_700_000_000, model: 'gpt-6.1-sol',
      status: 'completed', error: null, incomplete_details: null,
      output: [messageItem('msg_0', 'hi')],
      usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      store: false,
    });
  });

  it('emits incomplete and failed terminals without choices or invented output', () => {
    const length = buildResponsesJson({ ...base, response: {
      ...base.response, message: { role: 'assistant', content: '' }, text: '', finishReason: 'length',
    } });
    expect(length).toMatchObject({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [],
    });
    const refused = buildResponsesJson({
      ...base, response: {
        ...base.response, message: { role: 'assistant', content: 'no' }, text: 'no',
        finishReason: 'content_filter',
      },
    });
    expect(refused).toMatchObject({
      status: 'incomplete', incomplete_details: { reason: 'content_filter' },
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
    });
    const failed = buildResponsesJson({
      ...base, response: {
        ...base.response, message: { role: 'assistant', content: '' }, text: '', finishReason: 'unknown',
      },
    });
    expect(failed).toMatchObject({ status: 'failed', output: [] });
    expect(failed).toHaveProperty('error');
  });

  it('reports null usage when nothing is known', () => {
    const body = buildResponsesJson({ ...base, response: { ...base.response, usage: undefined } });
    expect(body).toMatchObject({ usage: null });
  });
});
