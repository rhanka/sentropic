# Fix: Chat Loop Guard Analysis

## Objective
Prevent repeated tool-call and tool-error loops from freezing or saturating the browser tab while preserving legitimate multi-step tool use.

## Scope / Guardrails
- Scope limited to chat assistant turn execution, tool-call error handling, chat stream projection, chat rendering, and focused tests.
- No database migration planned.
- Make-only workflow, no direct Docker/npm commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/fix-chat-loop-guard-analysis`.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in code, docs, tests, commits, and PR body must be English.
- Start with systematic debugging; do not implement a guard before identifying the repeated-loop source.
- Do not add arbitrary timeouts or hide tool errors from the user.
- Do not touch BR19B catalog/product work in this branch.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/chat-service.ts`
  - `api/src/services/tools.ts`
  - `api/src/services/skills/foundation-executor.ts`
  - `api/tests/unit/chat-service-tools.test.ts`
  - `api/tests/unit/tools.test.ts`
  - `api/tests/ai/chat-tools.test.ts`
  - `api/tests/api/chat-tools.test.ts`
  - `api/tests/api/chat.test.ts`
  - `packages/chat-core/src/runtime-tool-dispatch.ts`
  - `packages/chat-core/src/runtime.ts`
  - `packages/chat-core/tests/runtime-tool-dispatch.test.ts`
  - `packages/chat-core/tests/integration/full-flow.test.ts`
  - `packages/chat-core/package.json`
  - `packages/chat-ui/src/utils/chat-run-projection.ts`
  - `packages/chat-ui/src/client/streamHistory.ts`
  - `packages/chat-ui/tests/stream-throughput.test.ts`
  - `packages/chat-ui/tests/chat-run-projection.test.ts`
  - `packages/chat-ui/package.json`
  - `ui/src/lib/stores/streamHub.ts`
  - `ui/src/lib/components/ChatPanel.svelte`
  - `ui/src/lib/components/StreamMessage.svelte`
  - `ui/src/lib/components/chat/**`
  - `ui/tests/stores/streamHub.test.ts`
  - `ui/tests/utils/chat-run-projection.test.ts`
  - `ui/tests/components/chat/**`
  - `e2e/tests/03-chat.spec.ts`
  - `e2e/tests/06-streams.spec.ts`
  - `e2e/tests/08-chat-heavy.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/skills/**`
  - `plan/19b-BRANCH_feat-mcp-tool-catalog.md`
  - `spec/SPEC_VOL_AGENT_SANDBOX_SKILLS.md`
  - `spec/SPEC_STUDY_SKILLS_TOOLS_VS_AGENT_MARKETPLACE.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `api/src/services/llm-runtime/**`
  - `api/src/routes/**`
  - `ui/src/lib/i18n/**`
  - `spec/**`
- **Exception process**:
  - Declare exception ID `CLG-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [ ] `attention`: Record reproduced failure signature before implementation, including whether the source is backend repeated events, frontend projection growth, rendering churn, or a combination.

## AI Flaky tests
- [ ] No AI flaky accepted yet.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: the loop guard and UI projection bounds are one runtime defect class and need one integrated test cycle.

## UAT Management (in orchestration context)
- UAT is performed on the integrated branch only after focused local checks and push.
- User UAT/dev remains on the root workspace with `ENV=dev`.
- Branch diagnostics and automated tests run from `tmp/fix-chat-loop-guard-analysis`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`.
  - [x] Read `rules/workflow.md`.
  - [x] Read `README.md`, `TODO.md`, and `PLAN.md`.
  - [x] Read scope-relevant rules: `rules/api-services.md`, `rules/testing.md`, `rules/ui-components.md`, `rules/components.md`, `rules/design-system.md`, `rules/architecture.md`.
  - [x] Confirm isolated worktree `tmp/fix-chat-loop-guard-analysis`.
  - [x] Confirm branch `fix/chat-loop-guard-analysis` is based on `origin/main` containing BR19 and PR #182.
  - [x] Copy root `.env` into the ignored branch worktree `.env`.
  - [x] Define environment mapping: branch dev `ENV=fix-chat-loop-guard-analysis`, tests `ENV=test-fix-chat-loop-guard-analysis`, e2e `ENV=e2e-fix-chat-loop-guard-analysis`.
  - [x] Define ports: API `9096`, UI `5296`, Maildev UI `1196`.
  - [x] Confirm command style: `make ... API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.

- [ ] **Lot 1 — Root cause investigation**
  - [x] Inspect backend assistant turn flow in `api/src/services/chat-service.ts` around tool-call iteration, tool result injection, and terminal assistant messages.
  - [x] Inspect tool execution/error normalization in `api/src/services/tools.ts`, `api/src/services/skills/foundation-executor.ts`, and `packages/chat-core/src/runtime-tool-dispatch.ts`.
  - [x] Inspect frontend stream projection in `ui/src/lib/stores/streamHub.ts`, `packages/chat-ui/src/client/streamHistory.ts`, and `packages/chat-ui/src/utils/chat-run-projection.ts`.
  - [x] Inspect chat rendering/projection in `ChatPanel.svelte`, `StreamMessage.svelte`, and chat wrapper components.
  - [ ] Reproduce a minimal repeated identical tool-error loop with a focused API/unit test or diagnostic fixture before implementing.
  - [ ] Record the failure signature in `## Feedback Loop`.
  - [ ] Lot gate:
    - [ ] Exact root cause stated before any production-code change.

- [ ] **Lot 2 — Backend repeated tool-error breaker**
  - [ ] Add a failing backend test for repeated same tool name plus same normalized error signature within one assistant turn.
  - [ ] Add a failing backend test proving changed arguments or changed error signature can still proceed.
  - [ ] Implement minimal breaker semantics in `packages/chat-core/src/runtime-tool-dispatch.ts`.
  - [ ] Ensure the terminal assistant-facing error is actionable and tells the model to stop retrying and ask the user or choose a different approach.
  - [ ] Preserve final transcript accuracy and visible tool error details.
  - [ ] Lot gate:
    - [ ] `make test-api SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [ ] `make typecheck-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [ ] `make lint-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`

- [ ] **Lot 3 — Frontend stream projection bound**
  - [ ] Add a failing UI/store test if diagnostics confirm unbounded duplicate tool-call deltas or projection churn.
  - [ ] Bound or compact long-running assistant-turn projection data in `packages/chat-ui` without changing final transcript accuracy.
  - [ ] Preserve reasoning/tool visibility while deduplicating or compacting repeated transient deltas.
  - [ ] Lot gate:
    - [ ] `make test-ui SCOPE=tests/stores/streamHub.test.ts API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [ ] `make test-ui SCOPE=tests/utils/chat-run-projection.test.ts API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [ ] `make typecheck-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [ ] `make lint-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`

- [ ] **Lot N-2 — UAT**
  - [ ] Web app: repeated identical tool-error loop terminates cleanly without freezing the browser.
  - [ ] Web app: normal multi-step tool workflow still works.
  - [ ] Web app: DOCX organization generation still completes.
  - [ ] Web app: PPTX organization generation still completes.
  - [ ] Web app: breaker-stopped loop shows an actionable user-visible error.

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [ ] `make lint-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [ ] `make typecheck-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [ ] `make lint-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [ ] `make test-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [ ] `make test-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [ ] Bump `packages/chat-core/package.json` if `packages/chat-core/src/**` changes.
  - [ ] Bump `packages/chat-ui/package.json` if `packages/chat-ui/src/**` changes.
  - [ ] Build before e2e: `make build-api build-ui-image API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=e2e-fix-chat-loop-guard-analysis`
  - [ ] E2E chat smoke: `make test-e2e E2E_SPEC=tests/03-chat.spec.ts API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=e2e-fix-chat-loop-guard-analysis`
  - [ ] Record PR body failure signature and chosen guard semantics.
  - [ ] Create/update PR using `BRANCH.md` text as PR body.
  - [ ] Verify PR CI.
  - [ ] Once UAT + CI are both OK, commit removal of `BRANCH.md`, push, and merge.
