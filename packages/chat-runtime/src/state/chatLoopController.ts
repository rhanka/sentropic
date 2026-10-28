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
