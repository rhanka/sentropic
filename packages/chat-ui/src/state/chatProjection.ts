import {
  getLinkedSteerMessageIds,
  type ProjectedRunSegment,
  type ProjectionStreamEvent,
} from '../utils/chat-run-projection.js';

export type ChatProjectionMessage = {
  id: string;
  role: string;
  content?: string | null;
  attachments?: readonly ChatMessageAttachment[];
  _localStatus?: 'processing' | 'completed' | 'failed';
  _streamId?: string;
  _optimisticSteerTargetAssistantId?: string;
  _optimisticSteerSubmittedAtMs?: number;
};

export type ChatMessageAttachment = {
  id?: string;
  kind: 'image' | 'file';
  source?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  state?: 'pending' | 'uploading' | 'ready' | 'failed';
  documentId?: string;
  previewUrl?: string;
  url?: string;
  width?: number;
  height?: number;
  error?: string;
};

export type ChatProjectionComputation = {
  segments: readonly ProjectedRunSegment[];
  linkedSteerCount: number;
};

export type ChatProjectionSteerAck = {
  streamId: string;
  message: string;
};

export type ChatProjectionSegment<RuntimeSummary = unknown> =
  ProjectedRunSegment & {
    runtimeSummary?: RuntimeSummary;
  };

export type ChatProjectedTimelineItem<
  Message extends ChatProjectionMessage = ChatProjectionMessage,
  RuntimeSummary = unknown,
> =
  | {
      kind: 'message';
      key: string;
      message: Message;
    }
  | {
      kind: 'assistant-segment';
      key: string;
      message: Message;
      streamId: string;
      segment: ProjectedRunSegment;
      isLastAssistantSegment: boolean;
      isTerminal: boolean;
    }
  | {
      kind: 'runtime-segment';
      key: string;
      message: Message;
      streamId: string;
      segment: ChatProjectionSegment<RuntimeSummary>;
      acknowledgementText?: string;
      isActiveRuntimeSegment: boolean;
    };

export type BuildProjectedTimelineInput<
  Message extends ChatProjectionMessage,
  RuntimeSummary = unknown,
> = {
  timeline: readonly Message[];
  optimisticSteerMessages?: readonly Message[];
  runtimeSummariesByMessageId?: ReadonlyMap<string, RuntimeSummary>;
  composerSteerAck?: ChatProjectionSteerAck | null;
  getAssistantComputation: (message: Message) => ChatProjectionComputation;
};

export const buildFallbackProjectedSegments = (
  message: ChatProjectionMessage,
): ProjectedRunSegment[] => {
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

export const buildProjectedTimeline = <
  Message extends ChatProjectionMessage,
  RuntimeSummary = unknown,
>({
  timeline,
  optimisticSteerMessages = [],
  runtimeSummariesByMessageId,
  composerSteerAck = null,
  getAssistantComputation,
}: BuildProjectedTimelineInput<
  Message,
  RuntimeSummary
>): ChatProjectedTimelineItem<Message, RuntimeSummary>[] => {
  const steerIdsByAssistantId = new Map<string, string[]>();
  const optimisticSteersByAssistantId = new Map<string, Message[]>();
  const skippedSteerIds = new Set<string>();

  for (const steerMessage of optimisticSteerMessages) {
    const assistantId = String(
      steerMessage._optimisticSteerTargetAssistantId ?? '',
    ).trim();
    if (!assistantId) continue;
    const existing = optimisticSteersByAssistantId.get(assistantId) ?? [];
    existing.push(steerMessage);
    optimisticSteersByAssistantId.set(assistantId, existing);
  }

  for (let index = 0; index < timeline.length; index += 1) {
    const message = timeline[index];
    if (!message || message.role !== 'assistant') continue;
    if ((optimisticSteersByAssistantId.get(message.id)?.length ?? 0) > 0) {
      continue;
    }
    const assistantProjection = getAssistantComputation(message);
    const segments = assistantProjection.segments;
    const linkedSteerCount = assistantProjection.linkedSteerCount;
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

  const projected: ChatProjectedTimelineItem<Message, RuntimeSummary>[] = [];

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
    const assistantProjection = getAssistantComputation(message);
    const projectedSegments = assistantProjection.segments;
    const baseSegments =
      projectedSegments.length > 0
        ? projectedSegments
        : buildFallbackProjectedSegments(message);
    const hasRuntimeSegmentAlready = baseSegments.some((s) => s.kind === 'runtime');
    const storedSummary = runtimeSummariesByMessageId?.get(message.id);
    const segments: readonly ChatProjectionSegment<RuntimeSummary>[] =
      !hasRuntimeSegmentAlready && storedSummary
        ? [
            {
              id: `runtime:history-summary:${message.id}`,
              kind: 'runtime' as const,
              events: [] as ProjectionStreamEvent[],
              content: '',
              steerCountBefore: 0,
              runtimeSummary: storedSummary,
            },
            ...baseSegments,
          ]
        : baseSegments;
    const linkedSteers = (steerIdsByAssistantId.get(message.id) ?? [])
      .map((steerId) => timeline.find((entry) => entry.id === steerId) ?? null)
      .filter((entry): entry is Message => entry !== null);
    const optimisticSteers = optimisticSteersByAssistantId.get(message.id) ?? [];
    const combinedSteers = [...linkedSteers, ...optimisticSteers].sort(
      (left, right) =>
        Number(left._optimisticSteerSubmittedAtMs ?? 0) -
        Number(right._optimisticSteerSubmittedAtMs ?? 0),
    );

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
          steerCursor < combinedSteers.length
        ) {
          steerCountToInsert = combinedSteers.length - steerCursor;
        }
        if (steerCountToInsert > 0) {
          const nextSteers = combinedSteers.slice(
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
          isActiveRuntimeSegment: !isTerminal && index === segments.length - 1,
          acknowledgementText:
            composerSteerAck?.streamId === streamId && index === lastRuntimeIndex
              ? composerSteerAck.message
              : undefined,
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

    if (steerCursor < combinedSteers.length) {
      for (const steerMessage of combinedSteers.slice(steerCursor)) {
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
