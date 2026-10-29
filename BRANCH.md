# Feature: Cut CI transport artifact retention

## Objective
- [ ] Retain five transport artifacts for one day, delete after all consumers, deliver draft PR with successful exact-head CI.

## Scope / Guardrails
- [x] `fix/ci-artifact-retention` from `origin/main` 2ea238790 in `tmp/ci-artifact-retention`; Make only, shared Docker flock, commits ≤150 lines.
- [x] `ENV=test-ci-artifact-retention` last; ports 9490/5690/1590 if services needed; root dev reserved; no log setting or historical deletion changes.
- [x] Keep every gate and PR #829 package-candidate wiring; author codex / gpt-6.1-sol / high.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.github/workflows/ci.yml`
  - `scripts/ci/ci-expected-results.test.mjs`
  - `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] Other workflow/script paths require a bounded exception with rationale, impact and rollback.

## Plan / Todo (lot-based)
- [x] **Lot 0** — Read rules/project/plans/study/audit; isolated worktree and mechanical branch check; inspect consumers and #829.
- [x] **Lot 1** — Five retention values; final-gate publication/deploy join; current-run allowlist cleanup with job-only write permission; retain cancellation/fork fallback.
- [x] **Lot 2** — Extended `scripts/ci/ci-expected-results.test.mjs`; `make ci-capacity-policy test-ci-expected-results test-ci-dag ENV=test-ci-artifact-retention` passes (25 + 8 tests); recorded storage/consumer evidence in CI study.
- [ ] **Lot 3** — Scope check before each commit, review, draft PR and execution-plan comment, completed successful exact-head CI, owned `make down` and `make ps`.

## AI Flaky tests
- [x] No timeout inflation or accepted flaky failures.
## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author.
## UAT Management (in orchestration context)
- [x] No web, Chrome or VSCode behavior change; workflow qualification supplies acceptance.
## Feedback Loop
- [x] No scope exception; historical stock purge and registry transport redesign remain outside scope.
