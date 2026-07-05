import { describe, expect, it } from 'vitest';
import {
  getProjectedRunTerminalOutcome,
  projectAssistantRunSegments,
  type ProjectedRunSegment,
  type ProjectionStreamEvent,
} from '../src/utils/chat-run-projection.js';
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
  terminalOutcome: ChatProjectionComputation['terminalOutcome'] = null,
): ChatProjectionComputation => ({
  segments,
  linkedSteerCount,
  terminalOutcome,
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

// ---------------------------------------------------------------------------
// FREEZE regression: a server-completed LIVE run must be terminal even when
// the message has neither `_localStatus` nor `content` (the SSE `done`
// callback and the job-poll `completed` both missed — nano no-delta runs +
// short-lived SSE on workspace switch). The timeline must derive the terminal
// outcome from the projected stream events themselves (`done`/`error`),
// mirroring chat-core history.ts getTerminalOutcome but for the LIVE path.
// ---------------------------------------------------------------------------
describe('chat projection live terminal outcome (freeze regression)', () => {
  const event = (
    eventType: string,
    sequence: number,
    data: unknown = {},
  ): ProjectionStreamEvent => ({ eventType, sequence, data });

  // The verified-passing repro from the diagnosis: status(response_created),
  // a final content delta, then `done` — no _localStatus, content:null.
  const doneEvents: ProjectionStreamEvent[] = [
    event('status', 1, { state: 'response_created' }),
    event('content_delta', 2, { delta: 'Voici la réponse finale.' }),
    event('done', 3),
  ];

  const errorEvents: ProjectionStreamEvent[] = [
    event('status', 1, { state: 'response_created' }),
    event('content_delta', 2, { delta: 'Partial before failure.' }),
    event('error', 3, { message: 'boom' }),
  ];

  // No terminal event yet — the run is still streaming.
  const midStreamEvents: ProjectionStreamEvent[] = [
    event('status', 1, { state: 'response_created' }),
    event('content_delta', 2, { delta: 'Streaming…' }),
  ];

  it('getProjectedRunTerminalOutcome maps done→completed, error→failed, mid-stream→null', () => {
    expect(getProjectedRunTerminalOutcome(doneEvents)).toBe('completed');
    expect(getProjectedRunTerminalOutcome(errorEvents)).toBe('failed');
    expect(getProjectedRunTerminalOutcome(midStreamEvents)).toBeNull();
    // Last terminal event in sequence order wins (mirror of history.ts).
    expect(
      getProjectedRunTerminalOutcome([
        event('error', 1, {}),
        event('done', 2),
      ]),
    ).toBe('completed');
  });

  const liveComputation = (
    events: ProjectionStreamEvent[],
  ): ChatProjectionComputation =>
    computation(
      projectAssistantRunSegments(events),
      0,
      getProjectedRunTerminalOutcome(events),
    );

  it('marks the assistant segment terminal on `done` even without _localStatus/content', () => {
    const message = assistant('a1', { _streamId: 's1' });
    expect(message._localStatus).toBeUndefined();
    expect(message.content).toBeUndefined();

    const projected = buildProjectedTimeline({
      timeline: [message],
      getAssistantComputation: () => liveComputation(doneEvents),
    });

    const assistantItems = projected.filter(
      (item) => item.kind === 'assistant-segment',
    );
    expect(assistantItems.length).toBeGreaterThan(0);
    for (const item of assistantItems) {
      expect(item).toMatchObject({ kind: 'assistant-segment', isTerminal: true });
    }
    // No active runtime segment lingering once the run is terminal.
    for (const item of projected) {
      if (item.kind === 'runtime-segment') {
        expect(item.isActiveRuntimeSegment).toBe(false);
      }
    }
  });

  it('marks the run terminal (failed) on `error` without _localStatus/content', () => {
    const projected = buildProjectedTimeline({
      timeline: [assistant('a1', { _streamId: 's1' })],
      getAssistantComputation: () => liveComputation(errorEvents),
    });

    const assistantItems = projected.filter(
      (item) => item.kind === 'assistant-segment',
    );
    expect(assistantItems.length).toBeGreaterThan(0);
    for (const item of assistantItems) {
      expect(item).toMatchObject({ isTerminal: true });
    }
    for (const item of projected) {
      if (item.kind === 'runtime-segment') {
        expect(item.isActiveRuntimeSegment).toBe(false);
      }
    }
  });

  it('CONTROL: mid-stream run (no done/error yet) stays non-terminal so live deltas keep rendering', () => {
    const projected = buildProjectedTimeline({
      timeline: [assistant('a1', { _streamId: 's1' })],
      getAssistantComputation: () => liveComputation(midStreamEvents),
    });

    const assistantItems = projected.filter(
      (item) => item.kind === 'assistant-segment',
    );
    expect(assistantItems.length).toBeGreaterThan(0);
    for (const item of assistantItems) {
      expect(item).toMatchObject({ isTerminal: false });
    }
  });

  it('explicit _localStatus still wins (processing stays non-terminal even with stale done)', () => {
    const projectedProcessing = buildProjectedTimeline({
      timeline: [assistant('a1', { _streamId: 's1', _localStatus: 'processing' })],
      // No terminal event in the projected events.
      getAssistantComputation: () => liveComputation(midStreamEvents),
    });
    for (const item of projectedProcessing) {
      if (item.kind === 'assistant-segment') {
        expect(item.isTerminal).toBe(false);
      }
    }

    // Explicit completed status keeps terminal even with no terminal event.
    const projectedCompleted = buildProjectedTimeline({
      timeline: [assistant('a1', { _streamId: 's1', _localStatus: 'completed' })],
      getAssistantComputation: () => liveComputation(midStreamEvents),
    });
    const completedAssistants = projectedCompleted.filter(
      (item) => item.kind === 'assistant-segment',
    );
    expect(completedAssistants.length).toBeGreaterThan(0);
    for (const item of completedAssistants) {
      expect(item.isTerminal).toBe(true);
    }
  });
});
