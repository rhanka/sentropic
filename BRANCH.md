# Feature: Decouple image publish from OpenAI-billing CI gates

## Objective
- [x] Allow main image publication and preprod deployment when only OpenAI-billing-dependent AI or E2E tests fail.
- [x] Retain blocking gates for non-AI API tests, non-billing E2E groups, typechecks, builds, security, IdP smoke, and restore smoke.

## Scope / Guardrails
- [x] Scope is limited to `.github/workflows/ci.yml` and `BRANCH.md`.
- [x] No test, application, package, deployment, Makefile, or Compose file changes are permitted.
- [x] The existing AI and E2E jobs remain present and execute in CI.
- [x] All new text is English.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `.github/workflows/ci.yml`
  - [x] `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `api/**`
  - [x] `ui/**`
  - [x] `packages/**`
  - [x] `deploy/**`
  - [x] `.github/workflows/**`
  - [x] `e2e/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] No conditional paths.

## Feedback Loop
- [x] `BR-CI-BILLING-DECISION1` — `test-api-unit-integration` uses job-level `continue-on-error: ${{ matrix.suite == 'ai' }}`. GitHub Actions evaluates matrix context for a matrix job at job level, so only the three `ai` legs are allowed to fail; every real suite remains blocking.
- [x] `BR-CI-BILLING-DECISION2` — Keep `test-e2e` and `e2e-vscode` in both publish jobs’ `needs` rather than remove the dependencies. Matrix groups b/c/d are marked `billing_dependent: true`; only their `make test-e2e` steps are allowed to fail. Groups a/e, and setup, typecheck, build, and security prerequisites, remain blocking. The standalone VSCode chat-streaming command is billing-dependent, so only its test step is allowed to fail; its setup still blocks.
- [x] `BR-CI-BILLING-DECISION3` — `deploy-preprod` remains unchanged. Once publish jobs are no longer skipped for allowed billing failures, its existing `always()` condition proceeds; a real publish failure still blocks it.
- [x] `BR-CI-BILLING-BLOCK1` — RESOLVED. Codex authored the diff but its sandbox had a read-only `.git` (could not create `index.lock`), so it could not commit/push/open the PR. The infra lane integrated the authored change unchanged in design from an environment with a writable `.git`: committed, pushed, and opened the draft PR. Design review (Opus x2) done; the conductor CI gate is pending.
- [ ] `BR-CI-BILLING-FOLLOWUP1` — Adversarial review CONFIRMED the fix but flagged that `e2e-vscode`'s `continue-on-error: true` is UNCONDITIONAL (not a matrix, so it cannot be scoped per billing group here). It is a TEMPORARY outage mitigation: it also swallows real VSCode regressions (activation, command registration, streaming). Re-gate once OpenAI credits are restored by splitting `tests/vscode/01-vscode-chat-streaming.spec.ts` into a blocking part (activation + command registered + request dispatched) and a non-blocking streamed-token assertion. That is a TEST edit, out of this branch's ci.yml+BRANCH.md scope — a dedicated follow-up branch.

## AI Flaky tests
- [x] The documented failure signature is OpenAI billing exhaustion: `APIError: You have no credits remaining`.
- [x] AI and billing-dependent E2E failures remain visible in CI and are non-blocking only at the specified scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick.
- [ ] Multi-branch.
- [x] Rationale: one workflow dependency correction is the sole logical change.

## Plan / Todo (lot-based)
- [x] Lot 0 — Confirm the assigned branch, required rules, clean worktree, CI job graph, and scope boundaries.
- [x] Lot 1 — Add scoped non-blocking handling for API AI matrix legs and billing-dependent E2E executions while retaining publish dependencies.
- [x] Lot 2 — Inspect the focused workflow diff and run available YAML workflow validation; `actionlint` is unavailable locally.
- [x] Lot 3 — Run `make scope-check`; it passed C2 for the two allowed paths.
- [ ] Lot 4 — Commit, push, and create the requested draft PR.
