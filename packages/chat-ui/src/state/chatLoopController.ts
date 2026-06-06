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
 * Slice 1D adds: message lifecycle orchestration (send / bootstrap / retry / stop / edit / feedback).
 *   - attachHost({ transport }) — inject the host transport (send/retry/stop/edit/setFeedback)
 *   - send(payload, opts) — call host transport, build optimistic messages, wire stream/poll
 *   - bootstrapRun(input) — optimistic assistant message insertion + startJobPoll
 *   - retry(messageId, opts) — call host retryMessage + bootstrapRun
 *   - stop(messageId) — call host stopMessage
 *   - edit(messageId, content) — call host editMessage + patchMessage content
 *   - setFeedback(messageId, vote) — call host setFeedback + patchMessage feedbackVote
 *
 *   App-side concerns kept in AppChatPanel (NOT moved here):
 *     - historyTimelineItems truncation on retry (Svelte state, not Message[])
 *     - followBottom / scheduleScrollToBottom (DOM concern)
 *     - createTurnCheckpoint (Lot 2 checkpoint intercept)
 *     - input clearing / composer height reset / attachment assembly (composer UX)
 *     - sessionId auto-select / sessions list update after first sendMessage
 *     - errorMsg / formatApiError presentation
 *     - copyToClipboard (browser API, not host-coupled)
 *
 * Slice 1E adds: local-tool execution state machine.
 *   - attachLocalToolMachine(opts) — inject executor, decider, result-poster,
 *     isRuntimeAvailable predicate, isLocalToolName predicate, and retryable-error
 *     predicate. Controller owns: localToolStatesById, localToolInFlight,
 *     localToolExecutionTimersById, pendingLocalToolPermissionPrompts,
 *     localToolPermissionRetriesInFlight.
 *   - detachLocalToolMachine() — clear all local-tool state + timers.
 *   - handleLocalToolStreamEvent(event) — route an incoming stream event through
 *     the local-tool machine (called from the app-side streamHub subscription).
 *   - decideLocalToolPermission(prompt, decision) — handle user permission decision.
 *   - Snapshot gains: localToolStatesById, pendingLocalToolPermissionPrompts.
 *
 *   App-side concerns kept in AppChatPanel (NOT moved here):
 *     - streamHub subscription key lifecycle (set/delete in onMount/onDestroy)
 *     - resolvePermissionPromptDetails (i18n labels — Svelte-specific)
 *     - extensionActiveTabContext (browser-specific, drives context labels)
 *     - the LocalToolPermissionRequiredError class import (app-level error types)
 *
 * Later slices add: steer (1F).
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
 *   - attachHost is a separate call from attachStream so stream and transport can
 *     be wired independently (e.g., stream attached in onMount; transport at
 *     construction time). Both are hot-swappable.
 *   - bootstrapRun is PUBLIC so AppChatPanel can call it directly for the
 *     truncateAfterMessageId path (which requires app-side historyTimelineItems
 *     manipulation before the controller's message list is updated).
 *     This keeps the split clean without duplicating logic.
 *   - Local-tool machine (slice 1E): executor/decider/poster are injected via
 *     attachLocalToolMachine — the controller is agnostic of the chrome extension
 *     runtime and the host-specific ApiError shape. The app supplies predicates
 *     (isLocalToolName, isLocalToolRuntimeAvailable, isRetryableLocalToolError)
 *     and callbacks (executeLocalTool, decideLocalToolPermission, postLocalToolResult).
 *     The LocalToolPermissionRequiredError class is identified by a caller-supplied
 *     predicate (isLocalToolPermissionRequired) so the controller does not import it.
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
// Host transport surface — slice 1D
// ---------------------------------------------------------------------------

/**
 * Minimal payload for sending a new message.
 * Structurally compatible with ChatCoreHost.sendMessage payload.
 * Using a structural subtype keeps the controller independent of the
 * concrete host import.
 */
export type ControllerSendPayload = {
  sessionId?: string;
  content: string;
  providerId?: string;
  model?: string;
  primaryContextType?: string;
  primaryContextId?: string;
  contexts?: Array<{ contextType: string; contextId: string }>;
  tools?: string[];
  localToolDefinitions?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  attachments?: Array<{
    kind: 'image' | 'file';
    source: 'context_document';
    documentId: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
};

/**
 * Handle returned by sendMessage / retryMessage on the host transport.
 * Structurally compatible with ChatCoreHost RunHandle.
 */
export type ControllerRunHandle = {
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  streamId: string;
  jobId: string;
};

/**
 * Minimal host transport surface the controller needs for message lifecycle.
 * Structurally compatible with ChatCoreHost — the controller does NOT import
 * ChatCoreHost directly so it stays host-agnostic.
 */
export type ControllerHostTransport = {
  sendMessage(payload: ControllerSendPayload): Promise<ControllerRunHandle>;
  retryMessage(
    messageId: string,
    opts: { providerId: string; model: string },
  ): Promise<ControllerRunHandle>;
  stopMessage(messageId: string): Promise<void>;
  editMessage(messageId: string, content: string): Promise<void>;
  setFeedback(messageId: string, vote: 'up' | 'down' | 'clear'): Promise<void>;
};

/**
 * Options for attachHost (slice 1D).
 */
export type AttachHostOptions = {
  transport: ControllerHostTransport;
};

/**
 * Input for bootstrapRun (slice 1D).
 *
 * The controller handles the Message-list mutation + startJobPoll.
 * App-side is responsible for:
 *   - historyTimelineItems truncation (Svelte state) BEFORE calling bootstrapRun
 *     when truncateAfterMessageId is set.
 *   - scroll side-effects and checkpoint creation AFTER bootstrapRun returns.
 *
 * The controller builds the assistant message using buildAssistantMessage.
 * Callers may provide a `buildAssistantMessage` factory to stamp any
 * host-specific fields (e.g. sessionId, model) onto the base shape —
 * this keeps the controller generic over the Message type parameter.
 */
export type BootstrapRunInput<Message extends ChatProjectionMessage> = {
  sessionId: string;
  assistantMessageId: string;
  streamId: string;
  jobId: string;
  /**
   * Factory: build the new optimistic assistant message.
   * Receives the base fields the controller always sets, plus the sessionId
   * from the BootstrapRunInput (which on the send path is the post-host-call
   * sessionId from the RunHandle). Callers stamp model and any other
   * host-specific fields on top of the base.
   */
  buildAssistantMessage: (base: {
    id: string;
    sessionId: string;
    _streamId: string;
    _localStatus: 'processing';
    role: 'assistant';
    content: null;
    createdAt: string;
  }) => Message;
  /**
   * Optional user message to prepend (new-session send path).
   * When set, controller calls setMessages([...messages, userMsg, assistantMsg]).
   */
  userMessage?: Message;
  /**
   * When set (retry path), controller truncates messages to everything up to
   * and including this id, then appends assistantMsg.
   * App-side MUST truncate historyTimelineItems BEFORE calling bootstrapRun.
   */
  truncateAfterMessageId?: string;
  /**
   * Job poll timeout override (default 90 000 ms).
   */
  pollTimeoutMs?: number;
};

/**
 * Result returned by bootstrapRun and send/retry — exposes the optimistic
 * assistant message so app-side can schedule scroll and checkpoint creation
 * without re-reading controller state.
 */
export type BootstrapRunResult<Message extends ChatProjectionMessage> = {
  assistantMessage: Message;
  handle: ControllerRunHandle;
};

// ---------------------------------------------------------------------------
// Projected assistant computation (with signature for the cache)
// ---------------------------------------------------------------------------
type ProjectedAssistantComputationCached = ChatProjectionComputation & {
  /** Cache key — computed from message id, local status, content length, event count, last sequence. */
  signature: string;
};

// ---------------------------------------------------------------------------
// Local-tool state machine types — slice 1E
// ---------------------------------------------------------------------------

/**
 * Internal state for a buffered local-tool call in flight.
 * Mirrors AppChatPanel's LocalToolStreamState — kept framework-neutral.
 */
export type ControllerLocalToolStreamState = {
  streamId: string;
  name: string;
  argsText: string;
  lastSequence: number;
  firstSeenAt: number;
  executed: boolean;
};

/**
 * Permission prompt surfaced when executeLocalTool throws a
 * LocalToolPermissionRequiredError. App renders these as permission UI.
 */
export type ControllerLocalToolPermissionPrompt = {
  toolCallId: string;
  streamId: string;
  name: string;
  args: unknown;
  /** The permission request payload returned by the runtime (opaque to the controller). */
  request: {
    requestId: string;
    toolName: string;
    origin: string;
    details?: Record<string, unknown>;
  };
  createdAt: number;
};

/**
 * Executor function injected by the app (wraps chrome.runtime.sendMessage / VSCode bridge).
 * Must throw an error satisfying `isLocalToolPermissionRequired` when a permission
 * prompt is needed. The controller does NOT import the concrete error class.
 */
export type ControllerLocalToolExecutorFn = (
  toolCallId: string,
  name: string,
  args: unknown,
  opts: { streamId: string },
) => Promise<unknown>;

/**
 * Permission decision function injected by the app (wraps decideLocalToolPermission).
 */
export type ControllerLocalToolPermissionDeciderFn = (
  requestId: string,
  decision: string,
) => Promise<void>;

/**
 * Result poster injected by the app (wraps chatCoreHost.postLocalToolResult with retry).
 * App-side handles the ApiError retry logic so the controller stays transport-agnostic.
 */
export type ControllerLocalToolResultPosterFn = (
  streamId: string,
  toolCallId: string,
  result: unknown,
) => Promise<void>;

/**
 * Options for attachLocalToolMachine (slice 1E).
 *
 * - executeLocalTool: calls the extension runtime to execute a local tool.
 *     Throws an error satisfying isLocalToolPermissionRequired when approval needed.
 * - decideLocalToolPermission: sends the user's permission decision to the runtime.
 * - postLocalToolResult: posts the tool result back to the stream (with retry on the app side).
 * - isLocalToolName: predicate — true when the name is a recognized local tool name.
 * - isLocalToolRuntimeAvailable: predicate — true when the extension runtime is present.
 * - isLocalToolPermissionRequired: predicate — true when an error is a
 *     LocalToolPermissionRequiredError and the controller should extract `error.request`.
 *     The controller uses this to avoid importing the concrete error class.
 * - getPermissionRequest: extract the permission request from a LocalToolPermissionRequiredError.
 *     Called only when isLocalToolPermissionRequired returns true.
 */
export type AttachLocalToolMachineOptions = {
  executeLocalTool: ControllerLocalToolExecutorFn;
  decideLocalToolPermission: ControllerLocalToolPermissionDeciderFn;
  postLocalToolResult: ControllerLocalToolResultPosterFn;
  isLocalToolName: (name: string) => boolean;
  isLocalToolRuntimeAvailable: () => boolean;
  isLocalToolPermissionRequired: (error: unknown) => boolean;
  getPermissionRequest: (error: unknown) => ControllerLocalToolPermissionPrompt['request'];
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
  /**
   * Local-tool execution state per toolCallId (slice 1E).
   * ReadonlyMap — mutations go through the controller's local-tool machine.
   */
  readonly localToolStatesById: ReadonlyMap<string, ControllerLocalToolStreamState>;
  /**
   * Permission prompts awaiting user decision (slice 1E).
   * App renders these as permission UI; decisions go through ctrl.decideLocalToolPermission.
   */
  readonly pendingLocalToolPermissionPrompts: readonly ControllerLocalToolPermissionPrompt[];
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

  // -- Host transport lifecycle (slice 1D) ------------------------------------

  /**
   * Attach a host transport to the controller (slice 1D).
   *
   * The transport provides the REST verbs (sendMessage, retryMessage, stopMessage,
   * editMessage, setFeedback) that the controller calls when driving lifecycle
   * methods. Structurally compatible with ChatCoreHost — no concrete import.
   *
   * Safe to call multiple times — replaces any previously attached transport.
   * Safe to call before attachStream (transport and stream are independent).
   */
  attachHost(opts: AttachHostOptions): void;

  /**
   * Detach the host transport. Safe to call when no transport is attached.
   */
  detachHost(): void;

  /**
   * Optimistic assistant message insertion + job-poll start (slice 1D).
   *
   * Builds the assistant message using the caller-supplied factory, inserts it
   * into the message list (append, prepend-with-user, or truncate-after),
   * and starts the background job-poll fallback.
   *
   * App-side responsibilities (AFTER this call returns):
   *   - followBottom = true + scheduleScrollToBottom
   *   - createTurnCheckpoint (Lot 2 intercept — keep in AppChatPanel)
   *   - When truncateAfterMessageId is set, truncate historyTimelineItems
   *     BEFORE calling bootstrapRun.
   *
   * Returns { assistantMessage, handle } so the caller can read the
   * committed assistant message without re-scanning messages[].
   */
  bootstrapRun(
    input: BootstrapRunInput<Message>,
  ): BootstrapRunResult<Message>;

  /**
   * Send a new user message via the host transport and bootstrap the run (slice 1D).
   *
   * Orchestration:
   *   1. Calls host.sendMessage(payload)
   *   2. Calls bootstrapRun with the RunHandle + caller-supplied userMessage factory
   *   3. Returns { handle, assistantMessage } for app-side side-effects
   *
   * App-side responsibilities after this call resolves:
   *   - Input clearing / composer height reset / attachment clear
   *   - sessionId update (res.sessionId may be new)
   *   - sessions list prepend for new sessions
   *   - errorMsg on catch
   *   - sending flag management
   *   - followBottom + scroll + createTurnCheckpoint (via bootstrapRun return)
   *
   * Throws on transport failure — caller wraps in try/catch.
   */
  send(
    payload: ControllerSendPayload,
    opts: {
      buildUserMessage: (handle: ControllerRunHandle) => Message;
      buildAssistantMessage: BootstrapRunInput<Message>['buildAssistantMessage'];
      pollTimeoutMs?: number;
    },
  ): Promise<BootstrapRunResult<Message> & { handle: ControllerRunHandle }>;

  /**
   * Retry an existing message via the host transport and bootstrap the run (slice 1D).
   *
   * Orchestration:
   *   1. Calls host.retryMessage(messageId, opts)
   *   2. Calls bootstrapRun with truncateAfterMessageId = messageId
   *   3. Returns { handle, assistantMessage }
   *
   * App-side responsibilities after this call resolves:
   *   - historyTimelineItems truncation BEFORE calling (must be done before call)
   *     → Actually: bootstrapRun handles messages[]; app must sync historyTimelineItems
   *       if needed (retry path: app truncates historyTimelineItems, THEN calls retry)
   *   - followBottom + scroll + errorMsg on catch
   *
   * NOTE: app-side truncates historyTimelineItems before calling retry.
   *   The controller truncates messages[] inside bootstrapRun.
   *
   * Throws on transport failure — caller wraps in try/catch.
   */
  retry(
    messageId: string,
    opts: {
      providerId: string;
      model: string;
      buildAssistantMessage: BootstrapRunInput<Message>['buildAssistantMessage'];
      pollTimeoutMs?: number;
    },
  ): Promise<BootstrapRunResult<Message>>;

  /**
   * Stop the active assistant generation via the host transport (slice 1D).
   *
   * Calls host.stopMessage(messageId).
   * App-side manages stoppingMessageId flag + errorMsg on catch.
   *
   * Throws on transport failure — caller wraps in try/catch.
   */
  stop(messageId: string): Promise<void>;

  /**
   * Edit a user message content via the host transport (slice 1D).
   *
   * Orchestration:
   *   1. Calls host.editMessage(messageId, content)
   *   2. Patches the message content in the controller's message list
   *
   * App-side calls cancelEditMessage() + retry(messageId) after this resolves.
   * Throws on transport failure — caller wraps in try/catch.
   */
  edit(messageId: string, content: string): Promise<void>;

  /**
   * Submit feedback on an assistant message via the host transport (slice 1D).
   *
   * Orchestration:
   *   1. Calls host.setFeedback(messageId, vote)
   *   2. Patches the message feedbackVote in the controller's message list
   *
   * App-side manages errorMsg on catch.
   * Throws on transport failure — caller wraps in try/catch.
   */
  setFeedback(messageId: string, vote: 'up' | 'down' | 'clear'): Promise<void>;

  // -- Local-tool state machine (slice 1E) ------------------------------------

  /**
   * Attach the local-tool execution machine (slice 1E).
   *
   * Injects:
   *   - executeLocalTool — calls the extension runtime to run a tool.
   *   - decideLocalToolPermission — sends user decision to the runtime.
   *   - postLocalToolResult — posts tool result back to the stream (app handles retry).
   *   - isLocalToolName — predicate to identify local tool names.
   *   - isLocalToolRuntimeAvailable — predicate to check runtime availability.
   *   - isLocalToolPermissionRequired — identifies LocalToolPermissionRequiredError.
   *   - getPermissionRequest — extracts the request from the error.
   *
   * The controller takes ownership of:
   *   - localToolStatesById (Map<toolCallId, state>)
   *   - localToolInFlight (Set<toolCallId>)
   *   - localToolExecutionTimersById (Map<toolCallId, timer>)
   *   - pendingLocalToolPermissionPrompts (array)
   *   - localToolPermissionRetriesInFlight (Set<toolCallId>)
   *
   * Safe to call multiple times — replaces any previously attached machine.
   */
  attachLocalToolMachine(opts: AttachLocalToolMachineOptions): void;

  /**
   * Reset local-tool machine state without detaching injected functions (slice 1E).
   *
   * Clears all in-flight state (timers, state maps, permission prompts, in-flight sets)
   * but keeps the executor/decider/poster/predicate injections intact.
   * Use this on session change or session deletion to start fresh while keeping
   * the machine ready for the next session.
   *
   * Notifies listeners (snapshot gains empty local-tool state).
   */
  resetLocalToolMachineState(): void;

  /**
   * Detach and reset the local-tool machine (slice 1E).
   * Clears all timers, resets all state maps, AND clears injected functions.
   * Call this on component destroy (after detachLocalToolMachine the machine
   * will not execute any further tools until re-attached).
   * Safe to call when not attached.
   */
  detachLocalToolMachine(): void;

  /**
   * Route an incoming stream event through the local-tool machine (slice 1E).
   *
   * Called from the app-side streamHub handler (the app keeps the hub subscription
   * key lifecycle). The controller processes:
   *   - 'status': awaiting_local_tool_results / local_tool_result_received / response_created
   *   - 'done' / 'error': clear local-tool state for the stream
   *   - 'tool_call_start' / 'tool_call_delta': buffer args + schedule execution
   *
   * No-ops when no local-tool machine is attached.
   */
  handleLocalToolStreamEvent(event: unknown): void;

  /**
   * Handle a user permission decision for a pending local-tool prompt (slice 1E).
   *
   * Mirrors AppChatPanel's handleLocalToolPermissionDecision:
   *   1. Calls decideLocalToolPermission(requestId, decision).
   *   2. Removes the prompt from pendingLocalToolPermissionPrompts.
   *   3. On deny: posts an error result.
   *   4. On allow: re-executes the tool; on permission-required again, re-queues the prompt.
   *
   * No-ops if a decision for this toolCallId is already in flight.
   */
  decideLocalToolPermission(
    prompt: ControllerLocalToolPermissionPrompt,
    decision: string,
  ): Promise<void>;
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
  // Local-tool machine state (slice 1E)
  // -------------------------------------------------------------------------
  let ltExecuteLocalTool: ControllerLocalToolExecutorFn | null = null;
  let ltDecideLocalToolPermission: ControllerLocalToolPermissionDeciderFn | null = null;
  let ltPostLocalToolResult: ControllerLocalToolResultPosterFn | null = null;
  let ltIsLocalToolName: ((name: string) => boolean) | null = null;
  let ltIsLocalToolRuntimeAvailable: (() => boolean) | null = null;
  let ltIsLocalToolPermissionRequired: ((error: unknown) => boolean) | null = null;
  let ltGetPermissionRequest: ((error: unknown) => ControllerLocalToolPermissionPrompt['request']) | null = null;

  const ltLocalToolStatesById = new Map<string, ControllerLocalToolStreamState>();
  const ltLocalToolInFlight = new Set<string>();
  const ltLocalToolExecutionTimersById = new Map<string, ReturnType<typeof setTimeout>>();
  let ltPendingLocalToolPermissionPrompts: ControllerLocalToolPermissionPrompt[] = [];
  const ltLocalToolPermissionRetriesInFlight = new Set<string>();

  // -------------------------------------------------------------------------
  // Snapshot construction — always returns a new object reference
  // -------------------------------------------------------------------------
  const buildSnapshot = (): ChatLoopProjectionState<Message, RuntimeSummary> => ({
    messages,
    initialEventsByMessageId,
    projectedStreamEventsById,
    projectionEventsVersion,
    projectedTimelineItems,
    localToolStatesById: ltLocalToolStatesById,
    pendingLocalToolPermissionPrompts: ltPendingLocalToolPermissionPrompts,
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
  // Host transport state (slice 1D)
  // -------------------------------------------------------------------------
  let attachedTransport: ControllerHostTransport | null = null;

  // -------------------------------------------------------------------------
  // Host transport lifecycle (slice 1D)
  // -------------------------------------------------------------------------

  const attachHost = (opts: AttachHostOptions): void => {
    attachedTransport = opts.transport;
  };

  const detachHost = (): void => {
    attachedTransport = null;
  };

  // -------------------------------------------------------------------------
  // bootstrapRun — optimistic message insertion + job-poll start (slice 1D)
  // -------------------------------------------------------------------------

  const bootstrapRun = (
    input: BootstrapRunInput<Message>,
  ): BootstrapRunResult<Message> => {
    const nowIso = new Date().toISOString();
    const assistantMessage = input.buildAssistantMessage({
      id: input.assistantMessageId,
      sessionId: input.sessionId,
      _streamId: input.streamId,
      _localStatus: 'processing',
      role: 'assistant',
      content: null,
      createdAt: nowIso,
    });

    if (input.userMessage) {
      // New-session send path: prepend user + assistant
      setMessages([...messages, input.userMessage, assistantMessage]);
    } else if (input.truncateAfterMessageId) {
      // Retry path: truncate messages after the given id, then append assistant.
      // NOTE: app-side MUST have already truncated historyTimelineItems before
      // calling bootstrapRun, since that is Svelte state.
      const userIndex = messages.findIndex(
        (m) => m.id === input.truncateAfterMessageId,
      );
      const truncatedMessages =
        userIndex >= 0
          ? [...messages.slice(0, userIndex + 1), assistantMessage]
          : [...messages, assistantMessage];
      setMessages(truncatedMessages);
    } else {
      // Append path
      appendMessage(assistantMessage);
    }

    const handle: ControllerRunHandle = {
      sessionId: input.sessionId,
      userMessageId: input.userMessage?.id ?? '',
      assistantMessageId: input.assistantMessageId,
      streamId: input.streamId,
      jobId: input.jobId,
    };

    startJobPoll(input.jobId, assistantMessage._streamId ?? assistantMessage.id, {
      timeoutMs: input.pollTimeoutMs ?? 90_000,
    });

    return { assistantMessage, handle };
  };

  // -------------------------------------------------------------------------
  // send — calls host transport, builds optimistic messages, bootstraps run (slice 1D)
  // -------------------------------------------------------------------------

  const send = async (
    payload: ControllerSendPayload,
    opts: {
      buildUserMessage: (handle: ControllerRunHandle) => Message;
      buildAssistantMessage: BootstrapRunInput<Message>['buildAssistantMessage'];
      pollTimeoutMs?: number;
    },
  ): Promise<BootstrapRunResult<Message> & { handle: ControllerRunHandle }> => {
    const transport = attachedTransport;
    if (!transport) throw new Error('chatLoopController: no host transport attached — call attachHost() first');

    const runHandle = await transport.sendMessage(payload);

    const handle: ControllerRunHandle = {
      sessionId: runHandle.sessionId,
      userMessageId: runHandle.userMessageId,
      assistantMessageId: runHandle.assistantMessageId,
      streamId: runHandle.streamId,
      jobId: runHandle.jobId,
    };

    const userMessage = opts.buildUserMessage(handle);

    const result = bootstrapRun({
      sessionId: handle.sessionId,
      assistantMessageId: handle.assistantMessageId,
      streamId: handle.streamId,
      jobId: handle.jobId,
      buildAssistantMessage: opts.buildAssistantMessage,
      userMessage,
      pollTimeoutMs: opts.pollTimeoutMs,
    });

    return { ...result, handle };
  };

  // -------------------------------------------------------------------------
  // retry — calls host transport retryMessage + bootstrapRun (slice 1D)
  // -------------------------------------------------------------------------

  const retry = async (
    messageId: string,
    opts: {
      providerId: string;
      model: string;
      buildAssistantMessage: BootstrapRunInput<Message>['buildAssistantMessage'];
      pollTimeoutMs?: number;
    },
  ): Promise<BootstrapRunResult<Message>> => {
    const transport = attachedTransport;
    if (!transport) throw new Error('chatLoopController: no host transport attached — call attachHost() first');

    const runHandle = await transport.retryMessage(messageId, {
      providerId: opts.providerId,
      model: opts.model,
    });

    return bootstrapRun({
      sessionId: runHandle.sessionId,
      assistantMessageId: runHandle.assistantMessageId,
      streamId: runHandle.streamId,
      jobId: runHandle.jobId,
      buildAssistantMessage: opts.buildAssistantMessage,
      truncateAfterMessageId: messageId,
      pollTimeoutMs: opts.pollTimeoutMs,
    });
  };

  // -------------------------------------------------------------------------
  // stop — calls host transport stopMessage (slice 1D)
  // -------------------------------------------------------------------------

  const stop = async (messageId: string): Promise<void> => {
    const transport = attachedTransport;
    if (!transport) throw new Error('chatLoopController: no host transport attached — call attachHost() first');
    await transport.stopMessage(messageId);
  };

  // -------------------------------------------------------------------------
  // edit — calls host editMessage + patches content in message list (slice 1D)
  // -------------------------------------------------------------------------

  const edit = async (messageId: string, content: string): Promise<void> => {
    const transport = attachedTransport;
    if (!transport) throw new Error('chatLoopController: no host transport attached — call attachHost() first');
    await transport.editMessage(messageId, content);
    patchMessage(messageId, { content } as Partial<Message>);
  };

  // -------------------------------------------------------------------------
  // setFeedback — calls host setFeedback + patches feedbackVote (slice 1D)
  // -------------------------------------------------------------------------

  const setFeedback = async (
    messageId: string,
    vote: 'up' | 'down' | 'clear',
  ): Promise<void> => {
    const transport = attachedTransport;
    if (!transport) throw new Error('chatLoopController: no host transport attached — call attachHost() first');
    await transport.setFeedback(messageId, vote);
    const voteValue = vote === 'clear' ? null : vote === 'up' ? 1 : -1;
    // feedbackVote is not in ChatProjectionMessage's base constraint but IS in
    // the concrete Message type used by consumers (LocalMessage). Cast via unknown.
    patchMessage(messageId, { feedbackVote: voteValue } as unknown as Partial<Message>);
  };

  // -------------------------------------------------------------------------
  // Local-tool machine helpers (slice 1E)
  // -------------------------------------------------------------------------

  /**
   * Internal: get stream ids eligible for local-tool execution.
   * Mirrors AppChatPanel's getLocalToolEligibleStreamIds — reads controller messages.
   */
  const ltGetLocalToolEligibleStreamIds = (): Set<string> =>
    new Set(
      messages
        .filter((message) => {
          if (message.role !== 'assistant') return false;
          const status = message._localStatus;
          if (status === 'failed') return false;
          if (status === 'processing') return true;
          // Not failed, not processing — eligible if no content (empty completion)
          const content = message.content;
          return !(content && typeof content === 'string' && content.trim().length > 0);
        })
        .map((message) => message._streamId ?? message.id),
    );

  /**
   * Internal: mirrors AppChatPanel's isKnownAssistantStream.
   * Returns true if streamId is tracked by a non-failed assistant message.
   */
  const ltIsKnownAssistantStream = (streamId: string): boolean =>
    messages.some(
      (message) =>
        message.role === 'assistant' &&
        (message._streamId ?? message.id) === streamId &&
        message._localStatus !== 'failed',
    );

  /**
   * Internal: mirrors AppChatPanel's hasPendingPermissionPromptForStream.
   */
  const ltHasPendingPermissionPromptForStream = (
    streamId: string,
    exceptToolCallId?: string,
  ): boolean =>
    ltPendingLocalToolPermissionPrompts.some(
      (item) =>
        item.streamId === streamId &&
        (!exceptToolCallId || item.toolCallId !== exceptToolCallId),
    );

  /**
   * Internal: mirrors AppChatPanel's hasInFlightToolForStream.
   */
  const ltHasInFlightToolForStream = (
    streamId: string,
    exceptToolCallId?: string,
  ): boolean => {
    for (const inFlightToolCallId of ltLocalToolInFlight) {
      if (exceptToolCallId && inFlightToolCallId === exceptToolCallId) continue;
      const state = ltLocalToolStatesById.get(inFlightToolCallId);
      if (!state) continue;
      if (state.streamId === streamId) return true;
    }
    return false;
  };

  /**
   * Internal: mirrors AppChatPanel's getNextPendingToolCallIdForStream.
   */
  const ltGetNextPendingToolCallIdForStream = (streamId: string): string | null => {
    const pending = Array.from(ltLocalToolStatesById.entries())
      .filter(([_, state]) => state.streamId === streamId && !state.executed)
      .sort(([, a], [, b]) => {
        if (a.firstSeenAt !== b.firstSeenAt) {
          return a.firstSeenAt - b.firstSeenAt;
        }
        return a.lastSequence - b.lastSequence;
      });
    return pending[0]?.[0] ?? null;
  };

  /**
   * Internal: parse buffered JSON tool args (may be streaming / incomplete).
   * Mirrors AppChatPanel's parseBufferedToolArgs.
   */
  const ltParseBufferedToolArgs = (rawArgs: string): { ready: boolean; value: unknown } => {
    const trimmed = rawArgs.trim();
    if (!trimmed) return { ready: true, value: {} };
    try {
      return { ready: true, value: JSON.parse(trimmed) };
    } catch {
      return { ready: false, value: null };
    }
  };

  /** Notify + rebuild snapshot after local-tool state mutation. */
  const ltNotify = (): void => {
    notify();
  };

  /**
   * Internal: schedule execution of a buffered local tool.
   * Mirrors AppChatPanel's scheduleBufferedLocalToolExecution.
   */
  const ltScheduleBufferedLocalToolExecution = (toolCallId: string, delayMs = 120): void => {
    const existing = ltLocalToolExecutionTimersById.get(toolCallId);
    if (existing) clearTimeout(existing);
    const timerId = setTimeout(() => {
      ltLocalToolExecutionTimersById.delete(toolCallId);
      void ltTryExecuteBufferedLocalTool(toolCallId);
    }, delayMs);
    ltLocalToolExecutionTimersById.set(toolCallId, timerId);
  };

  /**
   * Internal: schedule the next pending tool for a stream.
   * Mirrors AppChatPanel's scheduleNextToolForStream.
   */
  const ltScheduleNextToolForStream = (streamId: string, delayMs = 80): void => {
    const nextToolCallId = ltGetNextPendingToolCallIdForStream(streamId);
    if (!nextToolCallId) return;
    ltScheduleBufferedLocalToolExecution(nextToolCallId, delayMs);
  };

  /**
   * Internal: clear all local-tool state for a specific stream.
   * Mirrors AppChatPanel's clearLocalToolStateForStream.
   */
  const ltClearLocalToolStateForStream = (streamId: string): void => {
    let changed = false;
    for (const [toolCallId, state] of ltLocalToolStatesById.entries()) {
      if (state.streamId !== streamId) continue;
      const timerId = ltLocalToolExecutionTimersById.get(toolCallId);
      if (timerId) clearTimeout(timerId);
      ltLocalToolExecutionTimersById.delete(toolCallId);
      ltLocalToolStatesById.delete(toolCallId);
      ltLocalToolInFlight.delete(toolCallId);
      ltLocalToolPermissionRetriesInFlight.delete(toolCallId);
      changed = true;
    }
    const before = ltPendingLocalToolPermissionPrompts.length;
    ltPendingLocalToolPermissionPrompts = ltPendingLocalToolPermissionPrompts.filter(
      (prompt) => prompt.streamId !== streamId,
    );
    if (changed || ltPendingLocalToolPermissionPrompts.length !== before) {
      ltNotify();
    }
  };

  /**
   * Internal: try to execute a buffered local tool.
   * Mirrors AppChatPanel's tryExecuteBufferedLocalTool — exact same sequencing:
   *   - guard: executed, inFlight, runtimeAvailable, ordering, permissionPrompt, inFlight for stream
   *   - special tab_type missing-args timeout (1500 ms)
   *   - parseBufferedToolArgs — reschedule if not ready
   *   - mark executed, add to inFlight, call executor
   *   - on LocalToolPermissionRequiredError: queue prompt, return (do NOT call finally's schedule)
   *   - on other error: forward error result; schedule next in finally
   *   - on success: post result; schedule next in finally
   */
  const ltTryExecuteBufferedLocalTool = async (toolCallId: string): Promise<void> => {
    const localToolState = ltLocalToolStatesById.get(toolCallId);
    if (!localToolState || localToolState.executed) return;
    if (ltLocalToolInFlight.has(toolCallId)) return;
    if (!ltIsLocalToolRuntimeAvailable?.()) return;
    const firstPendingToolCallId = ltGetNextPendingToolCallIdForStream(
      localToolState.streamId,
    );
    if (firstPendingToolCallId && firstPendingToolCallId !== toolCallId) return;
    if (ltHasPendingPermissionPromptForStream(localToolState.streamId, toolCallId)) return;
    if (ltHasInFlightToolForStream(localToolState.streamId, toolCallId)) return;

    // Special: tab_type with missing args — wait up to 1500 ms for args to arrive
    if (!localToolState.argsText.trim() && localToolState.name === 'tab_type') {
      const elapsed = Date.now() - localToolState.firstSeenAt;
      if (elapsed < 1500) {
        ltScheduleBufferedLocalToolExecution(toolCallId, 200);
        return;
      }
      localToolState.executed = true;
      ltLocalToolStatesById.set(toolCallId, localToolState);
      ltNotify();
      try {
        await ltPostLocalToolResult!(localToolState.streamId, toolCallId, {
          status: 'error',
          error:
            'tab_type arguments are missing (expected at least text, and optionally selector/x/y).',
        });
      } catch (forwardError) {
        const reason =
          forwardError instanceof Error ? forwardError.message : String(forwardError);
        console.warn(
          `Failed to forward missing-args error for ${localToolState.name} (${toolCallId}): ${reason}`,
        );
      }
      ltScheduleNextToolForStream(localToolState.streamId);
      return;
    }

    const parsed = ltParseBufferedToolArgs(localToolState.argsText);
    if (!parsed.ready) {
      ltScheduleBufferedLocalToolExecution(toolCallId, 120);
      return;
    }

    localToolState.executed = true;
    ltLocalToolStatesById.set(toolCallId, localToolState);
    ltLocalToolInFlight.add(toolCallId);
    ltNotify();

    try {
      const localResult = await ltExecuteLocalTool!(
        toolCallId,
        localToolState.name,
        parsed.value,
        { streamId: localToolState.streamId },
      );
      await ltPostLocalToolResult!(
        localToolState.streamId,
        toolCallId,
        localResult,
      );
    } catch (error) {
      if (ltIsLocalToolPermissionRequired?.(error)) {
        const request = ltGetPermissionRequest!(error);
        const prompt: ControllerLocalToolPermissionPrompt = {
          toolCallId,
          streamId: localToolState.streamId,
          name: localToolState.name,
          args: parsed.value,
          request,
          createdAt: Date.now(),
        };
        ltPendingLocalToolPermissionPrompts = [
          ...ltPendingLocalToolPermissionPrompts.filter(
            (item) => item.toolCallId !== toolCallId,
          ),
          prompt,
        ];
        ltNotify();
        // Do NOT schedule next — permission decision will trigger it
        return;
      }

      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `Failed to execute local tool ${localToolState.name} (${toolCallId}): ${reason}`,
      );
      try {
        await ltPostLocalToolResult!(
          localToolState.streamId,
          toolCallId,
          { status: 'error', error: reason },
        );
      } catch (forwardError) {
        const forwardReason =
          forwardError instanceof Error ? forwardError.message : String(forwardError);
        console.warn(
          `Failed to forward local tool error for ${localToolState.name} (${toolCallId}): ${forwardReason}`,
        );
      }
    } finally {
      // Only runs when NOT returning early (permission prompt path returns above)
      ltLocalToolInFlight.delete(toolCallId);
      ltNotify();
      ltScheduleNextToolForStream(localToolState.streamId);
    }
  };

  /**
   * Internal: handle tool_call_start stream event.
   * Mirrors AppChatPanel's handleLocalToolCallStart.
   */
  const ltHandleLocalToolCallStart = (rawEvent: Record<string, unknown>): void => {
    const streamId = String(rawEvent.streamId ?? '').trim();
    const toolCallId = String((rawEvent.data as Record<string, unknown>)?.tool_call_id ?? '').trim();
    const toolNameRaw = String((rawEvent.data as Record<string, unknown>)?.name ?? '').trim();
    const argsChunk =
      typeof (rawEvent.data as Record<string, unknown>)?.args === 'string'
        ? String((rawEvent.data as Record<string, unknown>)?.args)
        : '';
    const sequenceRaw = Number(rawEvent.sequence);
    const sequence = Number.isFinite(sequenceRaw) ? sequenceRaw : 0;

    if (!streamId || !toolCallId || !ltIsLocalToolName?.(toolNameRaw)) return;

    const previous = ltLocalToolStatesById.get(toolCallId);
    if (previous && sequence <= previous.lastSequence) return;

    // Import shouldResetLocalToolStateForFreshRound logic inline to avoid import
    const isFreshRound =
      Boolean(previous) &&
      Boolean(previous?.executed) &&
      Number.isFinite(sequence) &&
      sequence > (previous?.lastSequence ?? 0);

    ltLocalToolStatesById.set(toolCallId, {
      streamId,
      name: toolNameRaw,
      argsText:
        previous && !isFreshRound
          ? `${previous.argsText}${argsChunk}`
          : argsChunk,
      lastSequence: sequence,
      firstSeenAt: previous?.firstSeenAt ?? Date.now(),
      executed: isFreshRound ? false : (previous?.executed ?? false),
    });
    ltNotify();
    ltScheduleBufferedLocalToolExecution(toolCallId);
  };

  /**
   * Internal: handle tool_call_delta stream event.
   * Mirrors AppChatPanel's handleLocalToolCallDelta.
   */
  const ltHandleLocalToolCallDelta = (rawEvent: Record<string, unknown>): void => {
    const toolCallId = String((rawEvent.data as Record<string, unknown>)?.tool_call_id ?? '').trim();
    if (!toolCallId) return;
    const previous = ltLocalToolStatesById.get(toolCallId);
    if (!previous) return;

    const sequenceRaw = Number(rawEvent.sequence);
    const sequence = Number.isFinite(sequenceRaw) ? sequenceRaw : previous.lastSequence;
    if (sequence <= previous.lastSequence) return;

    const deltaChunk =
      typeof (rawEvent.data as Record<string, unknown>)?.delta === 'string'
        ? String((rawEvent.data as Record<string, unknown>)?.delta)
        : '';

    ltLocalToolStatesById.set(toolCallId, {
      ...previous,
      argsText: `${previous.argsText}${deltaChunk}`,
      lastSequence: sequence,
    });
    ltNotify();
    ltScheduleBufferedLocalToolExecution(toolCallId);
  };

  /**
   * Internal: handle status stream event for local-tool machine.
   * Mirrors AppChatPanel's handleLocalToolStatusEvent.
   */
  const ltHandleLocalToolStatusEvent = (rawEvent: Record<string, unknown>): void => {
    const streamId = String(rawEvent.streamId ?? '').trim();
    if (!streamId || !ltIsKnownAssistantStream(streamId)) return;

    const data = rawEvent.data as Record<string, unknown> | null;
    const state = String(data?.state ?? '').trim();
    const sequenceRaw = Number(rawEvent.sequence);
    const sequence = Number.isFinite(sequenceRaw) ? sequenceRaw : 0;

    if (state === 'awaiting_local_tool_results') {
      // Import parsePendingLocalToolCallsFromStatusPayload logic inline
      const record = data && typeof data === 'object' ? data : null;
      const pendingRaw = Array.isArray(record?.pending_local_tool_calls)
        ? (record!.pending_local_tool_calls as unknown[])
        : [];
      const seen = new Set<string>();
      const pendingCalls: Array<{ toolCallId: string; name: string; argsText: string; sequence: number }> = [];
      for (const item of pendingRaw) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        const toolCallId =
          typeof entry.tool_call_id === 'string' ? entry.tool_call_id.trim() : '';
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!toolCallId || seen.has(toolCallId) || !ltIsLocalToolName?.(name)) continue;
        seen.add(toolCallId);
        // serialize args
        let argsText: string;
        if (typeof entry.args === 'string') {
          argsText = entry.args;
        } else {
          try {
            argsText = JSON.stringify(entry.args ?? {});
          } catch {
            argsText = '{}';
          }
        }
        pendingCalls.push({ toolCallId, name, argsText, sequence });
      }

      const pendingToolCallIds = new Set(pendingCalls.map((call) => call.toolCallId));
      // Filter permission prompts: keep only those with a matching pending toolCallId for this stream
      ltPendingLocalToolPermissionPrompts = ltPendingLocalToolPermissionPrompts.filter(
        (prompt) => {
          if (prompt.streamId !== streamId) return true;
          return pendingToolCallIds.has(prompt.toolCallId);
        },
      );

      for (const call of pendingCalls) {
        const previous = ltLocalToolStatesById.get(call.toolCallId);
        const isFreshRound =
          Boolean(previous) &&
          Boolean(previous?.executed) &&
          Number.isFinite(sequence) &&
          sequence > (previous?.lastSequence ?? 0);
        ltLocalToolStatesById.set(call.toolCallId, {
          streamId,
          name: call.name,
          argsText:
            previous &&
            !isFreshRound &&
            previous.argsText.trim().length > 0
              ? previous.argsText
              : call.argsText,
          lastSequence: Math.max(previous?.lastSequence ?? 0, call.sequence),
          firstSeenAt: previous?.firstSeenAt ?? Date.now(),
          executed: isFreshRound ? false : (previous?.executed ?? false),
        });
      }

      ltNotify();
      ltScheduleNextToolForStream(streamId, 0);
      return;
    }

    if (state === 'local_tool_result_received') {
      const toolCallId = String(data?.tool_call_id ?? '').trim();
      if (!toolCallId) return;
      const timerId = ltLocalToolExecutionTimersById.get(toolCallId);
      if (timerId) clearTimeout(timerId);
      ltLocalToolExecutionTimersById.delete(toolCallId);
      ltPendingLocalToolPermissionPrompts = ltPendingLocalToolPermissionPrompts.filter(
        (prompt) => prompt.toolCallId !== toolCallId,
      );
      ltLocalToolStatesById.delete(toolCallId);
      ltLocalToolInFlight.delete(toolCallId);
      ltLocalToolPermissionRetriesInFlight.delete(toolCallId);
      ltNotify();
      return;
    }

    if (state === 'response_created') {
      ltPendingLocalToolPermissionPrompts = ltPendingLocalToolPermissionPrompts.filter(
        (prompt) => prompt.streamId !== streamId,
      );
      ltNotify();
    }
  };

  // -------------------------------------------------------------------------
  // Local-tool machine public API (slice 1E)
  // -------------------------------------------------------------------------

  const attachLocalToolMachine = (opts: AttachLocalToolMachineOptions): void => {
    ltExecuteLocalTool = opts.executeLocalTool;
    ltDecideLocalToolPermission = opts.decideLocalToolPermission;
    ltPostLocalToolResult = opts.postLocalToolResult;
    ltIsLocalToolName = opts.isLocalToolName;
    ltIsLocalToolRuntimeAvailable = opts.isLocalToolRuntimeAvailable;
    ltIsLocalToolPermissionRequired = opts.isLocalToolPermissionRequired;
    ltGetPermissionRequest = opts.getPermissionRequest;
  };

  /**
   * Internal: clear only state (timers + maps), not the injected functions.
   * Called by both resetLocalToolMachineState and detachLocalToolMachine.
   */
  const ltClearMachineState = (): void => {
    ltLocalToolExecutionTimersById.forEach((timerId) => clearTimeout(timerId));
    ltLocalToolExecutionTimersById.clear();
    ltLocalToolStatesById.clear();
    ltLocalToolInFlight.clear();
    ltLocalToolPermissionRetriesInFlight.clear();
    ltPendingLocalToolPermissionPrompts = [];
  };

  const resetLocalToolMachineState = (): void => {
    ltClearMachineState();
    ltNotify();
  };

  const detachLocalToolMachine = (): void => {
    ltClearMachineState();
    ltExecuteLocalTool = null;
    ltDecideLocalToolPermission = null;
    ltPostLocalToolResult = null;
    ltIsLocalToolName = null;
    ltIsLocalToolRuntimeAvailable = null;
    ltIsLocalToolPermissionRequired = null;
    ltGetPermissionRequest = null;
    ltNotify();
  };

  const handleLocalToolStreamEvent = (event: unknown): void => {
    // No-op if machine not attached
    if (!ltIsLocalToolName) return;

    const raw =
      event && typeof event === 'object' ? (event as Record<string, unknown>) : null;
    if (!raw) return;

    const streamId = String(raw.streamId ?? '').trim();
    if (!streamId) return;

    const eventType = String(raw.type ?? '').trim();

    if (eventType === 'status') {
      ltHandleLocalToolStatusEvent(raw);
      return;
    }

    if (eventType === 'done' || eventType === 'error') {
      ltClearLocalToolStateForStream(streamId);
      return;
    }

    if (eventType !== 'tool_call_start' && eventType !== 'tool_call_delta') return;
    if (!ltIsLocalToolRuntimeAvailable?.()) return;

    const eligibleStreamIds = ltGetLocalToolEligibleStreamIds();
    if (!eligibleStreamIds.has(streamId)) return;

    if (eventType === 'tool_call_start') {
      ltHandleLocalToolCallStart(raw);
      return;
    }
    ltHandleLocalToolCallDelta(raw);
  };

  const decideLocalToolPermission = async (
    prompt: ControllerLocalToolPermissionPrompt,
    decision: string,
  ): Promise<void> => {
    if (ltLocalToolPermissionRetriesInFlight.has(prompt.toolCallId)) return;
    ltLocalToolPermissionRetriesInFlight.add(prompt.toolCallId);

    try {
      await ltDecideLocalToolPermission!(prompt.request.requestId, decision);
      ltPendingLocalToolPermissionPrompts = ltPendingLocalToolPermissionPrompts.filter(
        (item) => item.toolCallId !== prompt.toolCallId,
      );
      ltNotify();

      if (decision === 'deny_once' || decision === 'deny_always') {
        await ltPostLocalToolResult!(prompt.streamId, prompt.toolCallId, {
          status: 'error',
          error: `Permission denied for ${prompt.request.toolName} on ${prompt.request.origin}.`,
        });
        return;
      }

      const localResult = await ltExecuteLocalTool!(
        prompt.toolCallId,
        prompt.name,
        prompt.args,
        { streamId: prompt.streamId },
      );
      await ltPostLocalToolResult!(prompt.streamId, prompt.toolCallId, localResult);
    } catch (error) {
      if (ltIsLocalToolPermissionRequired?.(error)) {
        const request = ltGetPermissionRequest!(error);
        const nextPrompt: ControllerLocalToolPermissionPrompt = {
          ...prompt,
          request,
          createdAt: Date.now(),
        };
        ltPendingLocalToolPermissionPrompts = [
          ...ltPendingLocalToolPermissionPrompts.filter(
            (item) => item.toolCallId !== prompt.toolCallId,
          ),
          nextPrompt,
        ];
        ltNotify();
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      try {
        await ltPostLocalToolResult!(prompt.streamId, prompt.toolCallId, {
          status: 'error',
          error: reason,
        });
      } catch (forwardError) {
        const forwardReason =
          forwardError instanceof Error ? forwardError.message : String(forwardError);
        console.warn(
          `Failed to forward permission decision error for ${prompt.name} (${prompt.toolCallId}): ${forwardReason}`,
        );
      }
    } finally {
      ltLocalToolPermissionRetriesInFlight.delete(prompt.toolCallId);
      ltScheduleNextToolForStream(prompt.streamId);
    }
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
    attachHost,
    detachHost,
    bootstrapRun,
    send,
    retry,
    stop,
    edit,
    setFeedback,
    attachLocalToolMachine,
    resetLocalToolMachineState,
    detachLocalToolMachine,
    handleLocalToolStreamEvent,
    decideLocalToolPermission,
  };
}
