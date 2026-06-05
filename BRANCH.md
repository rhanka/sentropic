# Feature: ChatConversation real orchestration + functional harness (Branch B)

## Objective
Make the turnkey `ChatConversation` actually FUNCTION (it is currently a dead shell, proven by mermaid-editor on the published artifact: `handleSend` only `host.transport.postMessage`s, never opens the stream → posts then silence, `render_mermaid` never runs). Wire `handleSend` to create the assistant message + drive the live stream + dispatch local tools, and prove it with a functional harness. See `spec/SPEC_EVOL_CHATUI_FIDELITY.md` §10 Branch B.

## Scope / Guardrails
- Make-only; ENV last; worktree `tmp/chatui-conversation-wiring`; never `ENV=dev`; never `make clean-all`.
- Lib-only change (no app change). Validation is the functional harness + the chat-ui suite (sentropic does not dogfood ChatConversation, so per the fidelity rule an assembly is proven by a parity/functional harness).
- All text English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/chat-ui/src/components/ChatConversation.svelte` (+ `.d.ts` if props change)
  - `packages/chat-ui/src/state/*` or a new helper ONLY if the send→stream projection genuinely belongs in shared state (prefer keeping it in the component)
  - `packages/chat-ui/tests/chat-conversation-functional.dom.spec.ts` (NEW harness)
  - `packages/chat-ui/package.json` (version 0.11.0 → 0.12.0, minor)
  - `packages/chat-ui/export-manifest.json` (_version 0.12.0)
  - `packages/chat-ui/chat-ui-reference-validation.json` (when ChatConversation becomes a real assembly: flip its class from `legacy` → `assembly` with `assemblyValidatedBy` = the harness, `composes` = the validated primitives — only if it composes ONLY canonical primitives, i.e. repoint its `ContextChips` import to `ChatContextPicker`)
  - `BRANCH.md`
- **Forbidden**: `ui/**`, `api/**`, `Makefile`, `docker-compose*.yml`, `.github/**`, `.cursor/**`, other packages' src.

## Feedback Loop
- none (ESCALATE if the host streamClient/transport contract cannot support turnkey send→stream wiring without app-private knowledge — STOP + report)

## Orchestration Mode
- [x] Mono-branch + cherry-pick

## Plan / Todo
- [x] **Lot 0 — Understand the streaming contract (READ, don't guess)**
  - [x] Worktree on `feat/chatui-conversation-wiring`; ENV `feat-chatui-conv`; ports API 9320 UI 5420 MAILDEV 1320.
  - [x] Read `packages/chat-ui/src/components/ChatConversation.svelte` IN FULL (current `handleSend` ~227, `timeline`/`streamEventsById` ~187-196, the StreamMessage render path ~379-438 that activates when `item.message._streamId` + `host.streamClient`, `parseLocalToolCalls` ~269).
  - [x] Read the REFERENCE send→stream flow in `ui/src/lib/components/chat/AppChatPanel.svelte`: how it posts a message, obtains the assistant message id / `_streamId`, subscribes via the stream client, appends the assistant timeline item, and how it parses + executes local tool calls (grep: `postMessage`, `streamClient`, `_streamId`, `streamHub`, `createStreamHub`, `executeLocalTool`, `parseLocalToolCalls`/`localToolStreamSync`).
  - [x] Read the contract: `packages/chat-ui/src/client/streamHub.ts` + `streamTypes.ts` (streamClient API), `packages/chat-ui/src/components/StreamMessage.svelte` (how it consumes `streamClient` + `_streamId`), `packages/chat-ui/src/utils/localToolStreamSync.ts` + `stores/localTools.ts` (local-tool parse/execute). The host shape is `host` (ChatUiWebHost): `host.transport.postMessage`, `host.streamClient`, `host.localTools?`.

- [x] **Lot 1 — Wire handleSend → stream**
  - [x] After `host.transport.postMessage(sessionId, {content})`, obtain the assistant message id / `_streamId` the host returns (mirror AppChatPanel's exact mechanism — if postMessage returns it, use it; if the stream client emits the new assistant message, subscribe). Append an assistant `SimpleMessage` to `timeline` carrying `_streamId` so the EXISTING template path renders the live `StreamMessage` (already wired when `host.streamClient` present). Feed `streamEventsById` from the stream as needed (or let StreamMessage own the subscription — follow how StreamMessage actually works).
  - [x] Make `timeline`/`streamEventsById` real reactive state that updates (they currently are private `let` that nothing mutates after send).
  - [x] Replace the "for testing" `parseLocalToolCalls` with real parse + dispatch via `host.localTools` (mirror AppChatPanel / `localToolStreamSync`), so a `render_mermaid`-shaped local tool call in the stream actually executes the host-provided local tool. Keep app-specific concerns out (the host injects the local-tool runtime).
  - [x] Repoint ChatConversation's `ContextChips` import → `ChatContextPicker` (so it composes only canonical primitives — required to classify it `assembly` not `legacy`).

- [x] **Lot 2 — Functional harness (proves not-a-dead-shell)**
  - [x] `packages/chat-ui/tests/chat-conversation-functional.dom.spec.ts` (jsdom, follow the existing `*.dom.spec.ts` setup): mount `ChatConversation` with a FAKE `host` (in-memory `transport.postMessage` + a fake `streamClient` that emits a scripted assistant stream incl. a `render_mermaid`-shaped local-tool call + a fake `localTools` runtime). Drive a send and ASSERT: (a) the user message renders, (b) the assistant stream renders (StreamMessage receives the stream / timeline gets the assistant item with `_streamId`), (c) the local-tool runtime's execute was CALLED with the render_mermaid args. This is the proof the turnkey actually functions.
  - [x] Bump `packages/chat-ui/package.json` 0.11.0 → 0.12.0 + `export-manifest.json` _version. Update the manifest: `ChatConversation.svelte` class `legacy` → `assembly` (assemblyValidatedBy the new harness; composes the validated primitives incl. ChatContextPicker).

- [x] **Lot N — Gate**
  - [x] `make typecheck-chat-ui ENV=feat-chatui-conv` PASS, `make build-chat-ui ENV=feat-chatui-conv` PASS, `make pack-chat-ui ENV=feat-chatui-conv` PASS, `make test-chat-ui ENV=test-chatui-conv` PASS (417 tests), `make test-chat-ui-dom ENV=test-chatui-conv` PASS (118 tests incl. new functional harness + reference-validation seeing ChatConversation=assembly). `make down ENV=feat-chatui-conv` done.
  - [ ] PR (BRANCH.md body), CI green (rerun e2e flakes). On merge publishes 0.12.0. Remove BRANCH.md, push, merge.
