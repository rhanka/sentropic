# Feature: BR-84 — Measure and prove ten-minute CI/CD

## Objective
- [ ] Execute binding `plan/70-BRANCH_test-ci-ten-minute-proof.md`; report real endpoints and every breach without claiming an unmet budget.
- [x] Owner 2026-11-06: CI/CD speed first; wagon only, no PR. Conductor owns Track import, train review, versions and locks.

## Scope / Guardrails
- [x] Branch `test/ci-ten-minute-proof`, worktree `tmp/worktrees/ci-ten-minute-proof`, based on train `01429a910`, rebased onto main `165ce5b93` after #930 merged.
- [x] Slot 0 owner BR-84: ENV=test-ci-ten-minute-proof; API_PORT=9420 UI_PORT=5620 MAILDEV_UI_PORT=1520. Check ports before starting services.
- [x] Make entry points; ENV last; no Python, skipped CI, reruns, local image builds, attribution trailers, removed assertions or package source changes.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/ci-run-metrics.mjs`
  - `scripts/ci/ci-run-metrics.test.mjs`
  - `scripts/ci/ci-performance-report.mjs`
  - `scripts/ci/ci-performance-report.test.mjs`
  - `spec/ci-cd-ten-minutes/runs.json`
  - `spec/ci-cd-ten-minutes/acceptance.md`
  - `spec/ci-cd-ten-minutes/dossier/**`
  - `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`
  - `plan/70-BRANCH_test-ci-ten-minute-proof.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`; `.track/**`; `PLAN.md`; production deployment configuration.
- **Conditional Paths (allowed with declared exception)**:
  - `.github/workflows/ci.yml` under BR84-EX1.
  - `Makefile` under BR84-EX2.

## Feedback Loop
- [x] BR84-EX1 — Run 42300540682: API static 682s, unit 567s, artifacts 554s. Reuse qualified toolbox for full static programs; parallelize retained qualifications; publish evidence. Impact: dependencies/matrix/receipts; rollback: revert workflow and Makefile together.
- [x] BR84-EX2 — Add capture/report/dispatch and toolbox static targets; use installed host harness for this disk-constrained environment. Impact: named Make entry points; rollback: restore recipes.
- [x] BR84-EX3 — Include dossier tsconfig, ESLint/Playwright configuration, edge renderer and a source archive of the retained private diagram generator. Reason: portable pinned build inputs and complete static/browser gates; impact: dossier only; rollback: remove these supporting files with the dossier.
- [ ] Track handoff: designated conductor imports this owner request, plan and acceptance; this concurrent lane never appends `.track/events.jsonl`.
- [ ] Acceptance requires successful complete endpoints, ≥30 full-product runs and cache/traffic profiles. Missing receipts stay to measure; projections never count as runs.

## AI Flaky tests
- [x] Deterministic checks block; no timeout/retry increase or provider exception accepted.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: one wagon, next dated train, consolidated review at integration.

## UAT Management (in orchestration context)
- [ ] Exact-head CI and dossier qualification with source/workflow SHAs and run/attempt/job IDs; no root-dev automated testing.

## Plan / Todo (lot-based)
- [x] Lot 0: read common/master/workflow/testing/subagents, README/TODO/PLAN, study, binding plan/template; harness branch passed; measure #930 and recent PR/main runs through gh API.
- [x] Lot 1 tooling: sanitized jobs/steps, dependency graphs and four endpoints in runs.json; ci-performance-report.mjs/tests and extended metrics tests reject missing/rerun/capacity/mixed-path claims; 33 attempts retained, campaign acceptance remains open.
- [ ] Lot 1 gate: make test-ci-run-metrics test-ci-performance-report ci-performance-report ENV=test-ci-ten-minute-proof; retain n/median/p90/p95/max, costs, failures, cancellations and missing profiles.
- [ ] Speed gate: exact toolbox for complete API/IdP compiler and API linter programs; parallel app/unit and artifact/dossier qualification; preserve matrix membership and complete verdict.
- [x] Measured app host qualification was 233.53s for 30 files (run 42300540682, unit job); split its unchanged file selection across two isolated shards and retain content static/process checks in both.
- [x] Lot 2: versioned portable Svelte dossier from retained generator/theme, one dependency model, graph controls, links, expanded jobs/steps and budget-to-measure labels; test path calculation and controls.
- [ ] Lot 2 gate: make build-ci-dossier test-ci-dossier ENV=test-ci-ten-minute-proof; TypeScript/Svelte/lint/build, keyboard/viewport, all cases/events/steps, wide/narrow exported artifact UAT.
- [x] Dossier gate receipts: zero TypeScript/Svelte warnings, ESLint/build pass; 2 path tests and 23 Chromium controls pass; inspect wide/narrow captures and keep the toolbar above the graph inside the canvas.
- [ ] Lot 3: ≥30 full-product runs across warm/source-miss/lock-miss/full-cold/concurrent profiles and API/UI/mixed/shared/tooling/fresh-release cases; endpoints ≤600s; retain all breaches and separate daily providers.
- [ ] Lot 3 rollback: withdraw unsupported claims, preserve evidence, route regressions to owning branch.
- [ ] Lot 4: consolidate acceptance.md, study and binding plan; `.tmp/rv/br84.md` includes before/after IDs and gap.
- [x] Consolidated versioned acceptance/study/plan; API static observed 682s →138s on first after dispatch, whole-workflow target still breached by runner waits. Manual dispatch base fix passes the real consumer verifier locally.
- [ ] Lot 5: changed-file gates, harness branch and make scope-check before each ≤150-line make commit; push wagon without PR; full product suites in CI, no image build at 95% disk.
- [ ] Cleanup: make down-volumes for lane test/e2e environments; disk-hygiene if available; no root-owned file deletion.
