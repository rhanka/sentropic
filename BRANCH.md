# Fix: Chat Loop Guard (post-history-purge respin)

## Objective
Reapply the repeated-tool-error loop breaker (chat-core dispatch breaker + chat-service outer-loop sync) on the **purged `main`** after the secret-history rewrite. Prevent repeated tool-call/tool-error loops from freezing or saturating the browser tab while preserving legitimate multi-step tool use.

## Scope / Guardrails
- Scope limited to chat assistant turn execution, tool-call error handling, and focused tests.
- No database migration.
- Make-only workflow, no direct Docker/npm commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); branch dev in isolated worktree `tmp/fix-chat-loop-guard-v2`.
- Automated tests on dedicated envs only (`ENV=test-fix-chat-loop-guard-v2`).
- `ENV=<env>` last in every `make` command.
- All new text English.
- **Secret-history guardrail** (post-purge): branch MUST NOT (re-)introduce any file under `deploy/k8s/0[0-9]-sealed-*.yaml`, any `kind: SealedSecret` manifest, any long base64 payload, or any plaintext credential. Verified at branch creation; re-verify before push.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `BRANCH.md`
  - `package-lock.json`
  - `api/src/services/chat-service.ts`
  - `api/tests/unit/chat-service-tools.test.ts`
  - `packages/chat-core/src/runtime-tool-dispatch.ts`
  - `packages/chat-core/src/runtime.ts`
  - `packages/chat-core/src/runtime-run-prepare.ts`
  - `packages/chat-core/tests/runtime-tool-dispatch.test.ts`
  - `packages/chat-core/package.json`
- **Forbidden Paths**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/skills/**`
  - `deploy/**` (post-purge guardrail — secrets must not return)
  - `plan/NN-BRANCH_*.md` (any other branch file)
- **Conditional Paths** (require `CLG3-EXn` exception):
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `api/src/services/llm-runtime/**`
  - `api/src/routes/**`
  - `e2e/tests/03-chat.spec.ts`
  - `packages/chat-ui/**`
  - `ui/**`
  - `spec/**`
- **Exception process**: declare `CLG3-EXn` in `## Feedback Loop` with rationale + impact + rollback before touching any conditional/forbidden path.

## Feedback Loop
- [ ] Branch context: respin of the chat-loop-guard fix after the secret-history force-push on `main` (closed PR #227 + branches `fix/chat-loop-guard` and `uat/fix-loop` preserved as historical reference). New base = `origin/main` `968b2c241` (post-purge).
- [ ] Cherry-pick origin: 2 commits from the closed branch are reused verbatim onto purged main: `a6f40df2` (chat-core breaker) and `4c76e968` (api sync line). BRANCH.md modifications from those commits were dropped on cherry-pick (BRANCH.md is now an in-branch artifact created from `plan/BRANCH_TEMPLATE.md`, deleted pre-merge per repo policy).
- [ ] Before/after measurement carried over (live-run on 2026-06-02 in the pre-purge worktree with sync line removed): pre-fix scenario rides to **11 LLM calls** (`BASE_MAX_ITERATIONS=10` + 1 pass-2 fallback); post-fix breaker caps at **4 LLM calls** (3 attempts + pass-2). Reduction 64 %. New base on purged main reuses the same logic verbatim — measurement holds.
- [ ] Secret-history audit (mandatory): tree scanned for `kind: SealedSecret`, `encrypted_data`, long base64 lines, AWS/GCP/OpenAI/Anthropic key patterns — **all clean**; matches limited to doc references (`Makefile` comments, `deploy/k8s/README.md`, `docs/uat/*-deploy-poc-k8s-*.md`, `plan/done/37b/c-*.md`). Re-verify before push.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Pre-recorded flaky carried from PR #227 (closed): `api/tests/ai/chat-sync.test.ts` (`should generate assistant response with AI` 15 s timeout; `should generate response with tool calls` jobCompleted false at 30 s). Signature: provider/network latency under CI parallel load. If it recurs on this branch, re-validate the signature on this commit (same-commit CI rerun + local repro) before reusing the prior sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: breaker + sync = one runtime defect class, integrated test cycle.

## UAT Management
- **Mono-branch**: UAT on integrated branch after push, on root workspace `ENV=dev`.
- Branch diagnostics and automated tests run from `tmp/fix-chat-loop-guard-v2`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/conductor.md`, `rules/subagents.md`, `rules/testing.md`.
  - [x] Confirm isolated worktree `tmp/fix-chat-loop-guard-v2` based on `origin/main` (`968b2c241`, post-purge).
  - [x] Copy root `.env` into the worktree.
  - [x] Define environment mapping: `ENV=fix-chat-loop-guard-v2`, tests `ENV=test-fix-chat-loop-guard-v2`, e2e `ENV=e2e-fix-chat-loop-guard-v2`.
  - [x] Define ports: API `9096`, UI `5296`, Maildev UI `1196` (re-using the slot from the closed PR #227 — currently free).
  - [x] Confirm command style: `make ... API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Secret-history audit done (see `## Feedback Loop`).

- [x] **Lot 1 — Cherry-pick chat-core breaker onto purged main**
  - [x] Cherry-pick `a6f40df2` (chat-core breaker). BRANCH.md conflict resolved by dropping the legacy `BRANCH.md` modification (file is now branch-local + deleted pre-merge per repo policy). All chat-core src + tests + version bump + lockfile applied cleanly. Re-committed as `d1a38f45a` on this branch (same logical change; commit SHA differs).
  - [x] Confirm cherry-pick scope: `packages/chat-core/src/runtime-tool-dispatch.ts`, `runtime.ts`, `runtime-run-prepare.ts`, `tests/runtime-tool-dispatch.test.ts`, `package.json` 0.1.3 → 0.1.4, `package-lock.json` aligned.

- [x] **Lot 2 — Cherry-pick api sync line + regression test onto purged main**
  - [x] Cherry-pick `4c76e968`. BRANCH.md conflict resolved by drop. `api/src/services/chat-service.ts` auto-merged cleanly; sync line correctly placed at L3894 immediately after the `streamSeq` + `contextBudgetReplanAttempts` syncs from `consumeToolCalls`. `api/tests/unit/chat-service-tools.test.ts` test added. Re-committed as `711c0a58e` on this branch.

- [ ] **Lot 3 — Lot 1 + 2 gates on purged main**
  - [ ] `make typecheck-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-v2`
  - [ ] `make test-pkg-chat-core API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-v2`
  - [ ] `make typecheck-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-v2`
  - [ ] `make lint-api API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-v2`
  - [ ] `make test-api-unit SCOPE=tests/unit/chat-service-tools.test.ts API_TEST_WORKERS=1 API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-v2`

- [ ] **Lot 4 — Non-regression UI/chat-ui (not touched; safety check)**
  - [ ] `make typecheck-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-v2`
  - [ ] `make lint-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-v2`
  - [ ] `make typecheck-chat-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-v2`
  - [ ] `make test-chat-ui API_PORT=9096 UI_PORT=5296 MAILDEV_UI_PORT=1196 ENV=test-fix-chat-loop-guard-v2`

- [ ] **Lot N-2 — UAT (root workspace, `ENV=dev`)**
  - [ ] Web app: repeated identical tool-error loop terminates cleanly without freezing the browser tab.
  - [ ] Web app: normal multi-step tool workflow (legitimate progressing plan/todo) still works.
  - [ ] Web app: DOCX organization generation still completes.
  - [ ] Web app: PPTX organization generation still completes.
  - [ ] Web app: breaker-stopped loop shows an actionable user-visible error (`tool_loop_repeated_error` surface).

- [ ] **Lot N — Final validation**
  - [ ] Final secret-history re-scan before push: `git ls-files | xargs grep -lE "kind: SealedSecret|encrypted_data|BEGIN.* (RSA|PRIVATE) KEY"` returns empty.
  - [ ] `git diff --check`
  - [ ] Confirm `packages/chat-core/package.json` 0.1.4 vs main 0.1.3 (patch bump for additive optional state field — additive, within consumers' `^0.1.2` range).
  - [ ] Create PR using `BRANCH.md` text as PR body (link the closed PR #227 in the description for context and reference the post-purge respin).
  - [ ] Verify PR CI.
  - [ ] Once UAT + CI are both OK, commit removal of `BRANCH.md`, push, and merge.
