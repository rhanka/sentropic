import { describe, expect, it } from 'vitest';
import {
  appendLiveProjectionEvent,
  countLinkedSteerMessages,
  getLinkedSteerMessageIds,
  mergeProjectionHistoryEvents,
  projectAssistantRunSegments,
  type ProjectionStreamEvent,
} from '../../src/lib/utils/chat-run-projection';

describe('chat run projection', () => {
  it('splits one run into alternating runtime and assistant segments', () => {
    const events: ProjectionStreamEvent[] = [
      { eventType: 'status', sequence: 1, data: { state: 'started' } },
      { eventType: 'reasoning_delta', sequence: 2, data: { delta: 'Thinking' } },
      { eventType: 'content_delta', sequence: 3, data: { delta: 'First answer.' } },
      { eventType: 'tool_call_start', sequence: 4, data: { name: 'bash' } },
      { eventType: 'content_delta', sequence: 5, data: { delta: 'Second answer.' } },
      { eventType: 'done', sequence: 6, data: {} },
    ];

    expect(projectAssistantRunSegments(events)).toEqual([
      expect.objectContaining({ kind: 'runtime', id: 'runtime:1' }),
      expect.objectContaining({ kind: 'assistant', id: 'assistant:3', content: 'First answer.' }),
      expect.objectContaining({ kind: 'runtime', id: 'runtime:4' }),
      expect.objectContaining({ kind: 'assistant', id: 'assistant:5', content: 'Second answer.' }),
    ]);
  });

  it('forces a new runtime segment on run_resumed_with_steer and records steer insertion count', () => {
    const events: ProjectionStreamEvent[] = [
      { eventType: 'reasoning_delta', sequence: 1, data: { delta: 'Before' } },
      { eventType: 'status', sequence: 2, data: { state: 'run_interrupted_for_steer' } },
      { eventType: 'status', sequence: 3, data: { state: 'run_resumed_with_steer', steer_count: 2 } },
      { eventType: 'tool_call_start', sequence: 4, data: { name: 'rg' } },
      { eventType: 'content_delta', sequence: 5, data: { delta: 'After' } },
    ];

    const segments = projectAssistantRunSegments(events);
    expect(segments).toHaveLength(4);
    expect(segments[0]).toEqual(expect.objectContaining({ kind: 'runtime', id: 'runtime:1' }));
    expect(segments[1]).toEqual(expect.objectContaining({ kind: 'runtime', id: 'runtime:2' }));
    expect(segments[2]).toEqual(expect.objectContaining({ kind: 'runtime', id: 'runtime:3', steerCountBefore: 2 }));
    expect(segments[3]).toEqual(expect.objectContaining({ kind: 'assistant', content: 'After' }));
  });

  it('drops the trailing runtime segment once the run completed successfully', () => {
    const events: ProjectionStreamEvent[] = [
      { eventType: 'content_delta', sequence: 1, data: { delta: 'Visible answer' } },
      { eventType: 'status', sequence: 2, data: { state: 'context_budget_update', occupancy_pct: 12 } },
      { eventType: 'done', sequence: 3, data: {} },
    ];

    expect(projectAssistantRunSegments(events)).toEqual([
      expect.objectContaining({ kind: 'assistant', content: 'Visible answer' }),
    ]);
  });

  it('counts steer_received events and links the trailing contiguous user messages before assistant', () => {
    const events: ProjectionStreamEvent[] = [
      { eventType: 'status', sequence: 10, data: { state: 'steer_received', message: 'A' } },
      { eventType: 'status', sequence: 11, data: { state: 'steer_received', message: 'B' } },
    ];
    const timeline = [
      { id: 'user_1', role: 'user' },
      { id: 'user_steer_1', role: 'user' },
      { id: 'user_steer_2', role: 'user' },
      { id: 'assistant_1', role: 'assistant' },
    ];

    expect(countLinkedSteerMessages(events)).toBe(2);
    expect(getLinkedSteerMessageIds(timeline, 3, 2)).toEqual([
      'user_steer_1',
      'user_steer_2',
    ]);
  });

  it('merges authoritative history over overlapping live replay and appends future live events', () => {
    const replay = [
      { eventType: 'content_delta', sequence: 2, data: { delta: 'AB' } },
    ];
    const history = [
      { eventType: 'content_delta', sequence: 1, data: { delta: 'A' } },
      { eventType: 'content_delta', sequence: 2, data: { delta: 'B' } },
    ];

    const merged = mergeProjectionHistoryEvents(replay, history);
    expect(merged.map((event) => [event.sequence, event.data.delta])).toEqual([
      [1, 'A'],
      [2, 'B'],
    ]);

    const next = appendLiveProjectionEvent(merged, {
      eventType: 'content_delta',
      sequence: 3,
      data: { delta: 'C' },
    });
    expect(next.map((event) => [event.sequence, event.data.delta])).toEqual([
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
    ]);
  });
});
