/**
 * Responses SSE lifecycle (spec §16.5): ordered frames with monotonic
 * sequence numbers, stable ids/indices, exactly one terminal, no Chat
 * `[DONE]`. Frames are parsed back from `raw` event/data framings.
 */
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sentropic/llm-mesh';

import { encodeResponsesStream } from '../src/responses-stream.js';
import type { ResponsesLimits } from '../src/responses-egress.js';
import { DEFAULT_RESPONSES_LIMITS } from '../src/responses-egress.js';

const text = (delta: string): StreamEvent => ({ type: 'content_delta', data: { delta } });
const done = (finishReason: 'stop' | 'tool_calls' | 'length', usage?: Record<string, number>): StreamEvent => ({
  type: 'done',
  data: { finishReason,
    ...(usage ? { usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens } } : {}) },
});

async function* feed(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) yield event;
}

const collect = async (events: StreamEvent[], limits?: ResponsesLimits) => {
  const frames: Array<{ event: string; data: Record<string, unknown>; raw: string }> = [];
  const gen = encodeResponsesStream({
    responseId: 'resp_1', model: 'gpt-6.1-sol', createdAt: 1_700_000_000, events: feed(events),
    ...(limits ? { limits } : {}),
  });
  for await (const frame of gen) {
    const lines = frame.raw.split('\n');
    const event = lines.find((line) => line.startsWith('event:'))!.slice(6).trim();
    const data = JSON.parse(lines.find((line) => line.startsWith('data:'))!.slice(5).trim());
    frames.push({ event, data, raw: frame.raw });
  }
  return frames;
};

describe('responses SSE lifecycle (spec §16.5)', () => {
  it('streams an ordered text turn with monotonic sequence numbers', async () => {
    const frames = await collect([text('hi'), text(' there'), done('stop',
      { input_tokens: 4, output_tokens: 2, total_tokens: 6 })]);
    expect(frames.map((frame) => frame.event)).toEqual([
      'response.created', 'response.in_progress',
      'response.output_item.added', 'response.content_part.added', 'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done', 'response.content_part.done', 'response.output_item.done',
      'response.completed',
    ]);
    expect(frames.map((frame) => frame.data.sequence_number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const added = frames[2]!.data as Record<string, unknown>;
    expect(added).toMatchObject({ output_index: 0 });
    const item = (added.item ?? {}) as Record<string, unknown>;
    const delta = frames[4]!.data as Record<string, unknown>;
    expect(delta).toMatchObject({ item_id: item.id, output_index: 0, content_index: 0, delta: 'hi' });
    const completed = frames[9]!.data as Record<string, unknown>;
    expect(completed).toMatchObject({
      type: 'response.completed',
      response: { id: 'resp_1', status: 'completed', usage: { total_tokens: 6 } },
    });
    expect(frames.every((frame) => !frame.raw.includes('[DONE]'))).toBe(true);
  });

  it('streams tool calls with distinct item ids and final arguments', async () => {
    const frames = await collect([
      { type: 'tool_call_start', data: { toolCallId: 'c1', providerCallId: 'call_1', name: 'get_time', argumentsText: '' } },
      { type: 'tool_call_delta', data: { toolCallId: 'c1', delta: '{"x":1}' } },
      done('tool_calls', { input_tokens: 4, output_tokens: 2, total_tokens: 6 }),
    ]);
    const added = frames.find((frame) => frame.event === 'response.output_item.added')!.data;
    expect(added).toMatchObject({
      output_index: 0,
      item: { id: 'fc_0', type: 'function_call', call_id: 'call_1', name: 'get_time' },
    });
    const argDelta = frames.find((frame) => frame.event === 'response.function_call_arguments.delta')!.data;
    expect(argDelta).toMatchObject({ item_id: 'fc_0', delta: '{"x":1}' });
    const argDone = frames.find((frame) => frame.event === 'response.function_call_arguments.done')!.data;
    expect(argDone).toMatchObject({ item_id: 'fc_0', arguments: '{"x":1}' });
    const itemDone = frames.find((frame) => frame.event === 'response.output_item.done')!.data;
    expect(itemDone).toMatchObject({
      item: { id: 'fc_0', call_id: 'call_1', arguments: '{"x":1}' },
    });
  });

  it('skips incremental deltas for replaced snapshots and keeps final arguments', async () => {
    const frames = await collect([
      { type: 'tool_call_start', data: { toolCallId: 'c1', providerCallId: 'call_1', name: 'lookup', argumentsText: '' } },
      { type: 'tool_call_delta', data: { toolCallId: 'c1', delta: '{"id":' } },
      { type: 'tool_call_start', data: { toolCallId: 'c1', providerCallId: 'call_1', name: 'lookup', argumentsText: '{"id":1}' } },
      done('tool_calls'),
    ]);
    const deltas = frames.filter((frame) => frame.event === 'response.function_call_arguments.delta');
    expect(deltas).toHaveLength(1);
    const itemDone = frames.find((frame) => frame.event === 'response.output_item.done')!.data;
    expect(itemDone).toMatchObject({ item: { arguments: '{"id":1}' } });
  });

  it('closes with incomplete on length and keeps usage', async () => {
    const frames = await collect([text('cut'), done('length',
      { input_tokens: 4, output_tokens: 12, total_tokens: 16 })]);
    const terminal = frames[frames.length - 1]!;
    expect(terminal.event).toBe('response.incomplete');
    expect(terminal.data).toMatchObject({
      response: {
        status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
        usage: { total_tokens: 16 },
      },
    });
  });

  it('fails exactly once on provider errors with partial output', async () => {
    const frames = await collect([text('part'), { type: 'error', data: {
      providerId: 'openai', message: 'boom', code: 'server_error', retryable: false,
    } }]);
    const terminal = frames[frames.length - 1]!;
    expect(terminal.event).toBe('response.failed');
    expect(terminal.data).toMatchObject({
      response: { status: 'failed', error: { message: 'boom' } },
    });
    expect(frames.filter((frame) => frame.event === 'response.failed')).toHaveLength(1);
  });

  it('fails neutrally on an over-cap event without truncating', async () => {
    const frames = await collect([text('way too long for the cap')],
      { ...DEFAULT_RESPONSES_LIMITS, maxSseEventBytes: 8 });
    const terminal = frames[frames.length - 1]!;
    expect(terminal.event).toBe('response.failed');
    expect(terminal.data).toMatchObject({
      response: { status: 'failed', error: expect.objectContaining({ code: 'responses_overflow' }) },
    });
    expect(frames.filter((frame) => frame.event === 'response.failed')).toHaveLength(1);
  });

  it('fails premature EOF instead of completing empty output', async () => {
    const frames = await collect([text('part')]);
    const terminal = frames[frames.length - 1]!;
    expect(terminal.event).toBe('response.failed');
    expect(terminal.data).toMatchObject({
      response: { error: expect.objectContaining({ code: 'premature_eof' }) },
    });
  });

  it('completes a legitimate empty terminal without inventing output', async () => {
    const frames = await collect([done('stop')]);
    expect(frames.map((frame) => frame.event)).toEqual([
      'response.created', 'response.in_progress', 'response.completed',
    ]);
    expect(frames[2]!.data).toMatchObject({ response: { status: 'completed', output: [] } });
  });

  it('streams reasoning summaries and never renders hidden text', async () => {
    const frames = await collect([
      { type: 'reasoning_delta', data: { delta: 'hmm', kind: 'summary' } },
      { type: 'reasoning_delta', data: { delta: 'secret', kind: 'hidden' } },
      done('stop'),
    ]);
    expect(frames.map((frame) => frame.event)).toContain('response.reasoning_summary_text.delta');
    expect(JSON.stringify(frames)).not.toContain('secret');
    const events = frames.map((frame) => frame.event);
    expect(events.indexOf('response.reasoning_summary_text.done')).toBeGreaterThan(
      events.indexOf('response.reasoning_summary_text.delta'));
    expect(events.indexOf('response.reasoning_summary_part.done')).toBeGreaterThan(
      events.indexOf('response.reasoning_summary_text.done'));
    const textDone = frames.find((frame) => frame.event === 'response.reasoning_summary_text.done')!.data;
    expect(textDone).toMatchObject({ text: 'hmm' });
    const itemDone = frames.find((frame) => frame.event === 'response.output_item.done')!.data;
    expect(itemDone).toMatchObject({ item: { type: 'reasoning' } });
  });

  it('announces response.created with the full initial snapshot (R4-MIN-5)', async () => {
    const frames = await collect([text('hi'), done('stop')]);
    const created = frames.find((frame) => frame.event === 'response.created')!.data;
    expect(created).toMatchObject({
      response: { id: 'resp_1', object: 'response', model: 'gpt-6.1-sol',
        status: 'in_progress', created_at: 1_700_000_000, output: [] },
    });
  });
});
