/**
 * BR14b Lot 15.5 — pure helpers (history.ts) unit tests.
 * Covers buildChatHistoryTimeline + compactChatHistoryTimelineForSummary
 * + buildAssistantMessageHistoryDetails + projectChatHistorySegments.
 */
import { describe, expect, it } from 'vitest';

import {
  buildAssistantMessageHistoryDetails,
  buildChatHistoryTimeline,
  compactChatHistoryTimelineForSummary,
  projectChatHistorySegments,
  type ChatHistoryMessage,
  type ChatHistoryStreamEvent,
} from '../src/history.js';

const buildEvent = (
  overrides: Partial<ChatHistoryStreamEvent> & { sequence: number; eventType: string },
): ChatHistoryStreamEvent => ({
  data: {},
  ...overrides,
});

describe('projectChatHistorySegments', () => {
  it('groups consecutive content_delta events into one assistant segment', () => {
    const segments = projectChatHistorySegments([
      buildEvent({ sequence: 1, eventType: 'content_delta', data: { delta: 'Hi ' } }),
      buildEvent({ sequence: 2, eventType: 'content_delta', data: { delta: 'there' } }),
      buildEvent({ sequence: 3, eventType: 'done', data: {} }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe('assistant');
    expect(segments[0].content).toBe('Hi there');
  });

  it('separates runtime + assistant segments', () => {
    const segments = projectChatHistorySegments([
      buildEvent({
        sequence: 1,
        eventType: 'status',
        data: { state: 'reasoning_effort_selected', effort: 'medium', by: 'auto' },
      }),
      buildEvent({ sequence: 2, eventType: 'content_delta', data: { delta: 'answer' } }),
      buildEvent({ sequence: 3, eventType: 'done', data: {} }),
    ]);
    expect(segments.map((segment) => segment.kind)).toEqual(['runtime', 'assistant']);
  });

  it('drops trailing runtime segment after a done event when assistant exists', () => {
    const segments = projectChatHistorySegments([
      buildEvent({ sequence: 1, eventType: 'content_delta', data: { delta: 'a' } }),
      buildEvent({
        sequence: 2,
        eventType: 'status',
        data: { state: 'context_budget_update', occupancy_pct: 50 },
      }),
      buildEvent({ sequence: 3, eventType: 'done', data: {} }),
    ]);
    expect(segments.map((segment) => segment.kind)).toEqual(['assistant']);
  });
});

describe('buildChatHistoryTimeline', () => {
  const userMessage: ChatHistoryMessage = {
    id: 'msg-u-1',
    sessionId: 'session',
    role: 'user',
    content: 'Hi',
  };
  const assistantMessage: ChatHistoryMessage = {
    id: 'msg-a-1',
    sessionId: 'session',
    role: 'assistant',
    content: 'Hello',
    _localStatus: 'completed',
  };

  it('emits message items for user messages and segment items for assistant', () => {
    const events = new Map<string, ChatHistoryStreamEvent[]>([
      [
        'msg-a-1',
        [
          buildEvent({ sequence: 1, eventType: 'content_delta', data: { delta: 'Hello' } }),
          buildEvent({ sequence: 2, eventType: 'done', data: {} }),
        ],
      ],
    ]);
    const items = buildChatHistoryTimeline([userMessage, assistantMessage], events);
    expect(items[0].kind).toBe('message');
    expect(items[1].kind).toBe('assistant-segment');
  });

  it('emits a fallback assistant-segment when message has content but no stream events', () => {
    const items = buildChatHistoryTimeline(
      [assistantMessage],
      new Map(),
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('assistant-segment');
  });

  it('emits a fallback runtime segment for processing message without content', () => {
    const processing: ChatHistoryMessage = {
      id: 'msg-a-2',
      sessionId: 'session',
      role: 'assistant',
      content: null,
      _localStatus: 'processing',
    };
    const items = buildChatHistoryTimeline([processing], new Map());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('runtime-segment');
  });
});

describe('compactChatHistoryTimelineForSummary', () => {
  it('strips events from assistant segments and recomputes runtime summary', () => {
    const events = new Map<string, ChatHistoryStreamEvent[]>([
      [
        'msg-a-1',
        [
          buildEvent({ sequence: 1, eventType: 'content_delta', data: { delta: 'A' } }),
          buildEvent({
            sequence: 2,
            eventType: 'status',
            data: { state: 'context_budget_update', occupancy_pct: 50 },
          }),
          buildEvent({ sequence: 3, eventType: 'done', data: {} }),
        ],
      ],
    ]);
    const timeline = buildChatHistoryTimeline(
      [
        {
          id: 'msg-a-1',
          sessionId: 'session',
          role: 'assistant',
          content: 'A',
          _localStatus: 'completed',
        },
      ],
      events,
    );
    const compact = compactChatHistoryTimelineForSummary(timeline);
    for (const item of compact) {
      if (item.kind === 'assistant-segment' || item.kind === 'runtime-segment') {
        expect(item.segment.events).toEqual([]);
      }
    }
  });

  it('preserves plain message items unchanged', () => {
    const message: ChatHistoryMessage = {
      id: 'msg-u-1',
      sessionId: 'session',
      role: 'user',
      content: 'Hi',
    };
    const original = buildChatHistoryTimeline([message], new Map());
    const compact = compactChatHistoryTimelineForSummary(original);
    expect(compact).toEqual(original);
  });
});

describe('buildAssistantMessageHistoryDetails', () => {
  const message: ChatHistoryMessage = {
    id: 'msg-a-1',
    sessionId: 'session',
    role: 'assistant',
    content: 'OK',
    _localStatus: 'completed',
  };

  it('returns segments for a single assistant message', () => {
    const events: ChatHistoryStreamEvent[] = [
      buildEvent({ sequence: 1, eventType: 'content_delta', data: { delta: 'OK' } }),
      buildEvent({ sequence: 2, eventType: 'done', data: {} }),
    ];
    const items = buildAssistantMessageHistoryDetails(message, events);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.message.id === message.id)).toBe(true);
  });

  it('emits a fallback segment when no events are provided but content exists', () => {
    const items = buildAssistantMessageHistoryDetails(message, []);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('assistant-segment');
  });
});
