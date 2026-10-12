/**
 * Responses egress (spec §16.5): shared item/usage/terminal builders for the
 * JSON envelope and the SSE encoder. No fabricated counts, no invented ids.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESPONSES_LIMITS,
  functionCallItem,
  messageItem,
  reasoningItem,
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
