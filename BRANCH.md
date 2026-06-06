# Feature: chat-ui modularization — ChatCoreHost contract (Lot 1 Steps 1+2)

## Objective
Ratify the `ChatCoreHost` typed contract (transport + streaming + local-tool + steer) derived from real call-sites. Genericize StreamHub event taxonomy (no domain strings in type exports). Make AppChatPanel consume host transport verbs. Prove sentropic host conforms via `satisfies ChatCoreHost`. Zero behavior change.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**`, `ui/src/lib/chat/**`, `ui/src/lib/components/chat/**`, `BRANCH.md`.
- Zero behavior change: refactor call-sites only, no logic/DOM/state/scroll changes.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/chatui-core-panel`.
- Test ENV: `ENV=test-corepanel` (NEVER `ENV=dev`).
- In every `make` command, `ENV=test-corepanel` must be passed as the last argument.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/**`
  - `ui/src/lib/chat/**`
  - `ui/src/lib/components/chat/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql`

## Orchestration Mode
- [x] **Mono-branch + cherry-pick** (single branch, contract-only step)
- Rationale: Steps are pure type contract + refactor with no orchestration impact.

## Plan / Todo (lot-based)

- [x] **Lot 1 Step 1 — ChatCoreHost contract ratification**
  - [x] Study real call-sites: `transport.ts`, `streamHub.ts`, `streamTypes.ts`, `replay.ts`, `web-host-adapter.ts`, `session-adapter.ts`, `AppChatPanel.svelte` (sendMessage ~L4237, retryMessage ~L2992, stopAssistantMessage ~L4387, saveEditMessage ~L2912, setFeedback ~L4401, deleteCurrentSession ~L4052, pollJobUntilTerminal ~L4089, postLocalToolResultWithRetry ~L796, loadModelCatalog ~L4140, sendComposerSteer→postChatSteer ~L3338)
  - [x] Create `packages/chat-ui/src/client/chat-core-host.ts` exporting `ChatCoreHost` + `SessionSummary`, `SendMessagePayload`, `RunHandle`, `ModelCatalog`. Includes transport REST verbs, StreamHub client surface, `postLocalToolResult`, `postSteer`. Zero sentropic domain strings.
  - [x] Prove conformance: `ui/src/lib/chat/chat-core-host-adapter.ts` with `satisfies ChatCoreHost` assertion on `createSentropicChatCoreHost`. Zero runtime change.
  - [x] Add `packages/chat-ui/tests/chat-core-host.spec.ts`: fake host `satisfies ChatCoreHost` (compile proof) + runtime assertions + export-surface check + sentropic-string scan.
  - [x] Export: add `./client/chat-core-host` to `packages/chat-ui/package.json` exports + update `export-manifest.json`.
  - [x] Version: bump `packages/chat-ui/package.json` 0.13.1 → 0.14.0.
  - [x] Lot gate: `make typecheck-ui`, `make typecheck-chat-ui`, `make test-chat-ui` → 426/426 pass

- [x] **Lot 1 Slice 1A.0 — Genericize StreamHub event taxonomy (non-breaking)**
  - [x] Remove sentropic domain event literals from `STREAM_HUB_EVENT_TYPES` and `StreamHubEvent` union in `streamTypes.ts`
  - [x] Add `export type StreamHubEventType = (typeof STREAM_HUB_EVENT_TYPES)[number] | (string & {})`
  - [x] Widen `onlyType` from `'job_update' | 'organization_update'` to `StreamHubEventType`
  - [x] Add `onlyTypes?: StreamHubEventType[]` to `StreamHubSubscription`
  - [x] Fix `streamHub.ts`: add `ALL_SSE_EVENT_TYPES` const (private, includes domain strings) for SSE listener registration; cast domain event dispatch objects as `StreamHubEvent`
  - [x] Fix `streamHistory.ts`: use `asRecord(event)` for domain event field access (no union narrowing needed)
  - [x] Gate: `make typecheck-chat-ui` → exit 0; `make test-chat-ui` → 426/426 pass

- [x] **Lot 1 Slice 1A — Real transport verbs on host; AppChatPanel consumes them (ZERO-DOM)**
  - [x] Extend `ChatCoreTransport` in `packages/chat-ui/src/client/transport.ts` with all 12 host verbs; implement in `createDefaultTransport`
  - [x] Extend `createSentropicChatTransport` in `ui/src/lib/chat/web-host-adapter.ts` with all business verbs (satisfies expanded interface)
  - [x] Refactor AppChatPanel to use `chatCoreHost` for all 14 ChatCoreHost call-sites; remove unused URL builder imports + `postChatSteer` import
  - [x] Fix `ModelProviderId` cast for `initialProviderId` from `ModelCatalog.defaults?.provider_id` (string) to `ModelProviderId`
  - [x] Gate: `make typecheck-ui` → 0 errors; `make typecheck-chat-ui` → exit 0; `make test-chat-ui` → 455/455; `make test-ui` → 445/447 pass (2 pre-existing `google-drive-picker` failures, confirmed on Step-1A.0 baseline)

- [x] **Lot 1 Slice 1B — Projection/history state → controller (ZERO-DOM)**
  - [x] Create `packages/chat-ui/src/state/chatLoopController.ts`: `createChatLoopController<Message, RuntimeSummary>()` plain TS, zero Svelte, zero sentropic domain strings. Owns: messages, initialEventsByMessageId, projectedStreamEventsById, signature cache, projectedTimelineItems. Implements Svelte store protocol (`subscribe` returning unsubscribe).
  - [x] Export `./state/chatLoopController` in `packages/chat-ui/package.json`.
  - [x] Refactor `AppChatPanel.svelte`: instantiate `ctrl`, bind `messages`/`initialEventsByMessageId`/`projectedStreamEventsById`/`projectedTimelineItems` from `$ctrl` (reactive aliases). Route all message mutations through `ctrl.setMessages/appendMessage/patchMessage/filterMessages/resetProjectionState/mergeHistoryEvents/mergeProjectedHistoryForStream/appendProjectedLiveEvent`. Replace local projection functions with controller delegates. Remove `projectedAssistantComputationByMessageId` + `projectionEventsVersion` local vars. Zero DOM change.
  - [x] Create `packages/chat-ui/tests/chat-loop-controller.spec.ts` (25 tests): projection parity golden (vs pure helpers), signature cache effectiveness, subscribe() store contract, event accumulation, message mutations, isTrackedAssistantStreamId, getProjectionEventsForMessage priority, sentropic-string scan.
  - [x] Gate: `make typecheck-chat-ui` → exit 0; `make typecheck-ui` → 0 errors; `make test-chat-ui` → 482/482 pass; `make test-ui` → 445/447 pass (2 pre-existing google-drive-picker failures only)

- [x] **Lot 1 Slice 1C — Live stream subscription → controller (ZERO-DOM)**
  - [x] Extend `packages/chat-ui/src/state/chatLoopController.ts` with `ControllerStreamClient`, `ControllerPollJob`, `AttachStreamOptions` types; add `attachStream(opts)`, `detachStream()`, `startJobPoll(jobId, streamId, opts?)` to the `ChatLoopController` interface and implementation.
  - [x] Controller owns: projection-event routing (via `handleIncomingStreamEvent`), terminal detection + `patchMessage` (via `handleStreamTerminal`), job-poll fallback loop (via `runJobPollLoop`). Callbacks `onProjectionEvent`/`onTerminal` allow AppChatPanel to trigger scroll AFTER state mutation.
  - [x] Refactor `AppChatPanel.svelte`: remove `handleProjectionStreamEvent`, `handleAssistantTerminal`, `pollJobUntilTerminal`, local `jobPollInFlight` set, `let projectionHubKey`. In `onMount`, replace `streamHub.set(projectionHubKey, ...)` with `ctrl.attachStream({ streamClient: chatCoreHost.streamClient, pollJob, onProjectionEvent: scheduleScrollToBottom, onTerminal: scheduleScrollToBottom({ force: true }) })`. In `onDestroy`, replace `streamHub.delete(projectionHubKey)` with `ctrl.detachStream()`. Replace `pollJobUntilTerminal(...)` in `bootstrapAssistantRun` with `ctrl.startJobPoll(...)`. Zero markup change.
  - [x] Extend `packages/chat-ui/tests/chat-loop-controller.spec.ts`: add describe block "stream subscription (slice 1C)" — 10 deterministic tests covering event routing, terminal patching (done/error), onProjectionEvent/onTerminal callbacks fire AFTER state update, detachStream cleans up, job-poll fallback (done+error), poll skips if already terminal, hot-swap semantics.
  - [x] Gate: `make typecheck-chat-ui` → exit 0; `make typecheck-ui` → 0 errors (6 pre-existing Svelte warnings); `make test-chat-ui` → 492/492 pass (35 in chat-loop-controller.spec); `make test-ui` → 445/447 pass (2 pre-existing google-drive-picker flake, stash-verified identical at HEAD)

- [x] **Lot 1 Slice 1D — send/bootstrap/retry/stop/edit/feedback → controller (ZERO-DOM)**
  - [x] Add types to controller: `ControllerSendPayload`, `ControllerRunHandle`, `ControllerHostTransport`, `AttachHostOptions`, `BootstrapRunInput<Message>`, `BootstrapRunResult<Message>`.
  - [x] Extend `ChatLoopController` interface and implementation: `attachHost(opts)`, `detachHost()`, `bootstrapRun(input)` (public), `send(payload, opts)`, `retry(messageId, opts)`, `stop(messageId)`, `edit(messageId, content)`, `setFeedback(messageId, vote)`. Host transport injected via `attachHost({ transport })` — structurally compatible with `ChatCoreHost`, no concrete import.
  - [x] `bootstrapRun` builds the optimistic assistant message via caller-supplied factory (receives `{ id, sessionId, _streamId, _localStatus, role, content, createdAt }`), handles userMessage/truncate/append paths, calls `startJobPoll`.
  - [x] Refactor `AppChatPanel.svelte`: call `ctrl.attachHost({ transport: chatCoreHost })` after `createChatLoopController()`. Add `makeAssistantMsgFactory(model)` local helper. Remove `bootstrapAssistantRun` (dead after delegation). `retryMessage`: truncate `historyTimelineItems` app-side, delegate to `ctrl.retry`. `saveEditMessage`: delegate to `ctrl.edit` + existing `retryMessage`. `sendMessage`: delegate to `ctrl.send` (payload assembly + composer clear + sessionId update stay app-side). `stopAssistantMessage`: delegate to `ctrl.stop`. `setFeedback`: delegate to `ctrl.setFeedback`. Zero markup change.
  - [x] Update `ui/tests/components/chat/AppChatPanel-boundary.test.ts`: update attachment-wiring assertion to match new captured pattern (`capturedAttachments = sentAttachments` + `attachments: capturedAttachments`).
  - [x] Extend `packages/chat-ui/tests/chat-loop-controller.spec.ts`: add describe block "host lifecycle (slice 1D)" — 17 deterministic tests: send golden, optimistic insert, handle return, bootstrapRun paths (userMsg/truncate/append), retry args+truncation+status, stop, edit, setFeedback (up/down/clear), no-transport throws, assistantMessage result exposed, buildAssistantMessage receives correct sessionId.
  - [x] Gate: `make typecheck-chat-ui` → exit 0; `make typecheck-ui` → 0 errors; `make test-chat-ui` → 509/509 pass (52 in chat-loop-controller.spec); `make test-ui` → 445/447 pass (2 pre-existing google-drive-picker flake, stash-verified identical at HEAD)

## Feedback Loop
- None.

## AI Flaky tests
- None applicable in this step (no AI calls).
