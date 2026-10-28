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
 * Slice 1F adds: steer + model-catalog/selection.
 *   - sendSteer(steerText, targetStreamId, opts): optimistic steer message insert +
 *     ack management + host.postSteer + error rollback.
 *   - loadModelCatalog(fetchFn): calls fetchFn, stores providers/models/defaults,
 *     computes groups, coerces selection to a valid entry.
 *   - setModelSelection(providerId, modelId): explicit selection update (from UI).
 *   - applyUserDefaults(providerId, modelId): apply user-preference defaults
 *     (called from app-side USER_AI_SETTINGS_UPDATED_EVENT listener).
 *   - Snapshot gains: optimisticSteerMessages, composerSteerAck,
 *     modelCatalogProviders, modelCatalogModels, modelCatalogGroups,
 *     selectedProviderId, selectedModelId.
 *
 *   App-side concerns kept in AppChatPanel (NOT moved here):
 *     - composerSteerInFlight flag (button-disabled UI concern)
 *     - errorMsg display (formatApiError — Svelte i18n concern)
 *     - input clearing / scroll scheduling (DOM concerns)
 *     - USER_AI_SETTINGS_UPDATED_EVENT listener + removeEventListener teardown
 *     - applyUserDefaultsForNewSessions (calls ctrl.applyUserDefaults)
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
 *   - Steer (slice 1F): sendSteer is async — caller wraps in try/catch for errorMsg.
 *     composerSteerInFlight stays app-side (button-disabled concern).
 *     ackTimeoutMs is configurable (default 5000ms) for testability.
 *   - Model catalog (slice 1F): loadModelCatalog takes a plain fetchFn so the
 *     controller stays transport-agnostic. coerceSelectionToValidEntry is called
 *     internally whenever catalog or selection changes.
 *
 * FLAG: reactivity bridge is the key architectural choice for later slices.
 *   The controller deliberately does NOT carry a Svelte store itself — it is a plain
 *   observable. AppChatPanel wraps it in whatever Svelte primitive it chooses.
 *   This keeps the controller usable in React/Vue wrappers (later slices).
 */

import {
  projectAssistantRunSegments,
  countLinkedSteerMessages,
  getProjectedRunTerminalOutcome,
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

import {
  type ComposerSteerAck,
  createComposerSteerAck,
  createOptimisticSteerMessage,
  shouldClearComposerSteerAck,
} from './chatDraft.js';

import {
  groupModelsByProvider,
  type ModelCatalogGroup,
  type ModelCatalogModel,
  type ModelCatalogProvider,
  type ModelProviderId,
} from '@sentropic/chat-ui/utils/model-selection';
import { coerceSelectionToValidEntry } from '../utils/modelSelectionPolicy.js';

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
 * Structurally compatible with StreamHubClient from '@sentropic/chat-runtime/client/streamTypes'.
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
  /**
   * Post a steer message to a running assistant stream (slice 1F).
   * Structurally compatible with ChatCoreHost.postSteer.
   */
  postSteer(streamId: string, message: string): Promise<void>;
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
// Steer types — slice 1F (re-exported for app-side use)
// ---------------------------------------------------------------------------

/** Re-export so AppChatPanel imports the type from a single location. */
export type { ComposerSteerAck };

/**
 * An optimistic steer message inserted into the timeline while the steer
 * request is in-flight. Matches the shape produced by createOptimisticSteerMessage.
 */
export type ControllerOptimisticSteerMessage = {
  id: string;
  sessionId: string;
  role: 'user';
  content: string;
  createdAt: string;
  _localStatus: 'completed';
  _optimisticSteerTargetAssistantId: string;
  _optimisticSteerSubmittedAtMs: number;
};

/**
 * Options for sendSteer (slice 1F).
 *
 * - sessionId: the current session (for the optimistic message factory)
 * - targetAssistantMessageId: the id of the assistant message being steered
 * - ackMessage: human-readable ack text (i18n — supplied by the app)
 * - ackTimeoutMs: ms before ack is cleared (default 5000)
 */
export type SendSteerOptions = {
  sessionId: string;
  targetAssistantMessageId?: string | null;
  ackMessage: string;
  ackTimeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Model catalog types — slice 1F (re-exported for app-side use)
// ---------------------------------------------------------------------------

/** Re-export catalog types so AppChatPanel keeps a single import. */
export type { ModelCatalogProvider, ModelCatalogModel, ModelCatalogGroup, ModelProviderId };

/**
 * Minimal fetch function for the model catalog — structurally compatible with
 * ChatCoreHost.fetchModelCatalog. The controller does not import the concrete host.
 */
export type ControllerModelCatalogFetchFn = () => Promise<{
  providers: Array<{ provider_id: string; label: string; status: 'ready' | 'planned' }>;
  models: Array<{ provider_id: string; model_id: string; label: string; default_contexts: string[] }>;
  defaults?: { provider_id?: string; model_id?: string };
}>;

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

  // -- Steer state (slice 1F) ------------------------------------------------

  /**
   * Optimistic steer messages in the timeline (while steer is in-flight).
   * App clears these on session change; controller removes them on successful
   * post + on error rollback.
   */
  readonly optimisticSteerMessages: readonly ControllerOptimisticSteerMessage[];

  /**
   * Current steer ACK displayed while the steer is being processed.
   * Cleared automatically after ackTimeoutMs.
   */
  readonly composerSteerAck: ComposerSteerAck | null;

  // -- Model catalog state (slice 1F) ----------------------------------------

  /** Raw provider list from the catalog API. */
  readonly modelCatalogProviders: readonly ModelCatalogProvider[];

  /** Raw model list from the catalog API. */
  readonly modelCatalogModels: readonly ModelCatalogModel[];

  /** Grouped view (derived from providers + models). */
  readonly modelCatalogGroups: readonly ModelCatalogGroup[];

  /** Currently selected provider id. */
  readonly selectedProviderId: ModelProviderId;

  /** Currently selected model id. */
  readonly selectedModelId: string;

  /** Default provider for new sessions (from catalog defaults or user prefs). */
  readonly defaultProviderIdForNewSession: ModelProviderId;

  /** Default model for new sessions (from catalog defaults or user prefs). */
  readonly defaultModelIdForNewSession: string;
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

