import { describe, expect, it } from 'vitest';
import type { ProjectedRunSegment } from '../src/utils/chat-run-projection.js';
import {
  buildFallbackProjectedSegments,
  buildProjectedTimeline,
  type ChatMessageAttachment,
  type ChatProjectionComputation,
  type ChatProjectionMessage,
} from '../src/state/chatProjection.js';

type Message = ChatProjectionMessage & {
  sessionId?: string;
  feedbackVote?: number | null;
};

const user = (id: string, content = id): Message => ({
  id,
  role: 'user',
  content,
});

const assistant = (
  id: string,
  input: Partial<Message> = {},
): Message => ({
  id,
  role: 'assistant',
  ...input,
});

const assistantSegment = (
  id: string,
  content: string,
): ProjectedRunSegment => ({
  id,
  kind: 'assistant',
  events: [],
  content,
  steerCountBefore: 0,
});

const runtimeSegment = (
  id: string,
  steerCountBefore = 0,
): ProjectedRunSegment => ({
  id,
  kind: 'runtime',
  events: [],
  content: '',
  steerCountBefore,
});

const computation = (
  segments: ProjectedRunSegment[],
  linkedSteerCount = 0,
): ChatProjectionComputation => ({
  segments,
  linkedSteerCount,
});

describe('chat projection timeline', () => {
  it('keeps typed message attachments on projected user messages', () => {
    const attachments: ChatMessageAttachment[] = [
      {
        id: 'att_1',
        kind: 'image',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        sizeBytes: 12_345,
        state: 'ready',
        previewUrl: 'blob:diagram',
      },
    ];
    const message: ChatProjectionMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      attachments,
    };

    const projected = buildProjectedTimeline({
      timeline: [message],
      getAssistantComputation: () => computation([]),
    });

    expect(projected[0]).toMatchObject({
      kind: 'message',
      key: 'message:u1',
      message: { attachments },
    });
  });

  it('builds fallback assistant content and processing runtime segments', () => {
    expect(buildFallbackProjectedSegments(assistant('a1', { content: 'Final' }))).toEqual([
      {
        id: 'assistant:fallback:a1',
        kind: 'assistant',
        events: [],
        content: 'Final',
        steerCountBefore: 0,
      },
    ]);

    expect(
      buildFallbackProjectedSegments(assistant('a2', { _localStatus: 'processing' })),
    ).toEqual([
      {
        id: 'runtime:fallback:a2',
        kind: 'runtime',
        events: [
          {
            eventType: 'status',
            sequence: 1,
            data: { state: 'started' },
          },
        ],
        content: '',
        steerCountBefore: 0,
      },
    ]);
  });

  it('injects stored runtime summaries before fallback assistant content', () => {
    const summary = {
      hasReasoning: true,
      hasTools: false,
      toolCount: 0,
      contextBudgetPct: null,
      durationMs: 1200,
      reasoningEffortLabel: 'high',
    };

    const projected = buildProjectedTimeline({
      timeline: [assistant('a1', { content: 'Done' })],
      runtimeSummariesByMessageId: new Map([['a1', summary]]),
      getAssistantComputation: () => computation([]),
    });

    expect(projected.map((item) => item.kind)).toEqual([
      'runtime-segment',
      'assistant-segment',
    ]);
    expect(projected[0]).toMatchObject({
      key: 'a1:runtime:history-summary:a1',
      segment: { runtimeSummary: summary },
    });
  });

  it('moves linked steer messages before the runtime segment that resumes work', () => {
    const projected = buildProjectedTimeline({
      timeline: [user('u1'), user('u2'), assistant('a1', { _localStatus: 'processing' })],
      getAssistantComputation: () =>
        computation([
          assistantSegment('assistant:1', 'partial'),
          runtimeSegment('runtime:2', 1),
        ], 1),
    });

    expect(projected.map((item) => item.key)).toEqual([
      'message:u1',
      'a1:assistant:1',
      'message:u2',
      'a1:runtime:2',
    ]);
  });

  it('places optimistic steer messages before the active runtime segment', () => {
    const projected = buildProjectedTimeline({
      timeline: [assistant('a1', { _localStatus: 'processing', _streamId: 's1' })],
      optimisticSteerMessages: [
        user('local_1', 'steer'),
      ].map((message) => ({
        ...message,
        _optimisticSteerTargetAssistantId: 'a1',
        _optimisticSteerSubmittedAtMs: 20,
      })),
      getAssistantComputation: () => computation([runtimeSegment('runtime:1')]),
    });

    expect(projected.map((item) => item.key)).toEqual([
      'message:local_1',
      'a1:runtime:1',
    ]);
  });

  it('attaches composer acknowledgements to the matching active runtime segment', () => {
    const projected = buildProjectedTimeline({
      timeline: [assistant('a1', { _localStatus: 'processing', _streamId: 's1' })],
      composerSteerAck: { streamId: 's1', message: 'Steer queued' },
      getAssistantComputation: () => computation([runtimeSegment('runtime:1')]),
    });

    expect(projected[0]).toMatchObject({
      kind: 'runtime-segment',
      key: 'a1:runtime:1',
      acknowledgementText: 'Steer queued',
      isActiveRuntimeSegment: true,
    });
  });
});
