# Feature: Scope AI test shards to AI-relevant path changes in CI

## Objective
Make the `test-api-unit-integration (ai, …)` shards run only when AI-relevant paths change, using the existing `changes` path-filter job in `.github/workflows/ci.yml`, and record the root cause of the recurring AI-shard flakiness (`initiative-generation-async`, `executive-summary-sync`, `chat-tools`/`company-enrichment-sync`) from recent failing job logs, fixing it if it is a test or determinism defect. The ci-gate must still require a green AI shard whenever it runs.

## Scope / Guardrails
- Scope limited to `.github/workflows/ci.yml`, the CI scripts under `scripts/ci/**` that cite this owner request of 2026-11-03, and `BRANCH.md`.
- Owner request of 2026-11-03 (AI-flaky tests may NOT be accepted without passing green at least once; making them non-flaky belongs to CI/CD improvements, e.g. not running AI tests on changes that do not concern them).
- Never increase timeouts to hide a defect; never `[skip ci]`; never `gh run rerun` on a PR CI.
- Make-only workflow; one Docker lock per make command; `ENV=<env>` always last; end test lanes with `make down-volumes ENV=<env>`.
- Branch development happens in worktree `tmp/worktrees/ci-ai-scoped` (branch `chore/ci-ai-tests-scoped` from `origin/main`).
- All new text in English. No `[skip ci]` anywhere.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/ci.yml`
  - `scripts/ci/**` (only where needed to keep the ci-gate/capacity machinery consistent with the workflow change, citing the owner request of 2026-11-03)
  - `BRANCH.md`
  - `api/tests/ai/initiative-generation-async.test.ts` — BR02-EX3 (proven wait/race defect in the test harness, owner request of 2026-11-04; see Feedback Loop)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `e2e/**`, `packages/**` (no product or test code changes unless a proven test/determinism defect requires it; any such change needs a new exception below)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**` — BR02-EX1 (see Feedback Loop)
  - `scripts/ci/**` — BR02-EX2 (see Feedback Loop)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- BR02-EX1 (scope exception, `.github/workflows/**`, owner request of 2026-11-03): the AI shards `test-api-unit-integration (ai, …)` must run only when AI-relevant paths change, using the existing `changes` path-filter job. Edit `.github/workflows/ci.yml` only: add the `ai` path filter, move the three `suite: ai` matrix legs into a dedicated AI job gated on `needs.changes.outputs.ai`, and keep ci-gate requiring a green AI shard whenever it runs. Rollback: revert `ci.yml` to origin/main.
- BR02-EX2 (scope exception, `scripts/ci/**`, owner request of 2026-11-03): only if the ci-gate expected-results/capacity scripts hard-code the current job/matrix shape (e.g. `matrixWidths.api === 15` in `scripts/ci/ci-expected-results.mjs` or fixtures in `scripts/ci/*.test.mjs`); update them to stay consistent with the new AI job while keeping the gate strict (a selected AI shard must be green). Rollback: revert the script changes.
- BR02-EX3 (scope exception, `api/tests/ai/initiative-generation-async.test.ts`, owner request of 2026-11-04): proven wait/race defect in the test harness, not product code. In `waitFor`, each poll iteration awaited `queueManager.processJobsForWorkspace(workspaceId)`, which drains the whole workspace queue inline (live LLM calls, minutes under provider latency) before the condition and the wait's own deadline are checked; the per-wait timeout was therefore never enforced while blocked and the vitest 180s wall clock fired as an opaque `Test timed out in 180000ms` even when the awaited condition was already satisfied (evidence: runs 41742721513 / 41651846843 / 41665890098 / 41726745334 / 41729365882 — no `Timed out waiting for …` message in any log; run 41742721513 shows the `executive_summary` job still `processing` from 00:02:34 until the 00:04:30 kill). Fix: kick the drain fire-and-forget (guarded, errors swallowed) and poll the real condition every 1s so the existing deadline is enforced. No timeout added or increased, no assertion weakened. Rollback: revert the test file to origin/main.
- Root-cause note (from failing job logs, 2026-11-03/04): runs 41651846843 / 41665890098 / 41726745334 / 41729365882 on `feat/share-g1-access-model` and 41742721513 on this branch all failed the shard `(ai, initiative-generation-async,executive-summary-sync)` with `Error: Test timed out in 180000ms` in `tests/ai/initiative-generation-async.test.ts` (test `should accept the org-aware list schema with explicit org_ids` in 3 of 5 runs, `should complete full AI workflow…` in 2 of 5); `tests/ai/executive-summary-sync.test.ts` passed in all 5 runs. No `Timed out waiting for …` from the test's own `waitFor` ever fired: every poll iteration was blocked inside the awaited full-queue drain, so the 180s vitest wall clock was the only effective bound. The `test-cleanup` job failures in the logs are the afterEach `hardResetQueue` cancel, a symptom. One secondary observation (run 41742721513, 00:02:06): `TypeError: Cannot read properties of undefined (reading 'map')` at `validateScores` (score-validation.ts:23) when the LLM omitted `valueScores` — model nondeterminism, self-healed by the queue's existing 1-retry (job re-processed and completed at 00:02:08); not the cause of the shard timeout. No 429/rate-limit errors in any of the 5 logs. Main 836a82f88 and run 41739731875 passed the same shard (full-workflow test 110656ms, org-aware 55406ms — both well inside 180s when the provider is fast). Signature: async race in the test wait harness (deadline starved by a blocked poll iteration), triggered by provider latency on live LLM calls. Fix: BR02-EX3; plus BR02-EX1 scoping so non-AI PRs are not blocked; no timeout increase.

## AI Flaky tests
- Acceptance rule: AI-flaky tests (allowlist in `rules/testing.md`, CI shards `test-api-unit-integration (ai, …)`) may NOT be accepted without passing green at least once (owner rule). This branch does not accept any flaky failure; it removes the noise by scoping. The ci-gate still requires a green AI shard whenever the shard runs.
- Never amend tests with additive timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single final test cycle)
- Rationale: one cohesive CI change in `.github/workflows/ci.yml` (+ possibly `scripts/ci/**`); no parallel sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface change; validation is CI-only (workflow YAML validity + `make test-ci-expected-results` / `ci-capacity-policy` fixtures) plus one PR CI run.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/ci-ai-scoped` on branch `chore/ci-ai-tests-scoped` from `origin/main`.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Validate scope boundaries and declare BR02-EX1 / BR02-EX2.
- [ ] **Lot 1 — Scope AI shards via the `changes` path-filter job**
  - [ ] Add an `ai:` filter (AI-relevant paths) to the `changes` job in `.github/workflows/ci.yml`.
  - [ ] Move the three `suite: ai` matrix legs out of `test-api-unit-integration` into a dedicated AI job gated on `needs.changes.outputs.ai == 'true' || needs.changes.outputs.global == 'true'` (plus the existing api/global condition), keeping `max-parallel: 15` on the base job for the capacity shape check.
  - [ ] Add the new AI job to `ci-gate` `needs` so the gate still requires a green AI shard whenever it runs.
  - [ ] Keep `scripts/ci/**` consistent if the expected-results/capacity fixtures hard-code the old shape (BR02-EX2); run `make test-ci-expected-results ci-capacity-policy test-ci-run-metrics` equivalents on a test ENV.
  - [ ] Lot gate: `make scope-check`; commit with `make commit MSG="..."`; push; open READY PR; one CI run.
- [ ] **Lot 2 — Root cause of AI shard flakiness**
  - [x] Collect failing AI-shard job logs (runs 41651846843, 41665890098, 41726523582, 41726745334, 41729365882, 41742721513) and green shards (836a82f88 check-run 125953857584; run 41739731875 job 126281476055).
  - [x] Record signature: 180s vitest wall-clock timeout while live LLM queue jobs still processing; `test-cleanup` cancel is the afterEach symptom; no `waitFor` deadline ever fired (starved by the awaited drain).
  - [x] Fix the proven wait/race defect under BR02-EX3 (fire-and-forget drain kick in `waitFor`); never increase timeouts.
- [ ] **Lot N — Final validation**
  - [ ] `make scope-check` before every commit.
  - [ ] One CI run on the final head (READY PR); do not merge.
  - [ ] Report to `.tmp/rv/ai-flaky-rootcause.md`.
