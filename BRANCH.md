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
  - `scripts/ci/publishable-ci-wiring.test.mjs`
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
- [x] Fresh paginated stock read: 2,714.98 GB before this branch ran, versus audit 4,017 GB; no attribution to this change; repository log-retention GET remains 90 days.
- [x] BR841-EX1: owner-requested least-privilege regression coverage in `scripts/ci/publishable-ci-wiring.test.mjs`; impact limited to credential-free fixtures; rollback reverts that test hunk.
- [x] Rebased on origin/main; no package manifests or package sources changed, so the post-rebase package-version gate has no affected package.
- [x] Restore read-only workflow and ci-gate permissions; isolate Actions write in the single-step deletion job, with a negative mutation for every other job.
- [x] Full manifest suite passes (220 tests), expected-results fixtures (25), DAG fixtures (8), capacity-policy shape and mechanical scope check pass on the rebased branch.
