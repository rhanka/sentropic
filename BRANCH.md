# Feature: #861 fix L3 coordinator defects found by L8c

## Objective
- [x] Preserve typed retriable failures, classify without error text, and distinguish explicit COMMIT aborts from lost acknowledgements.

## Scope / Guardrails
- [x] Branch fix/artifacts-861-L3-l8c-defects; worktree tmp/worktrees/861-l3-l8cfix.
- [x] Base origin/feat/immo-861-integration 8d268de0d; merge L8c 083b4f2fe without rebase.
- [x] Make only; ENV=test-861-l3-l8cfix last; shared Docker lock and make down after each step.
- [x] Local .tmp/qualification.make substitutes the environment name in existing Compose targets; no committed runner changes or published ports.
- [x] Frozen L0 bytes and L3 port signatures remain unchanged; no publication.
- [x] Retain the integration owner's reserved artifacts 0.2.0 version (registry baseline 0.1.4); spec r2 assigns manifests and locks to the integrator.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/commit/coordinator.ts`
  - `packages/artifacts/tests/commit-failure-parity.integration.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/artifacts/l0-freeze/**`
  - `packages/artifacts/src/server/commit/types.ts`
  - `.track/**`
  - `Makefile`
  - `docker-compose*.yml`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/artifacts/package.json`
- **Exception process**:
  - [x] No exceptions; inherited L8c test content is preserved by a merge commit.

## Feedback Loop
- [x] Reproduced all six expected failures as ordinary tests: 6 failed, 33 passed before the fix.
- [ ] Independent peer review before merge.

## AI Flaky tests
- [x] No flaky acceptance or skipped regression cases.

## Orchestration Mode (AI-selected)
- [x] Single author; inherited L8c qualification merged before the fix.

## UAT Management (in orchestration context)
- [x] Package-only change; HTTP/MCP behavior checked against real PostgreSQL in separate child processes.

## Plan / Todo (lot-based)
- [x] Lot 0: read Docker lock and spec r2; mechanically check branch; merge L8c.
- [x] Lot 1: reuse L2 typed classification, remove message inference, certify explicit SQL aborts after successful settlement.
- [x] Promote all known-failure cases in commit-failure-parity.integration.test.ts; add a typed provider-outage case.
- [x] Full PostgreSQL/MinIO integration campaign: 168 tests passed across 12 files, including L8c 40/40 and coordinator 42/42; build passed and stack removed.
- [x] Lot 2: 431 unit tests across 33 files; 168 integration/E2E tests across 12 files; lint, build, freeze-types and scope checks passed; no skips.
- [x] Frozen bytes verified, branch pushed, draft PR #747 opened against feat/immo-861-integration; peer review remains pending before merge.
