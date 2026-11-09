# Feature: Fix live teardown stuck (Background delete, RECOVERING progress, reasons)

## Objective
- Unstick live teardown after a dead worker pod: Background deletes, skip quiesce on gone/terminal/terminating pods, RECOVERING progresses on scheduler tick to DORMANT, every builder_unavailable carries a reason persisted as code:reason.

## Scope / Guardrails
- Scope limited to api live teardown path and scoped api unit tests.
- Make-only workflow, Docker only through .tmp/packets/docker-slot.sh.
- Never ENV=dev, never make clean-all, no Python, commits via make commit MSG="..." only.
- ENV=test-fix-live-teardown with API_PORT=8881 UI_PORT=5281 MAILDEV_UI_PORT=1181.
- All new text in English.
- Do NOT change the frozen host contract (RECONCILE/PAGE/SEAL/STOP key sets, DRAFT_LIMITS) and do not touch packages/artifacts.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md` (branch plan)
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
  - `.tmp/rv/fix-live-teardown.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] lot0-env: owned ENV=test-fix-live-teardown and ports API_PORT=8881 UI_PORT=5281 MAILDEV_UI_PORT=1181 recorded

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single orthogonal api-only fix with scoped unit tests.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints are listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/fix-live-teardown`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/fix-live-teardown` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, .tmp/packets/COMMON-RULES.md, .tmp/rv/diag-live-pod-delete.md sections 1-3.
  - [x] Worktree tmp/worktrees/fix-live-teardown on branch fix/artifacts-live-teardown-stuck from origin/main (6b2fc2295, includes #966).
  - [x] Verify branch with git -C <wt> branch --show-current before any action.
  - [x] ENV=test-fix-live-teardown, API_PORT=8881 UI_PORT=5281 MAILDEV_UI_PORT=1181.
  - [x] Confirm scope and guardrails (api only, no host contract change, no packages/artifacts).
- [x] **Lot 1 — Generic live teardown fixes (api only)**
  - [x] kubernetes.ts: delete pods and services with propagationPolicy Background, keep uid preconditions.
  - [x] kubernetes.ts: waitDeleted keeps 404 invariant for live pods, reports k8s_wait_deleted_timeout on terminal/deleting pods past the bound.
  - [x] pods.ts + ports.ts: probe pod state (active/absent/terminating/terminal).
  - [x] transitions.ts: skip worker.quiesce when pod gone/terminal/terminating, preserve stateDetail when detail undefined, failed() persists code:reason.
  - [x] controller.ts: reconcile RECOVERING via recover, recover preserves root cause, lease skips teardown-transient phases.
  - [x] Observability: every new LiveError builder_unavailable on the live path gets a reason (npm_relay_status, supervisor_relay_502, k8s_wait_deleted_timeout, forge_status, cache_s3_unavailable).
  - [x] pods.ts ensure: replace a leftover service with a stale selector under its uid precondition instead of stale_fence.
  - [x] cache-storage.ts: name S3 effect failures cache_s3_unavailable, read rethrows builder_unavailable without quarantining.
  - [x] Address Argon B1-B3: bound quiesce with non-fatal failure, skip when podUid null, uid-guarded pod delete; record teardown cause (NB1).
- [x] **Lot 2 — Scoped api unit tests**
  - [x] delete uses Background (deleteOptions unit test).
  - [x] teardown completes on a terminal/terminating pod without worker.quiesce.
  - [x] RECOVERING to DORMANT on tick once the pod is gone.
  - [x] reasons are logged and persisted as code:reason.
  - [x] Update oom and heavy-phases stateDetail expectations to code:reason (evolution).
  - [x] Update cache-storage privacy-check expectations to code:reason (evolution); add S3 outage naming and service-replace tests.
  - [x] Scoped runs: make test-api SCOPE=tests/unit/artifacts-live/... ENV=test-fix-live-teardown last.
- [ ] **Lot 3 — Gates, PR and CI**
  - [x] make typecheck-api, make lint-api via docker-slot.sh.
  - [x] Scoped make test-api via docker-slot.sh.
  - [ ] Open PR (title/body from BRANCH.md), push, iterate to green CI (no rerun, no skip, no timeout increase).
  - [ ] Do NOT merge.
- [ ] **Lot 4 — Report**
  - [ ] Report in French to .tmp/rv/fix-live-teardown.md: PR number, head sha, CI state, tests, files changed.
