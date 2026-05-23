import { describe, expect, it } from 'vitest';
import {
  buildProjectedTimeline,
  type ChatProjectionMessage,
} from '@sentropic/chat-ui/state/chatProjection';
import type { ProjectedRunSegment } from '@sentropic/chat-ui/utils/chat-run-projection';

type Message = ChatProjectionMessage & { sequence: number };

const assistant = (content: string): Message => ({
  id: 'assistant-1',
  role: 'assistant',
  content,
  _localStatus: 'processing',
  _streamId: 'stream-1',
  sequence: 2,
});

const runtimeSegment: ProjectedRunSegment = {
  id: 'runtime:1',
  kind: 'runtime',
  events: [],
  content: '',
  steerCountBefore: 0,
};

const assistantSegment = (content: string): ProjectedRunSegment => ({
  id: 'assistant:1',
  kind: 'assistant',
  events: [],
  content,
  steerCountBefore: 0,
});

const timelineFor = (message: Message, segments: ProjectedRunSegment[]) =>
  buildProjectedTimeline({
    timeline: [
      { id: 'user-1', role: 'user', content: 'hi', sequence: 1 },
      message,
    ],
    getAssistantComputation: () => ({
      segments,
      linkedSteerCount: 0,
    }),
  });

describe('ChatTimeline projection stability', () => {
  it('keeps runtime and assistant segment keys stable across late content deltas', () => {
    const before = timelineFor(assistant('hel'), [
      runtimeSegment,
      assistantSegment('hel'),
    ]);
    const after = timelineFor(assistant('hello'), [
      runtimeSegment,
      assistantSegment('hello'),
    ]);

    expect(before.map((item) => item.key)).toEqual(after.map((item) => item.key));
    expect(after.map((item) => item.key)).toEqual([
      'message:user-1',
      'assistant-1:runtime:1',
      'assistant-1:assistant:1',
    ]);
  });

  it('keeps steer insertion keyed by message id before an active runtime segment', () => {
    const projected = buildProjectedTimeline({
      timeline: [
        { id: 'user-1', role: 'user', content: 'hi', sequence: 1 },
        assistant('hello'),
      ],
      optimisticSteerMessages: [
        {
          id: 'steer-1',
          role: 'user',
          content: 'narrow it',
          sequence: 3,
          _optimisticSteerTargetAssistantId: 'assistant-1',
          _optimisticSteerSubmittedAtMs: 100,
        },
      ],
      getAssistantComputation: () => ({
        segments: [assistantSegment('hello'), runtimeSegment],
        linkedSteerCount: 0,
      }),
    });

    expect(projected.map((item) => item.key)).toEqual([
      'message:user-1',
      'assistant-1:assistant:1',
      'message:steer-1',
      'assistant-1:runtime:1',
    ]);
  });
});
