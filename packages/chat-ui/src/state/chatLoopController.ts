/**
 * chatLoopController — headless, framework-neutral controller for the chat loop.
 *
 * Slice 1B scope: owns ONLY the message list and projection state.
 *   - messages[]
 *   - initialEventsByMessageId  (batch history events from session history ndjson)
 *   - projectedStreamEventsById (live stream events accumulated per stream)
 *   - projectedAssistantComputationByMessageId (signature cache)
 *   - projectionEventsVersion (bump counter driving timeline recomputation)
 *
 * Later slices add: stream subscription (1C), send/steer (1D), local-tool (1E), model (1F).
 *
 * Design constraints (SPEC_EVOL_CHATUI_MODULARIZATION §3, R3):
 *   - Plain TypeScript — zero Svelte/framework imports.
 *   - Zero sentropic domain strings (no entity-type names, no route ids).
 *   - Reactivity bridge = store-compatible subscribe(listener) interface.
 *     AppChatPanel subscribes and reflects state into its own Svelte reactive fields.
 *   - All pure projection helpers are imported from their existing locations —
 *     no duplication.
 *
 * Reversible decisions:
 *   - subscribe uses a single snapshot callback (not fine-grained field subscriptions)
 *     to keep the interface minimal. Later slices can narrow.
 *   - setMessages / patchMessage mutate messages fully (not patch-by-key) to keep
 *     the surface small; the caller decides what to write.
 *
 * FLAG: reactivity bridge is the key architectural choice for later slices.
 *   The controller deliberately does NOT carry a Svelte store itself — it is a plain
 *   observable. AppChatPanel wraps it in whatever Svelte primitive it chooses.
 *   This keeps the controller usable in React/Vue wrappers (later slices).
 */

import {
  projectAssistantRunSegments,
  countLinkedSteerMessages,
  mergeProjectionHistoryEvents,
  appendLiveProjectionEvent,
  type ProjectionStreamEvent,
} from '../utils/chat-run-projection.js';

import {
  buildProjectedTimeline,
  type ChatProjectionComputation,
  type ChatProjectionMessage,
  type ChatProjectedTimelineItem,
  type ChatProjectionSteerAck,
} from './chatProjection.js';

// ---------------------------------------------------------------------------
// Opaque stream event — matches AppChatPanel's internal StreamEvent shape.
// Using ProjectionStreamEvent alias for the projection helpers; the controller
// accepts the same shape from callers.
// ---------------------------------------------------------------------------
export type ControllerStreamEvent = ProjectionStreamEvent;

// ---------------------------------------------------------------------------
// Projected assistant computation (with signature for the cache)
// ---------------------------------------------------------------------------
type ProjectedAssistantComputationCached = ChatProjectionComputation & {
  /** Cache key — computed from message id, local status, content length, event count, last sequence. */
  signature: string;
};

// ---------------------------------------------------------------------------
// Public state snapshot exposed to the bridge layer
// ---------------------------------------------------------------------------
export type ChatLoopProjectionState<
  Message extends ChatProjectionMessage = ChatProjectionMessage,
  RuntimeSummary = unknown,
> = {
  /** The authoritative message list (user + assistant). */
  readonly messages: readonly Message[];
  /** History events per message id (from session history ndjson fetch). */
  readonly initialEventsByMessageId: ReadonlyMap<string, ControllerStreamEvent[]>;
  /** Accumulated live stream events per stream id. */
  readonly projectedStreamEventsById: ReadonlyMap<string, ControllerStreamEvent[]>;
  /** Version counter — bumped on every event write. Drives timeline recomputation. */
  readonly projectionEventsVersion: number;
  /** Pre-built timeline (recomputed whenever any input changes). */
  readonly projectedTimelineItems: ReadonlyArray<
    ChatProjectedTimelineItem<Message, RuntimeSummary>
  >;
};

// ---------------------------------------------------------------------------
// Controller methods
// ---------------------------------------------------------------------------
export type ChatLoopController<
  Message extends ChatProjectionMessage = ChatProjectionMessage,
  RuntimeSummary = unknown,
> = {
  // -- State access ----------------------------------------------------------

  /** Return current snapshot. */
  getSnapshot(): ChatLoopProjectionState<Message, RuntimeSummary>;

  /**
   * Subscribe to state changes.
   * Follows the observable / Svelte store contract:
   *   - called immediately with current state
   *   - called on every subsequent change
   *   - returns an unsubscribe function
   *
   * This makes the controller directly usable as a Svelte store via `$ctrl`.
   */
  subscribe(
    listener: (state: ChatLoopProjectionState<Message, RuntimeSummary>) => void,
  ): () => void;

  // -- Message list mutations ------------------------------------------------

  /** Replace the full message list. Triggers timeline recomputation. */
  setMessages(messages: Message[]): void;

  /** Append a single message to the end. */
  appendMessage(message: Message): void;

  /**
   * Apply a patch to an existing message by id.
   * Returns true if a matching message was found and patched.
   */
  patchMessage(id: string, patch: Partial<Message>): boolean;

  /** Remove messages with ids not in the provided set. */
  filterMessages(keepIds: Set<string>): void;

  // -- Projection event mutations --------------------------------------------

  /**
   * Merge batch history events for a stream into initialEventsByMessageId.
   * Used when loading session history from the ndjson endpoint.
   * Invalidates the cached computation for messageId.
   */
  mergeHistoryEvents(messageId: string, events: ControllerStreamEvent[]): void;

  /**
   * Merge batch events into projectedStreamEventsById.
   * Used for stream replay / history batch loading into the live-event map.
   */
  mergeProjectedHistoryForStream(streamId: string, events: ControllerStreamEvent[]): void;

  /**
   * Append a single live stream event to projectedStreamEventsById.
   * Deduplicates by sequence number.
   */
  appendProjectedLiveEvent(streamId: string, event: ControllerStreamEvent): void;

  /** Remove all projected events for the given stream. */
  clearProjectedEventsForStream(streamId: string): void;

  /** Reset all projection state (clear both maps + version). */
  resetProjectionState(): void;

  /** Invalidate the cached computation for a message id (forces recompute on next call). */
  invalidateComputationCache(messageId: string): void;

  // -- Projection queries ----------------------------------------------------

  /**
   * Return the effective projection events for a message:
   *   - projectedStreamEventsById[streamId] if non-empty
   *   - else initialEventsByMessageId[streamId]
   */
  getProjectionEventsForMessage(message: Message): ControllerStreamEvent[];

  /**
   * Return the cached (or freshly computed) ChatProjectionComputation for a message.
   * Uses a signature cache to skip recomputation when inputs have not changed.
   */
  getProjectedAssistantComputation(message: Message): ChatProjectionComputation;

  /**
   * Return true if the stream id is tracked by any assistant message in the list
   * (used to guard against stray stream events).
   */
  isTrackedAssistantStreamId(streamId: string): boolean;

  // -- Timeline build -------------------------------------------------------

  /**
   * Build the projected timeline from the current message list and projection state.
   * Accepts optional inputs that change with later slices (steer ack, optimistic steers, runtime summaries).
   */
  buildTimeline(opts?: {
    optimisticSteerMessages?: Message[];
    runtimeSummariesByMessageId?: ReadonlyMap<string, RuntimeSummary>;
    composerSteerAck?: ChatProjectionSteerAck | null;
  }): ReadonlyArray<ChatProjectedTimelineItem<Message, RuntimeSummary>>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a headless projection controller for the chat loop.
 *
 * This slice owns: messages, initialEventsByMessageId, projectedStreamEventsById,
 * the signature cache, and the projected timeline.
 *
 * Type parameters:
 *   Message        — extends ChatProjectionMessage (caller's LocalMessage type)
 *   RuntimeSummary — per-message runtime summary (caller's RuntimeSegmentSummary type)
 */
export function createChatLoopController<
  Message extends ChatProjectionMessage = ChatProjectionMessage,
  RuntimeSummary = unknown,
>(): ChatLoopController<Message, RuntimeSummary> {
  // -------------------------------------------------------------------------
  // Internal mutable state (not exposed directly — only via snapshot/subscribe)
  // -------------------------------------------------------------------------
  let messages: Message[] = [];
  let initialEventsByMessageId = new Map<string, ControllerStreamEvent[]>();
  let projectedStreamEventsById = new Map<string, ControllerStreamEvent[]>();
  let projectedAssistantComputationByMessageId = new Map<
    string,
    ProjectedAssistantComputationCached
  >();
  let projectionEventsVersion = 0;
  let projectedTimelineItems: ReadonlyArray<
    ChatProjectedTimelineItem<Message, RuntimeSummary>
  > = [];

  const listeners = new Set<
    (state: ChatLoopProjectionState<Message, RuntimeSummary>) => void
  >();

  // -------------------------------------------------------------------------
  // Snapshot construction — always returns a new object reference
  // -------------------------------------------------------------------------
  const buildSnapshot = (): ChatLoopProjectionState<Message, RuntimeSummary> => ({
    messages,
    initialEventsByMessageId,
    projectedStreamEventsById,
    projectionEventsVersion,
    projectedTimelineItems,
  });

  let currentSnapshot = buildSnapshot();

  // -------------------------------------------------------------------------
  // Notification — rebuild snapshot, then call all listeners
  // -------------------------------------------------------------------------
  const notify = () => {
    currentSnapshot = buildSnapshot();
    for (const listener of listeners) {
      listener(currentSnapshot);
    }
  };

  // -------------------------------------------------------------------------
  // Timeline recomputation (called after any state mutation)
  // -------------------------------------------------------------------------
  const recomputeTimeline = (opts?: {
    optimisticSteerMessages?: Message[];
    runtimeSummariesByMessageId?: ReadonlyMap<string, RuntimeSummary>;
    composerSteerAck?: ChatProjectionSteerAck | null;
  }) => {
    projectedTimelineItems = buildProjectedTimeline<Message, RuntimeSummary>({
      timeline: messages,
      optimisticSteerMessages: opts?.optimisticSteerMessages,
      runtimeSummariesByMessageId: opts?.runtimeSummariesByMessageId,
      composerSteerAck: opts?.composerSteerAck,
      getAssistantComputation: getProjectedAssistantComputation,
    });
  };

  // -------------------------------------------------------------------------
  // Projection helpers (internal — no domain strings)
  // -------------------------------------------------------------------------
  const buildComputationSignature = (message: Message, events: ControllerStreamEvent[]): string => {
    const lastSequence =
      events.length > 0 ? Number(events[events.length - 1]?.sequence ?? 0) : 0;
    return [
      message._streamId ?? message.id,
      message._localStatus ?? '',
      message.content ? message.content.length : 0,
      events.length,
      Number.isFinite(lastSequence) ? lastSequence : 0,
    ].join(':');
  };

  const getProjectionEventsForMessage = (message: Message): ControllerStreamEvent[] => {
    const streamId = message._streamId ?? message.id;
    const projected = projectedStreamEventsById.get(streamId);
    if (projected && projected.length > 0) return projected;
    const hydrated = initialEventsByMessageId.get(streamId);
    if (hydrated && hydrated.length > 0) return hydrated;
    return [];
  };

  const getProjectedAssistantComputation = (
    message: Message,
  ): ChatProjectionComputation => {
    const messageId = String(message.id ?? '').trim();
    const projectionEvents = getProjectionEventsForMessage(message);
    const signature = buildComputationSignature(message, projectionEvents);
    const cached = projectedAssistantComputationByMessageId.get(messageId);
    if (cached?.signature === signature) {
      return { segments: cached.segments, linkedSteerCount: cached.linkedSteerCount };
    }

    const segments = projectAssistantRunSegments(projectionEvents);
    const next: ProjectedAssistantComputationCached = {
      signature,
      segments,
      linkedSteerCount: countLinkedSteerMessages(projectionEvents),
    };
    projectedAssistantComputationByMessageId = new Map(
      projectedAssistantComputationByMessageId,
    );
    projectedAssistantComputationByMessageId.set(messageId, next);
    return { segments: next.segments, linkedSteerCount: next.linkedSteerCount };
  };

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const subscribe = (
    listener: (state: ChatLoopProjectionState<Message, RuntimeSummary>) => void,
  ): (() => void) => {
    listeners.add(listener);
    // Emit current state immediately (Svelte store contract)
    listener(currentSnapshot);
    return () => listeners.delete(listener);
  };

  const getSnapshot = (): ChatLoopProjectionState<Message, RuntimeSummary> =>
    currentSnapshot;

  // -- Message mutations -----------------------------------------------------

  const setMessages = (next: Message[]): void => {
    messages = next;
    recomputeTimeline();
    notify();
  };

  const appendMessage = (message: Message): void => {
    messages = [...messages, message];
    recomputeTimeline();
    notify();
  };

  const patchMessage = (id: string, patch: Partial<Message>): boolean => {
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    const updated = { ...messages[idx], ...patch } as Message;
    messages = [...messages.slice(0, idx), updated, ...messages.slice(idx + 1)];
    recomputeTimeline();
    notify();
    return true;
  };

  const filterMessages = (keepIds: Set<string>): void => {
    messages = messages.filter((m) => keepIds.has(m.id));
    recomputeTimeline();
    notify();
  };

  // -- Projection event mutations --------------------------------------------

  const mergeHistoryEvents = (
    messageId: string,
    events: ControllerStreamEvent[],
  ): void => {
    if (!messageId) return;
    initialEventsByMessageId = new Map(initialEventsByMessageId);
    initialEventsByMessageId.set(
      messageId,
      mergeProjectionHistoryEvents(
        initialEventsByMessageId.get(messageId) ?? [],
        events,
      ),
    );
    // Invalidate cached computation so next call recomputes
    projectedAssistantComputationByMessageId = new Map(
      projectedAssistantComputationByMessageId,
    );
    projectedAssistantComputationByMessageId.delete(messageId);
    projectionEventsVersion += 1;
    recomputeTimeline();
    notify();
  };

  const mergeProjectedHistoryForStream = (
    streamId: string,
    events: ControllerStreamEvent[],
  ): void => {
    if (!streamId) return;
    projectedStreamEventsById = new Map(projectedStreamEventsById);
    projectedStreamEventsById.set(
      streamId,
      mergeProjectionHistoryEvents(
        projectedStreamEventsById.get(streamId) ?? [],
        events,
      ),
    );
    projectionEventsVersion += 1;
    recomputeTimeline();
    notify();
  };

  const appendProjectedLiveEvent = (
    streamId: string,
    event: ControllerStreamEvent,
  ): void => {
    if (!streamId) return;
    projectedStreamEventsById = new Map(projectedStreamEventsById);
    projectedStreamEventsById.set(
      streamId,
      appendLiveProjectionEvent(
        projectedStreamEventsById.get(streamId) ?? [],
        event,
      ),
    );
    projectionEventsVersion += 1;
    recomputeTimeline();
    notify();
  };

  const clearProjectedEventsForStream = (streamId: string): void => {
    if (!projectedStreamEventsById.has(streamId)) return;
    projectedStreamEventsById = new Map(projectedStreamEventsById);
    projectedStreamEventsById.delete(streamId);
    projectionEventsVersion += 1;
    recomputeTimeline();
    notify();
  };

  const resetProjectionState = (): void => {
    initialEventsByMessageId = new Map();
    projectedStreamEventsById = new Map();
    projectedAssistantComputationByMessageId = new Map();
    projectionEventsVersion = 0;
    recomputeTimeline();
    notify();
  };

  const invalidateComputationCache = (messageId: string): void => {
    if (!projectedAssistantComputationByMessageId.has(messageId)) return;
    projectedAssistantComputationByMessageId = new Map(
      projectedAssistantComputationByMessageId,
    );
    projectedAssistantComputationByMessageId.delete(messageId);
    // No notify here — timeline will pick up the change on next buildTimeline call
  };

  // -- Projection queries ----------------------------------------------------

  const isTrackedAssistantStreamId = (streamId: string): boolean =>
    messages.some(
      (message) =>
        message.role === 'assistant' &&
        (message._streamId ?? message.id) === streamId,
    );

  const buildTimeline = (opts?: {
    optimisticSteerMessages?: Message[];
    runtimeSummariesByMessageId?: ReadonlyMap<string, RuntimeSummary>;
    composerSteerAck?: ChatProjectionSteerAck | null;
  }): ReadonlyArray<ChatProjectedTimelineItem<Message, RuntimeSummary>> => {
    recomputeTimeline(opts);
    return projectedTimelineItems;
  };

  // -------------------------------------------------------------------------
  // Initial timeline build (empty state)
  // -------------------------------------------------------------------------
  recomputeTimeline();
  currentSnapshot = buildSnapshot();

  return {
    getSnapshot,
    subscribe,
    setMessages,
    appendMessage,
    patchMessage,
    filterMessages,
    mergeHistoryEvents,
    mergeProjectedHistoryForStream,
    appendProjectedLiveEvent,
    clearProjectedEventsForStream,
    resetProjectionState,
    invalidateComputationCache,
    getProjectionEventsForMessage,
    getProjectedAssistantComputation,
    isTrackedAssistantStreamId,
    buildTimeline,
  };
}
