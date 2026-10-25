# Feature: #861 L4 publication preparation fixes

## Objective
- [x] Correlate publication preparations and expose all three S3 barriers through the frozen L3 observer.

## Scope / Guardrails
- [x] Branch: fix/artifacts-861-L4-l8a-defects; worktree: tmp/worktrees/861-L4-l8fix.
- [x] Base: origin/feat/immo-861-integration; merge origin/feat/artifacts-861-L8a at 44fc537b9 without rebase.
- [x] Spec: .tmp/immo-861-artifacts/spec-plan.md r2, L4 and L8a rows.
- [x] Make-only; ENV=test-861-l4fix last; shared Docker flock; make down after each Docker step.
- [x] Preserve L3 port signatures and all L0 freeze files; no Python or attribution trailers.
- [x] Compose qualification services publish no host ports; reserved API_PORT=13309, UI_PORT=9509, MAILDEV_UI_PORT=5409.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/tests/commit-publication-boundary.integration.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/src/server/commit/**`
  - `packages/artifacts/src/server/commit-contract.ts`
  - `packages/artifacts/src/server/outcome-contract.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/artifacts/package.json`
- **Exception process**:
  - [x] Declare a bounded BR861-L4FIX-EXn before changing a conditional path.

## Feedback Loop
- [x] Merge conflict: replace integration/L8a topic plans with this bounded fix plan; preserve L8a test bytes.
- [x] Versions remain integration-owner controlled under spec r2 section 6.1; no parallel manifest or lock edits.
- [x] Local Makefile snapshot extends existing test-861-int qualification ENV conditions to test-861-l4fix; tracked Makefile unchanged.

## AI Flaky tests
- [x] No flaky acceptance or timeout increase.

## Orchestration Mode (AI-selected)
- [x] Single author; preserve the requested merge history.

## UAT Management (in orchestration context)
- [x] Server-only change; validate with real PostgreSQL/MinIO and publication regression tests.

## Plan / Todo (lot-based)
- [x] Lot 0: merge L8a qualification tests and verify branch/scope mechanically.
- [x] Lot 1: reproduced exactly two failures (missing invocationId and all S3 points absent), with 24 other tests passing; persist one invocation ID and invoke S3 observer barriers.
- [x] Lot 1: promote both known-failure tests; remove the test-only S3 barrier wrapper so expiry tests exercise product hooks.
- [x] Boundary gate: build-artifacts passed; commit-publication-boundary.integration.test.ts passed all 26 tests on real PostgreSQL/MinIO.
- [x] Authorization gate: publication-authorization.integration.test.ts passed all 7 tests; unit gate: test-artifacts passed 431 tests across 33 files, including publication, crash recovery and GC races.
- [x] Lot 2: boundary 26/26, authorization 7/7, unit 431/431; lint-artifacts passed without errors or warnings; freeze-types and production build passed.
- [x] Lot 2: L3/L0 files, Makefile, Compose and Track match integration c3b881671; Docker steps cleaned through the isolated make down target.
- [x] Handoff: make commits, branch pushed; draft PR [#744](https://github.com/rhanka/sentropic/pull/744) targets feat/immo-861-integration. Runtime source tested at 33fe6ba75; subsequent changes only record results in BRANCH.md.
