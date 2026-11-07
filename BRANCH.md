# Feature: Ten-minute CI train 2026-11-07

## Objective
- [ ] Bring the pull_request CI critical path under 10 minutes (baseline 22.4 min, run 42300540682) with every gate intact: no test removed, no assertion weakened, no hidden skip.
- [x] Train content: perf/ci10-typecheck-artifacts (a39f722f7), perf/ci10-unit-graph (b5acdd6f0) and the proof/dossier tooling of test/ci-ten-minute-proof after 791150e53 (1823a3177), all rebased onto origin/main 98bddc06d.
- [x] Superseded wagon branches stay untouched; the sub-conductor closes them after the train is green.

## Scope / Guardrails
- [x] Branch train/2026-11-07-ci10; worktree tmp/worktrees/train-ci10; multi-branch train, one PR, one CI.
- [x] Make entry points, ENV last, never ENV=dev; no Python, CI skip, rerun, local image build, attribution trailer or package version change.
- [x] Scoped local checks only for scripts/ci/*.test.mjs; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/vitest.config.ts`
  - `api/ci/unit-shards*`
  - `scripts/ci/**`
  - `spec/ci-cd-ten-minutes/**`
  - `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`
  - `plan/70-BRANCH_test-ci-ten-minute-proof.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/*/src/**`
  - `package-lock.json`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed with declared exception)**:
  - `.github/workflows/ci.yml` under BR84-EX1 and BR84b-EX1.
  - `Makefile` under BR84-EX2 and BR84b-EX2.

## Feedback Loop
- [x] BR84-EX1: owner-authorized CI workflow changes (toolbox static, parallel qualification, shards); keep every qualification, publication and final-verdict gate. Rollback: revert workflow and Makefile together.
- [x] BR84-EX2: capture, report, dispatch, dossier and toolbox targets in the Makefile. Rollback: restore recipes.
- [x] BR84-EX3: dossier tsconfig, ESLint/Playwright configuration, edge renderer and diagram generator source archive; dossier only. Rollback: remove the supporting files.
- [x] BR84b-EX1: CI matrix, needs and exact toolbox cache changes of the unit graph. Rollback: revert workflow changes with wiring tests.
- [x] BR84b-EX2: cache and shard check targets. Rollback: revert Makefile recipes.
- [x] Conflict union 1: Makefile ci-static-api removed by the unit graph is not restored; ci-performance-receipt and the dossier targets are kept.
- [x] Conflict union 2: ci.yml capacity step keeps test-ci-static and adds the dossier qualification and volume cleanup steps.
- [x] Conflict union 3: ci-performance-report.test.mjs asserts the consumer VERIFY_BASE and four unit shards.
- [x] Conflict union 4: app cluster-mesh sharding keeps the APP_CLUSTER_MESH_ARGS form of the unit graph (same two shards, same file selection).
- [ ] Conductor Track handoff: import request, deliverables and evidence with the designated writer; no Track append here.
- [ ] Acceptance requires the measured critical path under 600s on the exact head; missing receipts stay to measure.

## AI Flaky tests
- [x] No flaky acceptance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: three stacked wagons integrated into one dated train with one CI.

## UAT Management (in orchestration context)
- [ ] Exact-head pull_request CI timing retained in .tmp/rv/train-ci10.md; no root-dev automated testing.

## Plan / Todo (lot-based)
- [x] Lot 0: common rules, master and workflow rules read; wagons fetched; worktree created from origin/main.
- [x] Lot 1: wagons cherry-picked in order (typecheck-artifacts, unit-graph, proof tooling); conflicts resolved by union.
- [ ] Lot 2: Post-Rebase Gate (no packages/*/src change, so no package.json bump) and scoped scripts/ci node tests through make.
- [ ] Lot 3: push, one draft PR, ready once scoped tests pass, then the PR CI measures the critical path.
- [ ] Lot N: Final validation: exact-head CI green and under 10 minutes; remove BRANCH.md at merge.
