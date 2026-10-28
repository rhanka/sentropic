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
  /**
   * Event-derived terminal outcome for the LIVE path (from a `done`/`error`
   * event in the projected stream). Used as a backstop OR'd into `isTerminal`
   * so a server-completed run is never left frozen when neither
   * `_localStatus` nor `content` got set (cousin of chat-core history.ts
   * getTerminalOutcome, but for live runs). `null`/absent while still
   * streaming so mid-stream deltas keep rendering.
   */
  terminalOutcome?: 'completed' | 'failed' | null;
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
