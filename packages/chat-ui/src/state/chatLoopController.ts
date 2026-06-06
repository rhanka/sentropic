/**
 * chatLoopController — headless, framework-neutral controller for the chat loop.
 *
 * Slice 1B scope: owns message list and projection state.
 *   - messages[]
 *   - initialEventsByMessageId  (batch history events from session history ndjson)
 *   - projectedStreamEventsById (live stream events accumulated per stream)
 *   - projectedAssistantComputationByMessageId (signature cache)
 *   - projectionEventsVersion (bump counter driving timeline recomputation)
 *
 * Slice 1C adds: live stream subscription lifecycle.
 *   - attachStream({ streamClient, pollJob, onProjectionEvent?, onTerminal? })
 *   - detachStream()
 *   The controller subscribes to the host stream client, routes projection events
 *   into its own appendProjectedLiveEvent, marks assistant messages
 *   completed/failed on terminal events, and runs the job-poll fallback via
 *   the injected pollJob function.
 *
 * Later slices add: send/steer (1D), local-tool (1E), model (1F).
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
 *   - attachStream callbacks (onProjectionEvent, onTerminal) are called AFTER the
 *     controller has mutated state — so the host can trigger side-effects (scroll)
 *     after the new projection is already in the snapshot.
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
// Stream subscription API — slice 1C
// ---------------------------------------------------------------------------

/**
 * Minimal stream client surface the controller needs for subscription lifecycle.
 * Structurally compatible with StreamHubClient from '@sentropic/chat-ui/client'.
 * Using a structural subtype here keeps the controller independent of the
 * StreamHubClient import (allows testing with a plain fake object).
 *
 * The event handler accepts `unknown` so the controller can be wired to any
 * host event emitter without importing the host's concrete event type.
 * Internally, the controller casts the event to a record and reads fields
 * defensively (String(raw.streamId ?? '')).
 */
export type ControllerStreamClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(key: string, onEvent: (event: any) => void): void;
  delete(key: string): void;
};

/**
 * Job-poll function injected by the host (maps to ChatCoreHost.pollJob).
 * The controller calls this as a fallback when SSE terminal events are missed.
 */
export type ControllerPollJob = (jobId: string) => Promise<{ status?: string }>;

/**
 * Options for attachStream.
 *
 * - streamClient: the host StreamHub (or any compatible set/delete client)
 * - pollJob:      host's pollJob function (fallback when SSE terminal is missed)
 * - onProjectionEvent: optional callback invoked AFTER each event is appended
 *     to the controller's projectedStreamEventsById. Use for scroll scheduling.
 * - onTerminal:   optional callback invoked AFTER the target message is patched
 *     to completed/failed. Use for forced-scroll scheduling.
 * - pollTimeoutMs: max ms to poll before giving up (default 60 000).
 * - pollInitialDelayMs: delay before first poll attempt (default 750).
 * - pollIntervalMs: interval between poll attempts (default 800).
 */
export type AttachStreamOptions = {
  streamClient: ControllerStreamClient;
  pollJob: ControllerPollJob;
  onProjectionEvent?: (streamId: string) => void;
  onTerminal?: (streamId: string, outcome: 'done' | 'error') => void;
  pollTimeoutMs?: number;
  pollInitialDelayMs?: number;
  pollIntervalMs?: number;
};

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

  // -- Stream subscription lifecycle (slice 1C) ----------------------------

  /**
   * Attach the controller to a live stream client.
   *
   * Registers a hub subscription that routes projection stream events into the
   * controller's own appendProjectedLiveEvent. On terminal events ('done' /
   * 'error'), patches the matching assistant message to completed/failed and
   * triggers the optional onTerminal callback.
   *
   * Also starts a job-poll fallback loop via the injected pollJob (matching the
   * behavior of AppChatPanel's pollJobUntilTerminal). The poll loop exits early
   * if the message has already been marked terminal or hydrated by SSE.
   *
   * Safe to call multiple times — calling attachStream while already attached
   * detaches the previous subscription first (same semantics as a hot-swap).
   */
  attachStream(opts: AttachStreamOptions): void;

  /**
   * Detach the stream subscription registered by attachStream.
   * Removes the hub key from the stream client. Safe to call when not attached.
   */
  detachStream(): void;

  /**
   * Trigger the job-poll fallback for a specific job + stream id.
   * Called by AppChatPanel after sendMessage / retryMessage to start the
   * background poll loop (matches AppChatPanel's pollJobUntilTerminal call-site).
   * No-ops if no stream is attached or the job is already being polled.
   */
  startJobPoll(
    jobId: string,
    streamId: string,
    opts?: { timeoutMs?: number },
  ): void;
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

  // -------------------------------------------------------------------------
  // Stream subscription state (slice 1C)
  // -------------------------------------------------------------------------
  let streamHubKey: string | null = null;
  let attachedClient: ControllerStreamClient | null = null;
  let attachedPollJob: ControllerPollJob | null = null;
  let attachedOnProjectionEvent: ((streamId: string) => void) | null = null;
  let attachedOnTerminal: ((streamId: string, outcome: 'done' | 'error') => void) | null = null;
  let attachedPollTimeoutMs = 60_000;
  let attachedPollInitialDelayMs = 750;
  let attachedPollIntervalMs = 800;
  const jobPollInFlight = new Set<string>();

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
  // Stream subscription helpers (slice 1C — framework-neutral, no domain strings)
  // -------------------------------------------------------------------------

  /**
   * Internal: called when the stream client emits an event.
   * Mirrors AppChatPanel's handleProjectionStreamEvent:
   *   - guard: must have a streamId + finite sequence + be a tracked stream
   *   - append the event to projectedStreamEventsById
   *   - on terminal (done/error): patch the target message + call onTerminal
   *   - call onProjectionEvent after each append (for host-side scroll scheduling)
   */
  const handleIncomingStreamEvent = (rawUnknown: unknown): void => {
    const raw =
      rawUnknown && typeof rawUnknown === 'object'
        ? (rawUnknown as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const streamId = String(raw.streamId ?? '').trim();
    if (!streamId || !isTrackedAssistantStreamId(streamId)) return;
    const sequence = Number(raw.sequence);
    if (!Number.isFinite(sequence)) return;

    const eventType = String(raw.type ?? '').trim();
    appendProjectedLiveEvent(streamId, {
      eventType,
      data: (raw.data as Record<string, unknown>) ?? {},
      sequence,
      createdAt: undefined,
    });

    // Call the host callback AFTER the state mutation (scroll scheduling)
    attachedOnProjectionEvent?.(streamId);

    if (eventType === 'done' || eventType === 'error') {
      handleStreamTerminal(streamId, eventType as 'done' | 'error');
    }
  };

  /**
   * Internal: marks the matching assistant message as completed/failed.
   * Mirrors AppChatPanel's handleAssistantTerminal.
   */
  const handleStreamTerminal = (streamId: string, outcome: 'done' | 'error'): void => {
    const target = messages.find((m) => (m._streamId ?? m.id) === streamId);
    if (target) {
      patchMessage(target.id, {
        _localStatus: outcome === 'done' ? 'completed' : 'failed',
      } as Partial<Message>);
    }
    // Call the host callback AFTER the state mutation (force-scroll scheduling)
    attachedOnTerminal?.(streamId, outcome);
  };

  /**
   * Internal: job-poll fallback loop.
   * Mirrors AppChatPanel's pollJobUntilTerminal.
   * Exits early if:
   *   - the message is already hydrated (has content) or terminal
   *   - the job reaches completed/failed status from the poll endpoint
   *   - the timeout elapses
   */
  const runJobPollLoop = async (
    jobId: string,
    streamId: string,
    opts?: { timeoutMs?: number },
  ): Promise<void> => {
    if (!jobId || !streamId) return;
    if (jobPollInFlight.has(jobId)) return;
    const pollFn = attachedPollJob;
    if (!pollFn) return;

    jobPollInFlight.add(jobId);
    const timeoutMs = opts?.timeoutMs ?? attachedPollTimeoutMs;
    const startedAt = Date.now();

    try {
      // Small initial delay — if SSE arrives first, avoid unnecessary polling.
      await new Promise<void>((r) => setTimeout(r, attachedPollInitialDelayMs));

      while (Date.now() - startedAt < timeoutMs) {
        const current = messages.find((m) => (m._streamId ?? m.id) === streamId);
        if (!current) return;
        // Already hydrated or terminal — stop polling
        if (current.content && current.content.trim().length > 0) return;
        if (
          current._localStatus === 'completed' ||
          current._localStatus === 'failed'
        )
          return;

        const job = await pollFn(jobId);
        const status = String(job.status ?? 'unknown');

        if (status === 'completed') {
          handleStreamTerminal(streamId, 'done');
          return;
        }
        if (status === 'failed') {
          handleStreamTerminal(streamId, 'error');
          return;
        }
        // pending/processing — wait before next attempt
        await new Promise<void>((r) => setTimeout(r, attachedPollIntervalMs));
      }
    } catch {
      // ignore — poll is best-effort fallback
    } finally {
      jobPollInFlight.delete(jobId);
    }
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

  // -- Stream subscription lifecycle (slice 1C) ----------------------------------

  const attachStream = (opts: AttachStreamOptions): void => {
    // If already attached, detach first (hot-swap semantics)
    detachStream();

    const key = `ctrl-projection:${Math.random().toString(36).slice(2)}`;
    attachedClient = opts.streamClient;
    attachedPollJob = opts.pollJob;
    attachedOnProjectionEvent = opts.onProjectionEvent ?? null;
    attachedOnTerminal = opts.onTerminal ?? null;
    attachedPollTimeoutMs = opts.pollTimeoutMs ?? 60_000;
    attachedPollInitialDelayMs = opts.pollInitialDelayMs ?? 750;
    attachedPollIntervalMs = opts.pollIntervalMs ?? 800;
    streamHubKey = key;

    opts.streamClient.set(key, handleIncomingStreamEvent);
  };

  const detachStream = (): void => {
    if (streamHubKey && attachedClient) {
      attachedClient.delete(streamHubKey);
    }
    streamHubKey = null;
    attachedClient = null;
    attachedPollJob = null;
    attachedOnProjectionEvent = null;
    attachedOnTerminal = null;
  };

  const startJobPoll = (
    jobId: string,
    streamId: string,
    opts?: { timeoutMs?: number },
  ): void => {
    void runJobPollLoop(jobId, streamId, opts);
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
    attachStream,
    detachStream,
    startJobPoll,
  };
}
