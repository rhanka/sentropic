# Feature: CI ten-minute unit and dependency graph wagon

## Objective
- [ ] Shorten the API unit path with measured balanced shards and a verified toolbox cache; start independent consumer checks after change selection.
- [x] Retain BR-84 from origin/test/ci-ten-minute-proof (791150e53); no package version or lock changes in this wagon.

## Scope / Guardrails
- [x] Branch perf/ci10-unit-graph; worktree tmp/worktrees/ci10-b; multi-branch wagon.
- [x] ENV=test-ci10-b; API_PORT=9496 UI_PORT=5696 MAILDEV_UI_PORT=1596; check ports before services.
- [x] Make entry points, ENV last; no Python, local image build, CI skip/rerun, attribution trailer, removed test or weakened assertion.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/vitest.config.ts`
  - `scripts/ci/api-unit-shards*`
  - `scripts/ci/ci-unit-graph.test.mjs`
  - `scripts/ci/consumer-contracts.mjs`
  - `scripts/ci/consumer-contracts.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/*/src/**`
  - `package-lock.json`
- **Conditional Paths (allowed with declared exception)**:
  - `.github/workflows/ci.yml` under CI10B-EX1.
  - `Makefile` under CI10B-EX2.

## Feedback Loop
- [x] CI10B-EX1: owner-authorized CI matrix, needs and exact toolbox cache changes; keep every qualification, publication and final-verdict gate. Rollback: revert lane workflow changes with wiring tests.
- [x] CI10B-EX2: named cache/shard check targets and host scope checking for this disk-constrained environment. Rollback: revert lane Makefile recipes.
- [x] Baseline 42300540682/1, job 128179794335: unit job 567s, app qualification 254s, unit tests 205s; BR-84 already split app qualification.
- [x] Cluster-mesh consumes verified candidate closure and prepared archives; retain that edge. Consumer verifier does not consume candidates.
- [ ] Conductor Track handoff: import request, deliverables and evidence with designated writer; no concurrent Track append here.

## AI Flaky tests
- [x] No flaky acceptance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [x] Multi-branch wagon; preserve BR-84 history through rebase; consolidated review at train integration.

## UAT Management (in orchestration context)
- [ ] Draft PR only for exact-head CI timing; retain run id, attempt, wall time and conclusion in .tmp/rv/ci10-b.md.

## Plan / Todo (lot-based)
- [x] Lot 0: common/master/workflow/testing, baseline steps and unit durations read; harness branch check passed.
- [ ] Lot 1: partition discovered unit files exactly once by measured duration; automatically include unmeasured additions; retain complete verdict.
- [ ] Lot 2: detach units from production image; cache verified toolbox by lock and complete source identity; remove unused consumer candidate dependency.
- [ ] Lot 3: scoped Make sharding, graph, consumer, expected-results and wiring checks on existing Node container; full suites in PR CI.
- [ ] Lot 4: scope-check before atomic make commits; push wagon; capture draft timing run; report and test-volume cleanup.
