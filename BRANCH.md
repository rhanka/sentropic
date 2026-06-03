# Fix: Chat Loop Guard

## Objective
Reapply the repeated-tool-error loop breaker (chat-core dispatch breaker + chat-service outer-loop sync) plus the chat-ui stream projection compaction on current `main`, after BR-38a/BR-41a refactored the dispatch into `ChatRuntime.consumeToolCalls`. Prevent repeated tool-call/tool-error loops from freezing or saturating the browser tab while preserving legitimate multi-step tool use.

## Scope / Guardrails
- Scope limited to chat assistant turn execution, tool-call error handling, chat stream projection, chat rendering, and focused tests.
- No database migration planned.
- Make-only workflow, no direct Docker/npm commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/fix-chat-loop-guard`.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in code, docs, tests, commits, and PR body must be English.
- Start by reading current `ChatRuntime.consumeToolCalls` structure before reimplementing; do not pattern-match the closed PR #183 diff blindly — the post-Lot-21e-2 dispatch lives inside chat-core now.
- Do not add arbitrary timeouts or hide tool errors from the user.
- Do not introduce a generic max-iteration cap; the guard must trigger only on signature-repeated errors.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `package-lock.json`
  - `api/src/services/chat-service.ts`
  - `api/tests/unit/chat-service-tools.test.ts`
  - `packages/chat-core/src/runtime-tool-dispatch.ts`
  - `packages/chat-core/src/runtime.ts`
  - `packages/chat-core/src/runtime-run-prepare.ts`
  - `packages/chat-core/tests/runtime-tool-dispatch.test.ts`
  - `packages/chat-core/package.json`
  - `packages/chat-ui/src/utils/chat-run-projection.ts`
  - `packages/chat-ui/src/client/streamHistory.ts`
  - `packages/chat-ui/tests/stream-throughput.test.ts`
  - `packages/chat-ui/tests/chat-run-projection.test.ts`
  - `packages/chat-ui/package.json`
  - `ui/tests/utils/chat-run-projection.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/skills/**`
  - `plan/NN-BRANCH_*.md` (any branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `api/src/services/llm-runtime/**`
  - `api/src/routes/**`
  - `e2e/tests/03-chat.spec.ts`
  - `e2e/tests/06-streams.spec.ts`
  - `e2e/tests/08-chat-heavy.spec.ts`
  - `ui/src/lib/components/chat/**`
  - `ui/src/lib/stores/streamHub.ts`
  - `spec/**`
- **Exception process**:
  - Declare exception ID `CLG2-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [ ] Branch context: replaces closed PR #183 (fix/chat-loop-guard-analysis, 397 commits behind main when closed). Old worktree `tmp/fix-chat-loop-guard-analysis` and its branch remain untouched as historical reference.
- [ ] Before/after measurement carried over from the old branch (live-run on 2026-06-02 in `tmp/fix-chat-loop-guard-analysis` with sync line removed): pre-fix scenario rides to **11 LLM calls** (`BASE_MAX_ITERATIONS=10` + 1 pass-2 fallback); post-fix breaker caps at **4 LLM calls** (3 tentatives + pass-2). Reduction 64 %. Reapply target on current main MUST preserve this signature.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Pre-recorded flaky carried from PR #183: `api/tests/ai/chat-sync.test.ts` (`should generate assistant response with AI` 15 s timeout; `should generate response with tool calls` jobCompleted false at 30 s). Signature: provider/network latency under CI parallel load. If it recurs on this branch, re-validate the signature on this commit (same-commit CI rerun + local repro) before reusing the prior sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: the loop guard breaker, the api-side sync, and the UI projection bound form one runtime defect class and need one integrated test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch after push, on the user's root workspace (`ENV=dev`).
- Branch diagnostics and automated tests run from `tmp/fix-chat-loop-guard`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/conductor.md`, `rules/subagents.md`, `rules/testing.md`.
  - [x] Confirm isolated worktree `tmp/fix-chat-loop-guard` based on `origin/main` (`90323a6b`).
  - [x] Copy root `.env` into the worktree.
  - [x] Define environment mapping: branch dev `ENV=fix-chat-loop-guard`, tests `ENV=test-fix-chat-loop-guard`, e2e `ENV=e2e-fix-chat-loop-guard`.
  - [x] Define ports: API `9096`, UI `5296`, Maildev UI `1196` (carried over from PR #183 ports; free at branch start).
  - [x] Confirm command style: `make ... API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — chat-core repeated-tool-error breaker (post-Lot-21e refactor)**
  - [x] Read `packages/chat-core/src/runtime-tool-dispatch.ts` on current main; locate the per-tool dispatch body and the catch path (`{status:'error'}` envelope returns and thrown errors).
  - [x] Add `toolErrorSignatureCounts?: Record<string, number>` to `AssistantRunLoopState` in `packages/chat-core/src/runtime.ts`.
  - [x] Initialize `toolErrorSignatureCounts: {}` in `packages/chat-core/src/runtime-run-prepare.ts` next to `continueGenerationLoop`.
  - [x] In `runtime-tool-dispatch.ts`:
    - [x] Add signature helpers: `normalizeLoopGuardText`, `normalizeLoopGuardArgs` (strip request_id/trace_id/timestamps/UUIDs/numeric IDs), `buildToolLoopSignature(toolName, args, errorMessage)`.
    - [x] Add `incrementToolLoopErrorCount(loopState, toolName, args, errorMessage)` and `getReturnedToolErrorMessage(result)` (detects `{status:'error', code?, error?|message?}` returns that do not throw).
    - [x] On the 3rd identical normalized signature (threshold = 2 → trip on count > 2), set `loopState.continueGenerationLoop = false`, emit a `tool_call_result` carrying `{status:'error', code:'tool_loop_repeated_error', error:..., repeat_count, tool_name}`, return `shouldBreakLoop: true` and exit the per-tool loop early.
    - [x] Refactor success/error accumulator pushes into a single `pushToolAccumulator` helper to avoid double-tracking the signature.
  - [x] Add `packages/chat-core/tests/runtime-tool-dispatch.test.ts`:
    - [x] `trips a terminal loop breaker after repeated identical returned tool errors in one assistant turn`
    - [x] `normalizes noisy thrown tool errors before tripping the loop breaker`
    - [x] `does not trip the repeated-error breaker when tool arguments change meaningfully`
  - [x] Bump `packages/chat-core/package.json` (patch 0.1.3 → 0.1.4 — new optional state field on `AssistantRunLoopState`, additive, stays within consumers' `^0.1.2` range; aligned `package-lock.json` chat-core entry).
  - [x] Lot gate:
    - [x] `make typecheck-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
    - [x] `make test-pkg-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard` (21 files, 248 tests; `runtime-tool-dispatch.test.ts` 22 → 25 tests)

- [x] **Lot 2 — chat-service outer-loop sync line**
  - [x] Read `api/src/services/chat-service.ts` around the post-`consumeToolCalls` "thin invocation + state sync" block (L3887-3893 on current main): identified insertion after `streamSeq`/`contextBudgetReplanAttempts` are synced back.
  - [x] Add `continueGenerationLoop = loopState.continueGenerationLoop;` immediately after the existing sync of `streamSeq` and `contextBudgetReplanAttempts` so the outer `while (continueGenerationLoop)` honors the breaker's stop signal.
  - [x] Add regression test `should stop repeated identical tool validation errors before the max-iteration fallback` in `api/tests/unit/chat-service-tools.test.ts`:
    - [x] Mock `callLLMStream` to always emit a `plan` tool call with invalid `{action:'unknown'}` args when tools are enabled.
    - [x] Assert `calls.length === 4` (3 tool-enabled attempts + 1 pass-2 with `toolChoice: 'none'`).
    - [x] Confirm the pre-existing `should continue beyond 10 iterations when active TODO can progress without user input` still passes (legitimate progression untouched).
  - [x] Lot gate:
    - [x] `make typecheck-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
    - [x] `make lint-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
    - [x] `make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard` (17 tests, including the new `should stop repeated identical tool validation errors before the max-iteration fallback`)

- [ ] **Lot 3 — chat-ui stream projection compaction** *(deferred)*
  - On-main analysis: `packages/chat-ui/src/utils/chat-run-projection.ts` (200 LOC) already deduplicates by `sequence` in both `appendLiveProjectionEvent` (line 198) and `mergeProjectionHistoryEvents` (Map by sequence). The original PR #183 compaction targeted the live unbounded delta flood. With the Lot 1 backend breaker capping repeated identical tool errors at **3 attempts + 1 pass-2 = 4 LLM calls** per turn, the flood is structurally bounded upstream — the secondary UI compaction is speculative without direct evidence on current main.
  - Decision: defer chat-ui projection compaction. Reopen only if the UAT in Lot N-2 surfaces residual tab saturation after the backend breaker. If reopened, do so on a dedicated `fix/chat-ui-projection-compaction` branch with concrete reproduction (failing `stream-throughput.test.ts` asserting unbounded growth on a synthetic flood) before code changes.

- [ ] **Lot N-2 — UAT (root workspace, `ENV=dev`)**
  - [ ] Web app: repeated identical tool-error loop terminates cleanly without freezing the browser tab.
  - [ ] Web app: normal multi-step tool workflow (legitimate progressing plan/todo) still works.
  - [ ] Web app: DOCX organization generation still completes.
  - [ ] Web app: PPTX organization generation still completes.
  - [ ] Web app: breaker-stopped loop shows an actionable user-visible error (`tool_loop_repeated_error` surface).

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make lint-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make typecheck-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make lint-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make typecheck-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make typecheck-chat-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make test-pkg-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make test-chat-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make test-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make test-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard`
  - [ ] `make test-api-ai API_TEST_WORKERS=1 API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard` (document any flaky signatures vs the carry-over note above)
  - [ ] `git diff --check`
  - [ ] Confirm `packages/chat-core/package.json` version bump if `packages/chat-core/src/**` changed.
  - [ ] Confirm `packages/chat-ui/package.json` version bump if `packages/chat-ui/src/**` changed.
  - [ ] Build before e2e: `make build-api build-ui-image API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=e2e-fix-chat-loop-guard`
  - [ ] E2E chat smoke: `make test-e2e E2E_SPEC=tests/03-chat.spec.ts WORKERS=1 RETRIES=0 API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=e2e-fix-chat-loop-guard`
  - [ ] Create PR using `BRANCH.md` text as PR body (link the closed PR #183 in the description for context).
  - [ ] Verify PR CI.
  - [ ] Once UAT + CI are both OK, commit removal of `BRANCH.md`, push, and merge.
