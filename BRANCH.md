# Feature: Train 2026-11-07 (hono GHSA fixes + SCA CI gate + CI10 speedups)

## Objective
- [ ] One train, one PR, one CI: carry the GHSA-jpvv hono fixes (#938), the SCA CI gate (#940) and the ten-minute CI speedups (#939, plus the e2e load wagon) with every gate intact.
- [x] Wagons: fix/hono-node-server-ghsa-jpvv, feat/ci-sca-gate, train/2026-11-07-ci10, perf/ci10-e2e-load (merge commits, no rebase of published trains).

## Scope / Guardrails
- [x] Branch feat/ci-sca-gate; worktree tmp/worktrees/ci-sca-gate; ENV=test-sec-train.
- [x] Make only; Docker via docker-slot.sh; no Python, attribution trailers, CI skips, reruns or CI polling.
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/package-lock.json`
  - `apps/llm-gateway/package.json`
  - `packages/auth-hono/package.json`
  - `packages/chat-server/package.json`
  - `packages/cluster-mesh/package.json`
  - `packages/comments/package.json`
  - `packages/connector-host/package.json`
  - `packages/flow/package.json`
  - `packages/llm-gateway/package.json`
  - `packages/mcp-platform/package.json`
  - `packages/cluster-mesh/tests/**/package-lock.json`
  - `packages/cluster-mesh/tests/**/package.json`
  - `packages/cluster-mesh/tests/engram-memory/installed-consumer-package-lock.json`
  - `packages/cluster-mesh/tests/storage/comments-deps.package-lock.json`
  - `scripts/ci/**`
  - `scripts/security/hono-node-server*`
  - `scripts/security/sca-gate*.mjs`
  - `.github/workflows/ci.yml`
  - `.github/workflows/security-sca-daily.yml`
  - `.security/vulnerability-register.yaml`
  - `tools/memory-mcp-l5/artifacts/**`
  - `api/vitest.config.ts`
  - `api/ci/unit-shards*`
  - `spec/ci-cd-ten-minutes/**`
  - `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`
  - `plan/70-BRANCH_test-ci-ten-minute-proof.md`
  - `docs/ci/registry-egress.md`
  - `Makefile` (BRHONO-EX1, BRHONO-EX2, BRSCA-EX1, BR84-EX2)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/*/src/**`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed with declared exception)**:
  - `.github/workflows/ci.yml` under BR84-EX1, BR84b-EX1 and BRSCA-EX1.

## Feedback Loop
- [x] BRHONO-EX1: add only Docker regression/dependency verification targets to Makefile. Rollback reverts those targets.
- [x] BRHONO-EX2: raise hono floors to ^4.13.16 and resolve 4.13.17 in every lock; one `lock-hono-4-13-17` Makefile target applies the pinned bump. `packages/mcp-auth` keeps its ^4.10.7 peer floor. Rollback reverts manifests, locks and target.
- [x] BRSCA-EX1: Makefile test-security-sca-gate targets and ci.yml/daily workflow wiring; owner asked for a real SCA gate in CI (07/11). Rollback reverts targets, job and workflow.
- [x] BR84-EX1: owner-authorized CI workflow changes (toolbox static, parallel qualification, shards); keep every gate. Rollback: revert workflow and Makefile together.
- [x] BR84-EX2: capture, report, dispatch, dossier and toolbox targets in the Makefile. Rollback: restore recipes.
- [x] BR84-EX3: dossier tsconfig, ESLint/Playwright configuration, edge renderer and diagram generator source archive; dossier only.
- [x] BR84b-EX1: CI matrix, needs and exact toolbox cache changes of the unit graph. Rollback: revert workflow changes with wiring tests.
- [x] BR84b-EX2: cache and shard check targets. Rollback: restore Makefile recipes.
- [ ] Conductor Track handoff: import request, deliverables and evidence with the designated writer.
- [ ] Acceptance requires the measured critical path under 600s on the exact head; missing receipts stay to measure.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: security and CI wagons integrated into one dated train with one CI.

## UAT Management (in orchestration context)
- [x] Raw HTTP regression for GHSA-jpvv: vulnerable 1.19.17 fails, fixed 2.1.6 passes.
- [ ] Exact-head pull_request CI timing and SCA gate result retained in .tmp/rv/train-security.md.

## Plan / Todo (lot-based)
- [x] Lot 1: hono fix, SCA gate and CI10 train merged on feat/ci-sca-gate.
- [x] Lot 2: scoped make checks green (inventory 15/15, SCA gate 0 unregistered, hono lock, expected-results 28/28, ci-dag 10/10).
- [ ] Lot 3: push, retitle PR #940, close #938 and #939.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
