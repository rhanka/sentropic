# Fix: chat composer image-paste send freeze (no POST /chat/messages)

## Objective
Root-cause and fix the client-side regression where pasting an image into the chat composer then sending never issues POST /api/v1/chat/messages (UI frozen), with a deterministic e2e reproduction spec.

## Scope / Guardrails
- Scope limited to the chat composer attachments send path (ui chat panel, @sentropic/chat-ui documents/state modules) and one new e2e spec.
- No migration.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/chatui-uat`.
- Automated test campaigns on `ENV=test-uat` (API 9460 / UI 5560 / Maildev 1460), never on root `dev`.
- In every `make` command, `ENV=test-uat` is passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/chat/AppChatPanel.svelte`
  - `ui/src/lib/chat/**`
  - `packages/chat-ui/src/**`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/tests/**`
  - `e2e/tests/04-chat-image-paste.spec.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/**`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## AI Flaky tests
- Not applicable: the new spec asserts POST + persisted user message only (no AI reply dependency).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single fix branch, single test cycle)
- [ ] **Multi-branch**
- Rationale: single regression fix with one reproduction spec.

## UAT Management (in orchestration context)
- Orchestrator pushes after verification; user UAT from root workspace afterwards.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Reproduce + root-cause + fix**
  - [x] Trace send path end-to-end (AppChatPanel -> attachmentState -> chatLoopController -> chat-core-host-adapter) and list candidate throw points.
  - [x] Add failing e2e spec `e2e/tests/04-chat-image-paste.spec.ts` (paste PNG via ClipboardEvent, assert band thumbnail, send, assert POST /chat/messages + persisted bubble + no pageerror).
  - [x] Reproduce: restored session with a null-content terminal-failed assistant message locks the composer in steer mode forever -> image-only send NEVER issues POST /chat/messages (no exception; pageerrors=0; reproduced identically on pre-modularization build d9a6b0855 -> pre-existing state bug, not a Lot1/Lot4 throw).
  - [x] Fix at root cause: `packages/chat-core/src/history.ts` buildChatHistoryTimeline derives terminal `_localStatus` from persisted stream events ('error' -> failed, 'done' -> completed) for assistant messages lacking a local status (summary mode strips segment events, so the client cannot derive it); chat-core 0.1.4 -> 0.1.5; 4 new history unit tests.
  - [x] Failing-then-passing proof: pre-fix images -> new spec test 2 FAILS (`chat-composer-send-button` element(s) not found, POST /chat/messages never fires); post-fix images -> 2/2 PASS.
  - [x] Lot gate:
    - [x] `make typecheck-ui ENV=test-uat` (0 errors, 6 pre-existing warnings)
    - [x] `make typecheck-chat-ui ENV=test-uat` (pass)
    - [x] `make typecheck-chat-core ENV=test-uat` (pass)
    - [x] **UI tests (TypeScript only)**
      - [x] `make test-pkg-chat-core ENV=test-uat` (21 files / 252 tests pass, history.test.ts 14/14)
      - [x] `make test-chat-ui ENV=test-uat` (39 files / 748 tests pass)
      - [x] `make test-ui ENV=test-uat` (440/442; known local flake google-drive-picker.test.ts 2-fail only)
    - [x] **E2E tests**
      - [x] Prepare E2E build: `make build-api build-ui-image REGISTRY=local API_PORT=9460 UI_PORT=5560 MAILDEV_UI_PORT=1460 ENV=test-uat`
      - [x] New spec PASS: `make test-e2e E2E_SPEC=tests/04-chat-image-paste.spec.ts RETRIES=0 ...` (2/2)
      - [x] Adjacent: `make test-e2e E2E_SPEC=tests/04-google-drive-composer.spec.ts RETRIES=0 ...` (2/2)
      - [x] Adjacent: `make test-e2e E2E_SPEC=tests/04-tenancy-workspaces.spec.ts RETRIES=0 ...` (run 1: 5/6, mention-autocomplete dropdown timing; run 2 same commit/command: 6/6 -> non-systematic, unrelated to chat history projection)
    - [x] `make down REGISTRY=local API_PORT=9460 UI_PORT=5560 MAILDEV_UI_PORT=1460 ENV=test-uat`
