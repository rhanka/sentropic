import { describe, expect, it, vi } from 'vitest';
import { StreamHistory } from '../src/client/streamHistory.js';
import type { StreamHubEvent } from '../src/client/streamTypes.js';
import {
  appendLiveProjectionEvent,
  mergeProjectionHistoryEvents,
  projectAssistantRunSegments,
  type ProjectionStreamEvent,
} from '../src/utils/chat-run-projection.js';

const contentDelta = (
  sequence: number,
  delta: string,
): StreamHubEvent => ({
  type: 'content_delta',
  streamId: 'stream-large',
  sequence,
  data: { delta },
});

describe('stream throughput history guards', () => {
  it('aggregates a long ordered content stream into one replay event', () => {
    const history = new StreamHistory({ maxEventsPerStream: 20 });
    for (let sequence = 1; sequence <= 2000; sequence += 1) {
      history.record(contentDelta(sequence, 'x'));
    }

    const onEvent = vi.fn();
    history.replayStream('stream-large', onEvent);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({
      type: 'content_delta',
      streamId: 'stream-large',
      sequence: 2000,
      data: { delta: 'x'.repeat(2000) },
    });
  });

  it('dedupes repeated content sequences after reconnect replay', () => {
    const history = new StreamHistory({ maxEventsPerStream: 20 });
    history.record(contentDelta(1, 'a'));
    history.record(contentDelta(2, 'b'));
    history.record(contentDelta(2, 'b'));
    history.record(contentDelta(1, 'a'));
    history.record(contentDelta(3, 'c'));

    const onEvent = vi.fn();
    history.replayStream('stream-large', onEvent);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0][0]).toEqual({
      type: 'content_delta',
      streamId: 'stream-large',
      sequence: 3,
      data: { delta: 'abc' },
    });
  });

  it('keeps a terminal event after the aggregated content flush', () => {
    const history = new StreamHistory({ maxEventsPerStream: 20 });
    history.record(contentDelta(1, 'hel'));
    history.record(contentDelta(2, 'lo'));
    history.record({
      type: 'done',
      streamId: 'stream-large',
      sequence: 3,
      data: {},
    });

    const onEvent = vi.fn();
    history.replayStream('stream-large', onEvent);

    expect(onEvent.mock.calls.map((call) => call[0])).toEqual([
      {
        type: 'content_delta',
        streamId: 'stream-large',
        sequence: 2,
        data: { delta: 'hello' },
      },
      {
        type: 'done',
        streamId: 'stream-large',
        sequence: 3,
        data: {},
      },
    ]);
  });

  it('bounds repetitive context-budget status churn while keeping final transcript and done', () => {
    let events: ProjectionStreamEvent[] = [];
    for (let sequence = 1; sequence <= 250; sequence += 1) {
      events = appendLiveProjectionEvent(events, {
        eventType: 'status',
        sequence,
        data: { state: 'context_budget_update', occupancy_pct: sequence % 101 },
      });
    }
    events = appendLiveProjectionEvent(events, {
      eventType: 'content_delta',
      sequence: 251,
      data: { delta: 'Final answer.' },
    });
    events = appendLiveProjectionEvent(events, {
      eventType: 'done',
      sequence: 252,
      data: {},
    });

    expect(events.length).toBeLessThan(252);
    expect(events.length).toBeLessThanOrEqual(200);
    expect(events.length).toBeGreaterThan(100);
    expect(events.at(-1)?.eventType).toBe('done');

    const segments = projectAssistantRunSegments(events);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      kind: 'runtime',
      events: expect.arrayContaining([expect.objectContaining({ eventType: 'status' })]),
    });
    expect(segments[1]).toMatchObject({
      kind: 'assistant',
      content: 'Final answer.',
    });
  });

  it('merges adjacent content and reasoning deltas without losing transcript text', () => {
    let events: ProjectionStreamEvent[] = [];
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      events = appendLiveProjectionEvent(events, {
        eventType: 'content_delta',
        sequence,
        data: { delta: 'x' },
      });
    }
    for (let sequence = 301; sequence <= 450; sequence += 1) {
      events = appendLiveProjectionEvent(events, {
        eventType: 'reasoning_delta',
        sequence,
        data: { delta: 'r' },
      });
    }
    events = appendLiveProjectionEvent(events, {
      eventType: 'done',
      sequence: 451,
      data: {},
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      eventType: 'content_delta',
      sequence: 300,
      data: { delta: 'x'.repeat(300) },
    });
    expect(events[1]).toEqual({
      eventType: 'reasoning_delta',
      sequence: 450,
      data: { delta: 'r'.repeat(150) },
    });
    expect(events[2]).toEqual({
      eventType: 'done',
      sequence: 451,
      data: {},
    });

    const segments = projectAssistantRunSegments(events);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual(
      expect.objectContaining({
        kind: 'assistant',
        content: 'x'.repeat(300),
      }),
    );
  });

  it('keeps long repetitive tool-call failures bounded while preserving terminal error visibility', () => {
    let events: ProjectionStreamEvent[] = [];
    for (let loopIndex = 0; loopIndex < 120; loopIndex += 1) {
      const sequenceBase = loopIndex * 2 + 1;
      events = appendLiveProjectionEvent(events, {
        eventType: 'tool_call_start',
        sequence: sequenceBase,
        data: { tool_call_id: `loop_${loopIndex}`, name: 'echo_tool' },
      });
      events = appendLiveProjectionEvent(events, {
        eventType: 'tool_call_result',
        sequence: sequenceBase + 1,
        data: {
          tool_call_id: `loop_${loopIndex}`,
          result: { status: 'error', error: 'retry with same signature' },
        },
      });
    }

    events = appendLiveProjectionEvent(events, {
      eventType: 'error',
      sequence: 241,
      data: { message: 'Assistant-facing terminal error' },
    });

    expect(events.length).toBeLessThan(242);
    expect(events.length).toBeLessThanOrEqual(200);
    expect(events.at(-1)?.eventType).toBe('error');
    expect(events.at(-1)).toEqual({
      eventType: 'error',
      sequence: 241,
      data: { message: 'Assistant-facing terminal error' },
    });
    expect(
      events.filter((event) => event.eventType === 'tool_call_result').length,
    ).toBeGreaterThan(0);

    const segments = projectAssistantRunSegments(events);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual(
      expect.objectContaining({
        kind: 'runtime',
        events: expect.arrayContaining([
          expect.objectContaining({ eventType: 'tool_call_result' }),
          expect.objectContaining({ eventType: 'error' }),
        ]),
      }),
    );
  });

  it('compacts merged projection history for repeated status churn', () => {
    const current: ProjectionStreamEvent[] = [];
    const incoming = [] as ProjectionStreamEvent[];
    for (let sequence = 1; sequence <= 250; sequence += 1) {
      incoming.push({
        eventType: 'status',
        sequence,
        data: { state: 'context_budget_update', occupancy_pct: sequence },
      });
    }

    const merged = mergeProjectionHistoryEvents(current, incoming);

    expect(merged).toHaveLength(100);
    expect(merged.at(-1)?.sequence).toBe(250);
    expect(merged[0]).toEqual({
      eventType: 'status',
      sequence: 151,
      data: { state: 'context_budget_update', occupancy_pct: 151 },
    });
  });

  it('dedupes adjacent duplicate status and tool-call-result churn', () => {
    let events: ProjectionStreamEvent[] = [];
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      events = appendLiveProjectionEvent(events, {
        eventType: 'status',
        sequence,
        data: { state: 'started' },
      });
    }
    events = appendLiveProjectionEvent(events, {
      eventType: 'tool_call_start',
      sequence: 11,
      data: { tool_call_id: 'call_duplicate', name: 'echo_tool' },
    });
    events = appendLiveProjectionEvent(events, {
      eventType: 'tool_call_result',
      sequence: 12,
      data: {
        tool_call_id: 'call_duplicate',
        result: { status: 'error', error: 'same error signature' },
      },
    });
    events = appendLiveProjectionEvent(events, {
      eventType: 'tool_call_result',
      sequence: 13,
      data: {
        tool_call_id: 'call_duplicate',
        result: { status: 'error', error: 'same error signature' },
      },
    });
    events = appendLiveProjectionEvent(events, {
      eventType: 'done',
      sequence: 14,
      data: {},
    });

    expect(events).toHaveLength(4);
    expect(events).toEqual([
      expect.objectContaining({ eventType: 'status', sequence: 10, data: { state: 'started' } }),
      expect.objectContaining({
        eventType: 'tool_call_start',
        sequence: 11,
        data: { tool_call_id: 'call_duplicate', name: 'echo_tool' },
      }),
      expect.objectContaining({
        eventType: 'tool_call_result',
        sequence: 13,
        data: {
          tool_call_id: 'call_duplicate',
          result: { status: 'error', error: 'same error signature' },
        },
      }),
      expect.objectContaining({ eventType: 'done', sequence: 14, data: {} }),
    ]);
  });
});
