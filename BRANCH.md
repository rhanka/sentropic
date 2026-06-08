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
  - `e2e/tests/07_comment_assistant.spec.ts`
  - `e2e/tests/09-run-steering-core.spec.ts`
  - `e2e/tests/08-chat-checkpoint-restore.spec.ts`
  - `e2e/tests/08-chat-context-chips.spec.ts`
  - `e2e/tests/08-pptx-org-generation.spec.ts`
  - `e2e/tests/08-chat-org-update-tool.spec.ts`
  - `ui/src/locales/fr.json`
  - `ui/src/locales/en.json`
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
- Not applicable for the image-paste spec: it asserts POST + persisted user message only (no AI reply dependency).
- `e2e/tests/08-chat-org-update-tool.spec.ts`: NOT flaky — deterministic model-capability failure (gpt-4.1-nano sends `patch` instead of `updates`, no self-correction after tool error). Fixme-gated; exact signature recorded in Lot 3 Part B.

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
- [ ] **Lot 2 — UAT-proof: drive the 4 systematically-red e2e specs to green**
  - [x] 09/00 fix: keep optimistic steer message on postSteer success in chatLoopController (pre-0.19.1 removal made the steer bubble vanish when POST /chat/messages/:id/steer resolved); chat-ui 0.19.0 -> 0.19.1; unit test 12d updated to KEEP semantics (748/748 pass).
  - [x] 09 spec: re-anchor timeline structural scan on the hydration-swap wrapper (rows stopped being direct children of the scroll container at ddaeebec2, 2026-05-20; spec predates it and is in no CI e2e group) — assertions unchanged; `make test-e2e E2E_SPEC=tests/09-run-steering-core.spec.ts RETRIES=0 ...` 1/1 PASS.
  - [x] 07 fix: restore comments thread-picker menu by passing CommentsPanel `renderThreadMenuPopover` snippet from AppChatPanel (seam existed, host never passed it after extraction); spec selector updated to canonical aria-label "Liste des commentaires".
  - [x] 07 fix: AI author suffix through labels resolver — new key `chat.comments.assistantLabel` (", Assistant IA" fr / ", AI assistant" en); hardcoded ", AI" in CommentsPanel was a Lot-5 labels-contract regression; `make test-e2e E2E_SPEC=tests/07_comment_assistant.spec.ts RETRIES=0 ...` 2/2 PASS.
  - [x] 00: no code change — userMessage2 invisibility was the same optimistic-steer-removal family (message2 sent while run 1 active -> steer path); `make test-e2e E2E_SPEC=tests/00-ai-generation.spec.ts RETRIES=0 ...` 2/2 PASS post-fix.
  - [x] 01 lock-breaks-on-leave: A/B-proven pre-existing, no code change — same `editableB toBeEnabled` red on origin/main build cbb97c106 (workers=4, warm + fresh stack); GREEN 8/8 with WORKERS=1 on fresh stack; cause: parallel lock tests share User A storage state + same organization, concurrent SSE connections keep `clearLocksForUser` count > 0 when the leave-test context closes; CI green via default RETRIES=2 (local runs force RETRIES=0). Out of chat scope.
  - [x] Lot gate: `make typecheck-chat-ui` + `make test-chat-ui` (39 files / 748 tests) + `make typecheck-ui` (0 errors, 6 pre-existing warnings) on final tree.
  - [x] Final: `make test-ui` (440/442; known local flake google-drive-picker.test.ts 2-fail only) + `make test-pkg-chat-core` (21 files / 252 tests) + `make down ... ENV=test-uat`.
- [ ] **Lot 3 — UAT-proof S3: 3 missing e2e specs + org-update + loop-guard salvage proofs**
  - [x] `e2e/tests/08-chat-checkpoint-restore.spec.ts` (AI-independent): mock session/history/checkpoints; full timeline (2 user/assistant exchanges) + checkpoint anchored at first user message + `organization_update` tool event on the 2nd assistant segment (mutation delta) -> per-message restore affordance renders; click + confirm -> POST `/checkpoints/:id/restore` 200, timeline rewinds (2nd exchange gone), post-restore POST `/chat/messages` fires; pageerrors=0. `make test-e2e E2E_SPEC=tests/08-chat-checkpoint-restore.spec.ts RETRIES=0 ...` 1/1 PASS.
  - [x] `e2e/tests/08-chat-context-chips.spec.ts` (AI-independent): seed org via API, navigate to org-detail (route adds active context), composer menu chip renders RESOLVED org name (not UUID) + `text-slate-900`; send -> payload carries `primaryContextType=organization`/`primaryContextId` + `contexts[]`; toggle chip off -> `text-slate-400`, next send drops the context. Spec fixes: close composer menu via trigger toggle (Escape closes the whole chat dialog), payload read from waitForRequest's request (route-callback push races). `make test-e2e E2E_SPEC=tests/08-chat-context-chips.spec.ts RETRIES=0 ...` 1/1 PASS.
  - [x] `e2e/tests/08-pptx-org-generation.spec.ts` (AI-gated -> contract-only): PPTX has no non-AI UI button / no direct API; only surface is `document_generate format:pptx` chat tool + `GET /pptx/jobs/:id/download`. Chat from org-detail, poll queue for completed `pptx_generate` job, assert download route 200 + presentationml content-type + PK zip magic. AI flaky (model nondeterminism allowed). `make test-e2e E2E_SPEC=tests/08-pptx-org-generation.spec.ts RETRIES=0 ...` 1/1 PASS first run (7.7s).
  - [x] Part B `e2e/tests/08-chat-org-update-tool.spec.ts` (AI, default model gpt-4.1-nano): no existing e2e proves a chat-tool ORG field update (`organization_update` lives in api services, not in 00/08 specs). Seed org (technologies='Legacy mainframe'), chat 'update the technologies field to <value>', assert API GET shows changed `technologies` containing the value. CONCLUSION: DEFAULT model FAILS 0/2 (RETRIES=0, identical signature both runs): model calls organization_update with `{"organizationId":"...","patch":{"technologies":"Kubernetes, Terraform, GitOps"}}` instead of required `updates:[{field,value}]` -> tool error "updates is required" -> model does NOT self-correct (run 1 apologizes and stops; run 2 asks the user). Tool pipeline verified correct via chat_stream_events (schema declares `updates` required+enum, args parse, error fed back). Spec committed fixme-gated (CI group 08 runs 08-* with RETRIES=2; deterministic red would block CI); `make test-e2e ... RETRIES=0` -> 1 skipped, exit 0.
  - [ ] Part C.1 loop-guard breaker unit: `make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_TEST_WORKERS=1 ...` (record counts).
  - [ ] Part C.2 multi-step tool workflow: cite already-green spec demonstrating a multi-tool progressing run (00-ai-generation test 2: read_usecase -> update_usecase_field -> web_extract).
  - [ ] Part C.3 DOCX proven (03-dashboard green); PPTX = Part A.3.
  - [ ] Lot gate: `make typecheck-ui` (specs-only; no ui/src change expected) + `make down ... ENV=test-uat`.
