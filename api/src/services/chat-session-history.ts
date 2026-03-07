export type ChatHistoryStreamEvent = {
  eventType: string;
  data: unknown;
  sequence: number;
  createdAt?: Date | string;
};

export type ChatHistoryRunSegment = {
  id: string;
  kind: 'assistant' | 'runtime';
  events: ChatHistoryStreamEvent[];
  content: string;
  steerCountBefore: number;
  runtimeSummary?: {
    hasReasoning: boolean;
    hasTools: boolean;
    toolCount: number;
    contextBudgetPct: number | null;
    durationMs: number | null;
    reasoningEffortLabel: string | null;
  };
};

export type ChatHistoryMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string | null;
  reasoning?: string | null;
  model?: string | null;
  promptId?: string | null;
  promptVersionId?: string | null;
  sequence?: number;
  createdAt?: Date | string;
  feedbackVote?: number | null;
  _localStatus?: 'processing' | 'completed' | 'failed';
  _streamId?: string;
};

export type ChatHistoryTimelineItem =
  | {
      kind: 'message';
      key: string;
      message: ChatHistoryMessage;
    }
  | {
      kind: 'assistant-segment';
      key: string;
      message: ChatHistoryMessage;
      streamId: string;
      segment: ChatHistoryRunSegment;
      isLastAssistantSegment: boolean;
      isTerminal: boolean;
    }
  | {
      kind: 'runtime-segment';
      key: string;
      message: ChatHistoryMessage;
      streamId: string;
      segment: ChatHistoryRunSegment;
      isActiveRuntimeSegment: boolean;
    };

const buildRuntimeSummary = (
  events: readonly ChatHistoryStreamEvent[],
): ChatHistoryRunSegment['runtimeSummary'] => {
  let hasReasoning = false;
  let hasReasoningContent = false;
  let toolCount = 0;
  let contextBudgetPct: number | null = null;
  let reasoningEffortLabel: string | null = null;
  const seenToolCalls = new Set<string>();
  let startedAtMs: number | null = null;
  let endedAtMs: number | null = null;

  for (const event of events) {
    const createdAtMs =
      typeof event.createdAt === 'string'
        ? Date.parse(event.createdAt)
        : event.createdAt instanceof Date
          ? event.createdAt.getTime()
          : NaN;
    if (Number.isFinite(createdAtMs)) {
      if (startedAtMs === null || createdAtMs < startedAtMs) startedAtMs = createdAtMs;
      if (endedAtMs === null || createdAtMs > endedAtMs) endedAtMs = createdAtMs;
    }
    if (event.eventType === 'reasoning_delta') {
      hasReasoning = true;
      hasReasoningContent = true;
      continue;
    }
    if (event.eventType === 'tool_call_start') {
      const toolCallId = String(
        ((event.data as { tool_call_id?: unknown } | null | undefined)?.tool_call_id ??
          ''),
      ).trim();
      if (toolCallId) {
        if (!seenToolCalls.has(toolCallId)) {
          seenToolCalls.add(toolCallId);
          toolCount += 1;
        }
      } else {
        toolCount += 1;
      }
      continue;
    }
    if (event.eventType !== 'status') continue;
    const state = getStatusState(event);
    if (
      state === 'reasoning_effort_selected' ||
      state === 'reasoning_effort' ||
      state === 'reasoning_effort_eval_failed'
    ) {
      hasReasoning = true;
      if (state === 'reasoning_effort_eval_failed') {
        const message = String(
          ((event.data as { message?: unknown } | null | undefined)?.message ?? ''),
        ).trim();
        if (message) reasoningEffortLabel = message;
      } else {
        const effort = String(
          ((event.data as { effort?: unknown } | null | undefined)?.effort ?? ''),
        ).trim();
        const by = String(
          ((event.data as { by?: unknown } | null | undefined)?.by ?? ''),
        ).trim();
        const phase = String(
          ((event.data as { phase?: unknown } | null | undefined)?.phase ?? ''),
        ).trim();
        const iterationRaw =
          (event.data as { iteration?: unknown } | null | undefined)?.iteration;
        const iteration =
          iterationRaw === null || iterationRaw === undefined
            ? ''
            : String(iterationRaw).trim();
        let label = effort;
        if (state === 'reasoning_effort_selected' && by) {
          label = effort ? `${effort} (via ${by})` : by;
        } else if (state === 'reasoning_effort' && phase) {
          label = effort
            ? `${effort} — ${phase}${iteration ? ` #${iteration}` : ''}`
            : `${phase}${iteration ? ` #${iteration}` : ''}`;
        }
        if (label) reasoningEffortLabel = label;
      }
      continue;
    }
    if (state === 'context_budget_update') {
      const pct = Number(
        ((event.data as { occupancy_pct?: unknown } | null | undefined)?.occupancy_pct ??
          NaN),
      );
      if (Number.isFinite(pct)) {
        contextBudgetPct = Math.max(0, Math.min(100, Math.round(pct)));
      }
    }
  }

  const normalizedEffort = String(reasoningEffortLabel ?? '').trim().toLowerCase();
  const isReasoningNoneOnly =
    toolCount === 0 &&
    !hasReasoningContent &&
    (normalizedEffort === 'none' ||
      normalizedEffort.startsWith('none ') ||
      normalizedEffort.startsWith('none —'));

  if (isReasoningNoneOnly) {
    return undefined;
  }

  if (!hasReasoning && toolCount === 0 && contextBudgetPct === null) {
    return undefined;
  }

  const durationMs =
    startedAtMs !== null && endedAtMs !== null && endedAtMs >= startedAtMs
      ? endedAtMs - startedAtMs
      : null;

  return {
    hasReasoning,
    hasTools: toolCount > 0,
    toolCount,
    contextBudgetPct,
    durationMs,
    reasoningEffortLabel,
  };
};

type MutableSegment = {
  id: string;
  kind: 'assistant' | 'runtime';
  events: ChatHistoryStreamEvent[];
  steerCountBefore: number;
};

const asFiniteSequence = (value: unknown): number | null => {
  const sequence = Number(value);
  return Number.isFinite(sequence) ? sequence : null;
};

const normalizeSteerCount = (value: unknown): number => {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.floor(count);
};

const getStatusState = (event: ChatHistoryStreamEvent): string => {
  if (event.eventType !== 'status') return '';
  const data = event.data as { state?: unknown } | null | undefined;
  return String(data?.state ?? '').trim();
};

const isAssistantVisibleEvent = (event: ChatHistoryStreamEvent): boolean =>
  event.eventType === 'content_delta';

const shouldForceRuntimeBoundary = (
  current: MutableSegment | null,
  event: ChatHistoryStreamEvent,
): boolean => {
  if (!current || current.kind !== 'runtime' || current.events.length === 0) {
    return false;
  }
  const state = getStatusState(event);
  return (
    state === 'run_interrupted_for_steer' ||
    state === 'run_resumed_with_steer'
  );
};

const buildSegmentId = (
  kind: 'assistant' | 'runtime',
  startSequence: number,
): string => `${kind}:${startSequence}`;

const HISTORY_RUNTIME_CONTROL_STATES = new Set([
  'run_interrupted_for_steer',
  'run_resumed_with_steer',
  'steer_received',
]);

const isPureHistoryRuntimeControlSegment = (
  segment: MutableSegment,
): boolean => {
  if (segment.kind !== 'runtime' || segment.events.length === 0) return false;
  return segment.events.every((event) => {
    if (event.eventType !== 'status') return false;
    return HISTORY_RUNTIME_CONTROL_STATES.has(getStatusState(event));
  });
};

const finalizeSegment = (
  segment: MutableSegment | null,
): ChatHistoryRunSegment | null => {
  if (!segment || segment.events.length === 0) return null;
  if (isPureHistoryRuntimeControlSegment(segment)) return null;
  const content =
    segment.kind === 'assistant'
      ? segment.events
          .filter((event) => event.eventType === 'content_delta')
          .map((event) => String((event.data as { delta?: unknown } | null | undefined)?.delta ?? ''))
          .join('')
      : '';
  return {
    id: segment.id,
    kind: segment.kind,
    events: segment.events,
    content,
    steerCountBefore: segment.steerCountBefore,
  };
};

export const projectChatHistorySegments = (
  events: readonly ChatHistoryStreamEvent[],
): ChatHistoryRunSegment[] => {
  const ordered = [...events]
    .filter((event) => asFiniteSequence(event.sequence) !== null)
    .sort((left, right) => left.sequence - right.sequence);

  const projected: ChatHistoryRunSegment[] = [];
  let current: MutableSegment | null = null;
  let terminal: 'done' | 'error' | null = null;

  const flush = () => {
    const next = finalizeSegment(current);
    if (next) projected.push(next);
    current = null;
  };

  for (const event of ordered) {
    if (event.eventType === 'done') {
      terminal = 'done';
      continue;
    }
    if (event.eventType === 'error') {
      terminal = 'error';
    }

    const kind: 'assistant' | 'runtime' = isAssistantVisibleEvent(event)
      ? 'assistant'
      : 'runtime';

    if (
      !current ||
      current.kind !== kind ||
      shouldForceRuntimeBoundary(current, event)
    ) {
      flush();
      current = {
        id: buildSegmentId(kind, event.sequence),
        kind,
        events: [],
        steerCountBefore: 0,
      };
    }

    current.events.push(event);
    if (getStatusState(event) === 'run_resumed_with_steer') {
      const data = event.data as { steer_count?: unknown } | null | undefined;
      current.steerCountBefore += normalizeSteerCount(data?.steer_count);
    }
  }

  flush();

  if (
    terminal === 'done' &&
    projected.length > 0 &&
    projected[projected.length - 1]?.kind === 'runtime' &&
    projected.some((segment) => segment.kind === 'assistant')
  ) {
    projected.pop();
  }

  return projected;
};

const countLinkedSteerMessages = (
  events: readonly ChatHistoryStreamEvent[],
): number =>
  events.filter(
    (event) =>
      event.eventType === 'status' && getStatusState(event) === 'steer_received',
  ).length;

const getLinkedSteerMessageIds = (
  timeline: readonly ChatHistoryMessage[],
  assistantIndex: number,
  steerCount: number,
): string[] => {
  if (assistantIndex <= 0 || steerCount <= 0) return [];
  const contiguousUsers: ChatHistoryMessage[] = [];
  for (let cursor = assistantIndex - 1; cursor >= 0; cursor -= 1) {
    const candidate = timeline[cursor];
    if (candidate?.role !== 'user') break;
    contiguousUsers.unshift(candidate);
  }
  if (contiguousUsers.length === 0) return [];
  return contiguousUsers
    .slice(Math.max(0, contiguousUsers.length - steerCount))
    .map((message) => message.id);
};

const buildFallbackProjectedSegments = (
  message: ChatHistoryMessage,
): ChatHistoryRunSegment[] => {
  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    return [
      {
        id: `assistant:fallback:${message.id}`,
        kind: 'assistant',
        events: [],
        content: message.content,
        steerCountBefore: 0,
      },
    ];
  }
  if (message._localStatus === 'processing') {
    return [
      {
        id: `runtime:fallback:${message.id}`,
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
    ];
  }
  return [];
};

export const buildChatHistoryTimeline = (
  timeline: readonly ChatHistoryMessage[],
  eventsByMessageId: ReadonlyMap<string, ChatHistoryStreamEvent[]>,
): ChatHistoryTimelineItem[] => {
  const steerIdsByAssistantId = new Map<string, string[]>();
  const skippedSteerIds = new Set<string>();

  const getEventsForMessage = (message: ChatHistoryMessage) => {
    const streamId = message._streamId ?? message.id;
    return eventsByMessageId.get(streamId) ?? [];
  };

  for (let index = 0; index < timeline.length; index += 1) {
    const message = timeline[index];
    if (message.role !== 'assistant') continue;
    const projectionEvents = getEventsForMessage(message);
    const segments = projectChatHistorySegments(projectionEvents);
    const linkedSteerCount = countLinkedSteerMessages(projectionEvents);
    if (linkedSteerCount <= 0) continue;
    const firstRuntimeSegmentWithSteer = segments.findIndex(
      (segment) => segment.kind === 'runtime' && segment.steerCountBefore > 0,
    );
    const hasAssistantVisibleBeforeSteer =
      firstRuntimeSegmentWithSteer > 0 &&
      segments
        .slice(0, firstRuntimeSegmentWithSteer)
        .some((segment) => segment.kind === 'assistant');
    if (!hasAssistantVisibleBeforeSteer) continue;
    const linkedIds = getLinkedSteerMessageIds(timeline, index, linkedSteerCount);
    if (linkedIds.length === 0) continue;
    steerIdsByAssistantId.set(message.id, linkedIds);
    for (const linkedId of linkedIds) skippedSteerIds.add(linkedId);
  }

  const projected: ChatHistoryTimelineItem[] = [];

  for (const message of timeline) {
    if (skippedSteerIds.has(message.id)) continue;
    if (message.role !== 'assistant') {
      projected.push({
        kind: 'message',
        key: `message:${message.id}`,
        message,
      });
      continue;
    }

    const streamId = message._streamId ?? message.id;
    const projectedSegments = projectChatHistorySegments(getEventsForMessage(message));
    const segments =
      projectedSegments.length > 0
        ? projectedSegments
        : buildFallbackProjectedSegments(message);
    const linkedSteers = (steerIdsByAssistantId.get(message.id) ?? [])
      .map((steerId) => timeline.find((entry) => entry.id === steerId) ?? null)
      .filter((entry): entry is ChatHistoryMessage => entry !== null);

    const assistantIndexes = segments
      .map((segment, index) => (segment.kind === 'assistant' ? index : -1))
      .filter((index) => index >= 0);
    const lastAssistantIndex =
      assistantIndexes.length > 0
        ? assistantIndexes[assistantIndexes.length - 1]
        : -1;
    const lastRuntimeIndex = (() => {
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        if (segments[index]?.kind === 'runtime') return index;
      }
      return -1;
    })();
    const isTerminal =
      (message._localStatus ?? (message.content ? 'completed' : 'processing')) ===
      'completed';
    let steerCursor = 0;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment) continue;

      if (segment.kind === 'runtime') {
        let steerCountToInsert = segment.steerCountBefore;
        if (
          steerCountToInsert === 0 &&
          index === lastRuntimeIndex &&
          !isTerminal &&
          steerCursor < linkedSteers.length
        ) {
          steerCountToInsert = linkedSteers.length - steerCursor;
        }
        if (steerCountToInsert > 0) {
          const nextSteers = linkedSteers.slice(
            steerCursor,
            steerCursor + steerCountToInsert,
          );
          steerCursor += nextSteers.length;
          for (const steerMessage of nextSteers) {
            projected.push({
              kind: 'message',
              key: `message:${steerMessage.id}`,
              message: steerMessage,
            });
          }
        }

        projected.push({
          kind: 'runtime-segment',
          key: `${message.id}:${segment.id}`,
          message,
          streamId,
          segment,
          isActiveRuntimeSegment: false,
        });
        continue;
      }

      projected.push({
        kind: 'assistant-segment',
        key: `${message.id}:${segment.id}`,
        message,
        streamId,
        segment,
        isLastAssistantSegment: index === lastAssistantIndex,
        isTerminal,
      });
    }

    if (steerCursor < linkedSteers.length) {
      for (const steerMessage of linkedSteers.slice(steerCursor)) {
        projected.push({
          kind: 'message',
          key: `message:${steerMessage.id}`,
          message: steerMessage,
        });
      }
    }
  }

  return projected;
};

export const compactChatHistoryTimelineForSummary = (
  items: readonly ChatHistoryTimelineItem[],
): ChatHistoryTimelineItem[] =>
  items.map((item) => {
    if (item.kind === 'assistant-segment') {
      return {
        ...item,
        segment: {
          ...item.segment,
          events: [],
        },
      };
    }
    if (item.kind === 'runtime-segment') {
      return {
        ...item,
        segment: {
          ...item.segment,
          events: [],
          runtimeSummary: buildRuntimeSummary(item.segment.events),
        },
      };
    }
    return item;
  });

export const buildAssistantMessageHistoryDetails = (
  message: ChatHistoryMessage,
  events: readonly ChatHistoryStreamEvent[],
): ChatHistoryTimelineItem[] => {
  const streamId = message._streamId ?? message.id;
  const projectedSegments = projectChatHistorySegments(events);
  const segments =
    projectedSegments.length > 0
      ? projectedSegments
      : buildFallbackProjectedSegments(message);
  const assistantIndexes = segments
    .map((segment, index) => (segment.kind === 'assistant' ? index : -1))
    .filter((index) => index >= 0);
  const lastAssistantIndex =
    assistantIndexes.length > 0
      ? assistantIndexes[assistantIndexes.length - 1]
      : -1;
  const isTerminal =
    (message._localStatus ?? (message.content ? 'completed' : 'processing')) ===
    'completed';

  return segments.map((segment, index) =>
    segment.kind === 'assistant'
      ? {
          kind: 'assistant-segment',
          key: `${message.id}:${segment.id}`,
          message,
          streamId,
          segment,
          isLastAssistantSegment: index === lastAssistantIndex,
          isTerminal,
        }
      : {
          kind: 'runtime-segment',
          key: `${message.id}:${segment.id}`,
          message,
          streamId,
          segment: {
            ...segment,
            runtimeSummary: buildRuntimeSummary(segment.events),
          },
          isActiveRuntimeSegment: false,
        },
  );
};
