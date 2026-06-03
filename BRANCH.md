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
  - `package-lock.json`
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
  - `api/tests/ai/initiative-generation-async.test.ts` (`CLG-EX1`, test-only AI validation contract alignment)
  - `api/tests/api/locks.test.ts` (`CLG-EX2`, test-only endpoint validation fixture stabilization)
  - `api/tests/api/workspace-types.test.ts` (`CLG-EX2`, test-only endpoint validation fixture stabilization)
  - `api/tests/api/workspaces.test.ts` (`CLG-EX2`, test-only endpoint validation fixture stabilization)
  - `ui/src/lib/i18n/**`
  - `spec/**`
- **Exception process**:
  - Declare exception ID `CLG-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `attention`: Reproduced failure signature recorded. Backend root cause was repeated identical tool errors being fed back into the assistant loop until the outer max-iteration fallback; returned `{ status: "error" }` tool envelopes were especially important because they did not throw. Frontend root cause was unbounded live projection churn for repeated status/tool events during the same assistant turn. The focused API regression initially observed 11 LLM calls before the loop guard/sync fix reduced this to three tool-enabled attempts plus the existing pass-2 fallback.
- [x] `review`: Added explicit regression coverage for thrown tool exceptions whose request/trace IDs vary between attempts; signature normalization still trips the same repeated-error breaker.
- [x] `CLG-EX1`: Scope exception for `api/tests/ai/initiative-generation-async.test.ts`. Reason: final API validation exposed an over-constrained AI fixture unrelated to chat loop production code; the multi-org prompt contract allows empty `organizationIds` when no provided organization confidently matches. Impact: test-only contract alignment plus outer timeout alignment with existing internal waits. Rollback: revert the test-only hunk and rerun `make test-api-ai SCOPE=tests/ai/initiative-generation-async.test.ts`.
- [x] `CLG-EX2`: Scope exception for endpoint auth fixtures in `locks`, `workspace-types`, and `workspaces` API tests. Reason: final endpoint validation exposed fixed-email fixture collisions unrelated to chat loop production code. Impact: test-only fixture isolation using unique emails while preserving endpoint behavior coverage. Rollback: revert the three endpoint test hunks and rerun the scoped endpoint suite.
- [x] Lockfile review: `package-lock.json` also normalizes the existing `packages/skills` workspace snapshot while syncing `@sentropic/chat-core` and `@sentropic/chat-ui` versions; no `packages/skills/**` files changed on this branch. Retained because no-cache API/UI builds and package/UI test installs passed with this lockfile.

## AI Flaky tests
- [x] Accepted AI flaky (user sign-off 2026-05-26): CI shard `test-api-unit-integration (ai, chat-sync,executive-summary-auto,comment-assistant)`, file `api/tests/ai/chat-sync.test.ts`.
  - Failing cases on run #875 (`26384425263`): `should generate assistant response with AI` (timed out at 15000ms; trivial "Say hello" prompt with no tool call, so unrelated to the loop guard) and `should generate response with tool calls` (`jobCompleted` false at 30000ms).
  - Failure signature: provider/network latency under CI parallel load, not a code regression.
  - Evidence: same-commit rerun of run `26384425263` re-ran the shard to `success`; local reproduction `make test-api-ai SCOPE=tests/ai/chat-sync.test.ts API_TEST_WORKERS=1 API_PORT=9098 UI_PORT=5298 MAILDEV_UI_PORT=1198 ENV=test-fix-chat-loop-guard-analysis-full2` passed all 4 tests (the two failing cases completed in 2997ms and 4005ms).
  - Non-blocking per `rules/testing.md` AI flaky allowlist (`api/tests/ai/**`).
- [x] `CLG-EX1` is a test contract alignment validated by the full AI suite, not an accepted flaky waiver.

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

- [x] **Lot 1 — Root cause investigation**
  - [x] Inspect backend assistant turn flow in `api/src/services/chat-service.ts` around tool-call iteration, tool result injection, and terminal assistant messages.
  - [x] Inspect tool execution/error normalization in `api/src/services/tools.ts`, `api/src/services/skills/foundation-executor.ts`, and `packages/chat-core/src/runtime-tool-dispatch.ts`.
  - [x] Inspect frontend stream projection in `ui/src/lib/stores/streamHub.ts`, `packages/chat-ui/src/client/streamHistory.ts`, and `packages/chat-ui/src/utils/chat-run-projection.ts`.
  - [x] Inspect chat rendering/projection in `ChatPanel.svelte`, `StreamMessage.svelte`, and chat wrapper components.
  - [x] Reproduce a minimal repeated identical tool-error loop with a focused API/unit test or diagnostic fixture before implementing.
  - [x] Record the failure signature in `## Feedback Loop`.
  - [x] Lot gate:
    - [x] Exact root cause stated before production-code integration.

- [x] **Lot 2 — Backend repeated tool-error breaker**
  - [x] Add a failing backend test for repeated same tool name plus same normalized error signature within one assistant turn.
  - [x] Add a failing backend test proving changed arguments or changed error signature can still proceed.
  - [x] Implement minimal breaker semantics in `packages/chat-core/src/runtime-tool-dispatch.ts`.
  - [x] Ensure the terminal assistant-facing error is actionable and tells the model to stop retrying and ask the user or choose a different approach.
  - [x] Preserve final transcript accuracy and visible tool error details.
  - [x] Lot gate:
    - [x] `make test-pkg-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [x] `make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [x] `make typecheck-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [x] `make typecheck-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [x] `make lint-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis` (0 errors, existing warnings only)

- [x] **Lot 3 — Frontend stream projection bound**
  - [x] Add a failing UI/store test if diagnostics confirm unbounded duplicate tool-call deltas or projection churn.
  - [x] Bound or compact long-running assistant-turn projection data in `packages/chat-ui` without changing final transcript accuracy.
  - [x] Preserve reasoning/tool visibility while deduplicating or compacting repeated transient deltas.
  - [x] Lot gate:
    - [x] `make test-chat-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
    - [x] `make typecheck-chat-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`

- [ ] **Lot N-2 — UAT**
  - [ ] Web app: repeated identical tool-error loop terminates cleanly without freezing the browser.
  - [ ] Web app: normal multi-step tool workflow still works.
  - [ ] Web app: DOCX organization generation still completes.
  - [ ] Web app: PPTX organization generation still completes.
  - [ ] Web app: breaker-stopped loop shows an actionable user-visible error.

- [ ] **Lot N — Final validation**
  - [x] `make typecheck-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [x] `make lint-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis` (0 errors, existing warnings only)
  - [x] `make typecheck-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis` (0 errors, existing warnings only)
  - [x] `make lint-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [x] `make typecheck-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [x] `make typecheck-chat-ui API_PORT=9098 UI_PORT=5298 MAILDEV_UI_PORT=1198 ENV=test-fix-chat-loop-guard-analysis-full2`
  - [x] `make test-pkg-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [x] `make test-chat-ui API_PORT=9098 UI_PORT=5298 MAILDEV_UI_PORT=1198 ENV=test-fix-chat-loop-guard-analysis-full2` (19 files, 84 tests)
  - [x] `make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-analysis`
  - [x] `make test-api API_PORT=9098 UI_PORT=5298 MAILDEV_UI_PORT=1198 ENV=test-fix-chat-loop-guard-analysis-full2` (literal wrapper rerun passed: smoke 6 tests; unit 496 passed, 1 skipped; endpoints 440 tests; queue 20 tests; security 49 tests; AI 30 tests; limit 4 tests)
  - [x] `make test-api-smoke test-api-unit test-api-endpoints test-api-queue test-api-security API_PORT=9098 UI_PORT=5298 MAILDEV_UI_PORT=1198 ENV=test-fix-chat-loop-guard-analysis-full2` (smoke 6 tests; unit 496 passed, 1 skipped; endpoints 440 tests; queue 20 tests; security 49 tests)
  - [x] `make test-api-ai API_TEST_WORKERS=1 API_PORT=9098 UI_PORT=5298 MAILDEV_UI_PORT=1198 ENV=test-fix-chat-loop-guard-analysis-full2` (9 files, 30 tests)
  - [x] `make test-api-limit API_PORT=9098 UI_PORT=5298 MAILDEV_UI_PORT=1198 ENV=test-fix-chat-loop-guard-analysis-full2` (1 file, 4 tests)
  - [x] `make test-ui API_PORT=9098 UI_PORT=5298 MAILDEV_UI_PORT=1198 ENV=test-fix-chat-loop-guard-analysis-full2` (68 files, 404 tests)
  - [x] `make lint-ui API_PORT=9098 UI_PORT=5298 MAILDEV_UI_PORT=1198 ENV=test-fix-chat-loop-guard-analysis-full2`
  - [x] `git diff --check`
  - [x] Bump `packages/chat-core/package.json` if `packages/chat-core/src/**` changes.
  - [x] Bump `packages/chat-ui/package.json` if `packages/chat-ui/src/**` changes.
  - [x] Build before e2e: `make build-api build-ui-image API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=e2e-fix-chat-loop-guard-analysis`
  - [x] E2E chat smoke: `make test-e2e E2E_VERSION=d66824 E2E_SPEC=tests/03-chat.spec.ts WORKERS=1 RETRIES=0 API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=e2e-fix-chat-loop-guard-analysis` (12 tests, no retries; reused existing local E2E image because tests are bind-mounted and current-tag Playwright image rebuild stalled locally)
  - [x] Record PR body failure signature and chosen guard semantics.
  - [x] Create/update PR using `BRANCH.md` text as PR body: https://github.com/rhanka/sentropic/pull/183
  - [ ] Verify PR CI.
  - [ ] Once UAT + CI are both OK, commit removal of `BRANCH.md`, push, and merge.
