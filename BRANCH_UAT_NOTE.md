# BR-14b UAT Note — chat-service core refactoring with @sentropic/chat-core

## Context
- Branch: `refacto/chat-service-core`
- Worktree: `tmp/refacto-chat-service-core`
- Baseline HEAD: `20f3051d` (Lot 23 closed, 245/245 chat-core tests + 28/28 chat.test.ts regression green)
- Goal of UAT: validate that the chat-service refactoring (extraction of `@sentropic/chat-core`, `ChatRuntime` god-class split into 6 sub-classes) preserves end-user behavior.
- Mandate: per BRANCH.md "UAT Management" (L107-111), final merge requires explicit `UAT passed` or `UAT waived by user` recorded in `BRANCH.md`. CI alone is insufficient.

## UAT Environment Setup (root workspace, ENV=dev)
- Run from root workspace `~/src/sentropic` (NOT from the worktree `tmp/refacto-chat-service-core`).
- Switch root workspace to branch HEAD: `git fetch origin && git checkout refacto/chat-service-core` (or use a UAT worktree commit-identical to `20f3051d`).
- Bring up dev stack: `make dev ENV=dev` (root ports API `8787`, UI `5173`, Maildev `1080`).
- Verify HEAD identity before sign-off: `git rev-parse HEAD` MUST equal `20f3051d5aa63c46dc601926f8c73c40210525b4` (or whatever HEAD the PR carries at sign-off time).
- Login with a real user account; ensure at least one workspace/organization is provisioned.

## Surface Coverage (MANDATORY)
Per BRANCH.md Lot 5 + workflow.md UAT mandate, every scenario below MUST be exercised on the three surfaces below where applicable. If a surface is genuinely out-of-scope for a scenario (e.g. chrome plugin has no checkpoint UI), record `N/A — <reason>`.

- **Web app** (root UI on `http://localhost:5173`)
- **Chrome plugin** (`ui/chrome-ext` — load unpacked from `ui/chrome-ext/dist` after `make build-chrome-ext` if needed; pin to local API at `http://localhost:8787`)
- **VSCode plugin** (`ui/vscode-ext` — install local VSIX or run extension dev host; pin to local API at `http://localhost:8787`)

## Scenarios

### Scenario 1 — Streaming response
- **Setup**: Open a fresh chat thread on the surface under test. Select a model that supports streaming (default catalog model).
- **Action steps**:
  1. Send a prompt that requires a multi-paragraph answer (e.g. "Explain how a transformer works in 3 paragraphs").
  2. Observe tokens appearing incrementally in the assistant message bubble.
  3. Wait for the stream to complete (final stop event).
- **Expected outcome**: Tokens stream incrementally (no single-shot dump). The final assistant message is identical to the streamed accumulation. No duplicate text. Stream end event arrives within reasonable latency. UI does not freeze.
- **Evidence to capture**: Screenshot or short screen capture showing partial -> complete streaming. Browser network tab (web) showing the SSE / streaming response. For chrome/vscode: console logs showing stream events.
- **Surfaces**: Web app, Chrome plugin, VSCode plugin.

### Scenario 2 — Local tool handoff
- **Setup**: Same fresh chat thread. Ensure a local tool is registered for the surface (e.g. browser/page-context tool for chrome, editor tool for vscode, file/canvas tool for web).
- **Action steps**:
  1. Send a prompt that should trigger a local tool call (e.g. on chrome: "Summarize the current page"; on vscode: "Refactor the active file's first function"; on web: "Run the X local tool").
  2. Observe the assistant requesting the tool (tool-call event).
  3. Verify the local surface picks up the tool-call payload and executes it.
- **Expected outcome**: Tool-call event reaches the surface with correct tool name + arguments. Local execution runs without error. The tool-result is sent back to the API.
- **Evidence to capture**: Screenshot of tool-call panel/banner in the UI. Console / devtools showing tool-call payload. For vscode: "Output" panel of the extension showing the dispatch.
- **Surfaces**: Web app (if local tools enabled), Chrome plugin, VSCode plugin.

### Scenario 3 — Tool-result continuation
- **Setup**: Continuation from Scenario 2 (or a fresh thread + a tool call that returns structured data).
- **Action steps**:
  1. After the local tool returns its result (Scenario 2), let the chat continue automatically.
  2. Observe the assistant resuming with a new turn that consumes the tool-result.
  3. Verify the assistant references the tool output content (not a hallucinated answer).
- **Expected outcome**: After tool-result POST, the assistant emits a new streaming turn that references the tool's actual output. No duplicate user message. No lost context. Conversation history shows: user prompt -> assistant tool-call -> tool-result -> assistant final answer.
- **Evidence to capture**: Screenshot of the full thread after continuation. DB (if accessible) showing the message sequence: `make db-query QUERY="select role, content_preview from chat_messages where thread_id='<id>' order by created_at"`.
- **Surfaces**: Web app, Chrome plugin, VSCode plugin.

### Scenario 4 — Cancellation
- **Setup**: Fresh chat thread. Pick a prompt that yields a long response (e.g. "Write a 2000-word essay about the history of compilers").
- **Action steps**:
  1. Send the prompt and wait for streaming to start.
  2. Click the "Stop" / "Cancel" button mid-stream (within the first 2-3 seconds of streaming).
  3. Observe the assistant message stops growing.
  4. Verify a user-visible cancellation indicator appears (e.g. "cancelled by user", grey state, or partial-message marker).
- **Expected outcome**: Streaming halts within 1-2 seconds. The partial message is preserved (not deleted). UI shows a clear cancellation state. No hung spinner. Sending a new prompt afterwards works normally.
- **Evidence to capture**: Screenshot of the cancelled thread state. Network tab showing the abort/disconnect. For api: `make logs-api ENV=dev` lines showing the cancellation path was triggered.
- **Surfaces**: Web app, Chrome plugin, VSCode plugin.

### Scenario 5 — Retry
- **Setup**: A thread with at least one assistant message that completed (or was cancelled).
- **Action steps**:
  1. Hover the last assistant message and click the "Retry" / "Regenerate" action.
  2. Observe the previous assistant message being replaced (or appended as a sibling, depending on UI policy) by a new streaming turn.
  3. Verify the user message is NOT duplicated.
- **Expected outcome**: Retry triggers a new model call from the same input context. The previous assistant message is either replaced or recorded as a sibling (consistent with the surface's UX). No duplicate user message. Streaming behaves as in Scenario 1. Model output may differ semantically (expected nondeterminism).
- **Evidence to capture**: Screenshot before + after retry. DB query showing the message tree (sibling vs replace). For api: log lines showing the retry path was hit.
- **Surfaces**: Web app (primary), Chrome plugin (if retry exposed), VSCode plugin (if retry exposed).

### Scenario 6 — Checkpoint visibility
- **Setup**: A thread with at least 4-5 user/assistant exchanges (so multiple checkpoints exist).
- **Action steps**:
  1. Open the thread's history / version / checkpoint panel (web app — primary surface for checkpoint UI).
  2. Verify each major turn has a corresponding checkpoint entry with timestamp and version.
  3. Click a past checkpoint and verify it loads the prior state (read-only or branchable).
- **Expected outcome**: Checkpoints are listed in chronological order. Each carries a stable id + timestamp. Loading a past checkpoint shows the prior message tree. Current head checkpoint matches the live thread state. No checkpoint ids are missing or duplicated.
- **Evidence to capture**: Screenshot of the checkpoint panel. DB query: `make db-query QUERY="select id, version, created_at from chat_checkpoints where thread_id='<id>' order by version"` ENV=dev`.
- **Surfaces**: Web app (primary). Chrome plugin: `N/A — no checkpoint UI` (record this verbatim if confirmed). VSCode plugin: `N/A — no checkpoint UI` (record this verbatim if confirmed).

### Scenario 7 — Error display
- **Setup**: Fresh chat thread.
- **Action steps**:
  1. Trigger a recoverable error: temporarily revoke API access for the configured provider OR pick a model whose credentials are missing.
  2. Send a prompt and observe the error path.
  3. Restore credentials, then send a valid prompt to confirm the surface recovers.
- **Expected outcome**: Error appears as a clear user-facing message (e.g. "Provider authentication failed" or branch-specific mapped error from BR14c). Error does NOT crash the surface. Thread remains usable. Subsequent valid prompt succeeds (no leftover broken state).
- **Evidence to capture**: Screenshot of the error UI. `make logs-api ENV=dev` lines confirming the error mapping path. Confirmation that recovery works (screenshot of next successful turn).
- **Surfaces**: Web app, Chrome plugin, VSCode plugin.

## Recording UAT Result (MANDATORY)
After running all 7 scenarios on all applicable surfaces, the user MUST record exactly one outcome in `BRANCH.md` under `## Feedback Loop`:
- `closed YYYY-MM-DD (Lot 5): UAT passed — branch HEAD <SHA>, surfaces tested: web/chrome/vscode, scenarios 1-7 PASS, evidence: <link or path>`
- OR `closed YYYY-MM-DD (Lot 5): UAT waived by user — reason: <explicit reason>, branch HEAD <SHA>`

No merge is allowed until one of the two lines above is committed to `BRANCH.md` on `refacto/chat-service-core`.

## Reporting Issues During UAT
Any UAT failure must be filed as an `attention` item in `BRANCH.md` `## Feedback Loop` with:
- ID (free form, e.g. `uat-2026-05-15-streaming-stall`)
- Surface + scenario number
- Repro steps
- Expected vs Actual
- Evidence path (screenshot, log excerpt)

Failures block merge until fixed or explicitly waived.
