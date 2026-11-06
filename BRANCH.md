# Feature: CI10-A — Parallel API static checks and artifact qualification

## Objective
- [ ] Reduce API static and artifact qualification latency while preserving every existing gate and assertion.
- [ ] Record PR CI wall time and run identity against baseline 42300540682 (22.4 minutes).

## Scope / Guardrails
- [x] Owner-prescribed implementation: split compiler/linter jobs, cache incremental state, shard artifact qualification.
- [x] Branch `perf/ci10-typecheck-artifacts`; worktree `tmp/worktrees/ci10-a`; base `origin/main` at `165ce5b93`.
- [x] Slot owner CI10-A: ENV=test-ci10-a; API_PORT=9440 UI_PORT=5640 MAILDEV_UI_PORT=1540; no service stack required for static fixtures.
- [x] Make entry points; ENV last; no Python, image builds, CI reruns, skip markers, removed tests or weakened assertions.
- [x] Wagon: no release/version/lock changes; draft PR authorized only for CI measurement; no merge.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.github/workflows/ci.yml`
  - `scripts/ci/ci-static.mk`
  - `scripts/ci/ci-static.test.mjs`
  - `scripts/ci/ci-expected-results.mjs`
  - `scripts/ci/ci-expected-results.test.mjs`
  - `scripts/ci/ci-performance-report.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**/src/**`
  - `api/src/**`
  - `.track/**`
  - `package-lock.json`
- **Conditional Paths (allowed with declared exception)**:
  - `Makefile` under BR85a-EX1.

## Feedback Loop
- [x] BR85a-EX1 — Owner authorized CI caching/sharding requires Make entry points. Impact: additive CI recipes and host scope-check on constrained disk; rollback: revert added include/recipes together with workflow.
- [ ] Conductor imports this mergeable plan and delivery evidence into Track as designated single writer.
- [x] Rebased onto `origin/test/ci-ten-minute-proof` at `791150e53`; retained captures, campaign checks and all existing qualifications; no package source/version/lock changes, so post-rebase package publication gate is not triggered.

## AI Flaky tests
- [x] No exception, increased timeout or retry authorized.

## Orchestration Mode (AI-selected)
- [x] Multi-branch wagon; train integration owns consolidated independent review and versioning.

## UAT Management (in orchestration context)
- [ ] CI measurement only; draft PR remains draft; no product UI change.

## Plan / Todo (lot-based)
- [x] Lot 0: read common/master/workflow/testing/template and harness rules; mechanical harness branch check passed.
- [x] Lot 1: add exact-toolbox compiler/linter Make recipes with mounted incremental caches; split API/IdP/web checks and retain static release join.
- [x] Lot 1 gate: `scripts/ci/ci-static.test.mjs`, `scripts/ci/ci-dag.test.mjs`, `scripts/ci/ci-expected-results.test.mjs` pass; incremental cache mounts remain separate from toolbox sources and verdicts.
- [x] Lot 2: shard budget, static/package/consumer, unit, integration and activation qualifications without altering suite membership; require all shards in artifact join and final gate.
- [x] Lot 2 gate: fixture failures, missing/skipped/cancelled shards block promotion; all prior qualifications retained; `test-ci-performance-report` passes after rebasing BR-84.
- [ ] Lot 3: scope check per atomic make commit; push branch; obtain fresh PR CI timing run; inspect logs and fix regressions.
- [ ] Lot 3 gate: record run ID, SHA, attempt, wall time, per-job durations, cache results and remaining bottlenecks in `.tmp/rv/ci10-a.md`.
- [ ] Cleanup: `make down-volumes ENV=test-ci10-a`; disk-hygiene if available; no root-owned file removal.
