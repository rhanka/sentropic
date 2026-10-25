# Feature: Publication adversarial qualification (#861 L8a)

## Objective
- [ ] Qualify the r2 publication boundary on real PostgreSQL and S3-compatible storage.

## Scope / Guardrails
- [x] Spec r2 S4/L8a, sections 3.2 and 6.3; Q1/Q2/Q3/Q4 read.
- [x] Worktree `tmp/worktrees/861-L8a`; branch `feat/artifacts-861-L8a`.
- [x] Base integration `34d467972`; merged L6 `e67a978f9` without rebase.
- [x] ENV `test-861-l8a`; API_PORT=13338, UI_PORT=9538, MAILDEV_UI_PORT=5438.
- [x] Shared Docker flock; Compose-only existing targets; teardown after every step; no Python.
- [x] Specific-file staging; make commit; fewer than 150 authored lines per commit.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/tests/commit-publication-boundary.integration.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/artifacts/src/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] L6 changes are inherited merge ancestry; no authored product changes.

## Feedback Loop
- [x] D1, owner L4: `packages/artifacts/src/server/publication.ts:463` records attempts without invocationId. Ordinary test failed on the missing durable field; retained as `[known failure D1]` with `it.fails`.
- [x] D2, owner L4: `packages/artifacts/src/server/publication.ts:481` does not invoke coordinator preparationTestHooks around S3. Ordinary test observed only five coordinator points and none of the three S3 points; retained as `[known failure D2]` with `it.fails`.
- [x] Full ordinary run: 24 passed / 2 failed / 0 skipped on real PG/MinIO; failures are D1/D2, with JSON receipt `tmp/l8a-results.json`.
- [x] Final runtime run: 24 passed / 2 expected fail / 0 skipped; test source SHA-256 `fe5fed84e2f511b68ec50fec349a676208480ec341247703ac854a064a0fdd42`; JSON SHA-256 `a8e3f2bd810c0a7bc399ccaa8279e5ff6619b05ac85354d67de7a5538f90ede1` at `tmp/l8a-final-results.json`.
- [x] Dedicated strict test compilation identified three untyped query results; corrected only their TypeScript row annotations.
- [x] Radar read-only pins: A1 `f2b6c25cc9458ec285d6d4f620a55dad8c30f909`, A2 `b104ae90a28a5581e8eabd15f12acb58558d3396`, PR908 `e2e9515ea41baebf5539743f0cfa0dea750d072c`, main `2dbde92e9a6c532abe4f9e7bed8ed9a9b381d530`.
- [x] BASE #910 `ccb91aea` retired the route still called by Radar `packages/immo-mcp/src/data-source.ts:316`; current-main runs must account for CT-3/CT-9.
- [x] Missing Radar H3 quota/admission integration remains explicitly not covered; generic provider tests cannot qualify Q4 activation.
- [x] Temporary Make overlay selects the existing isolated Compose runner for this lane and host harness for scope checks.
- [x] First run: all eight expiry denials and eight real-lock cases reached their invariants; corrected replay comparisons to the public receipt, excluding internal transaction timestamps.

## AI Flaky tests
- [x] No AI-dependent cases or timeout increases.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: independent L8a qualification; integration owns product corrections and tuple changes.

## UAT Management (in orchestration context)
- [x] Package qualification only; consumer UAT belongs to the integrated tuple.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read lock, rules, template, specification and Radar pins; mechanical branch check passed.
  - [x] Create worktree from integration and merge L6.
- [ ] **Lot 1 — Publication boundary matrix**
  - [x] Add `packages/artifacts/tests/commit-publication-boundary.integration.test.ts` with real PG/S3 fixture.
  - [x] Add expiry denial/retry/replay matrix at eight publication waits with independent DB/S3 reads.
  - [x] Add same-key two-process S3 races for identical and changed commands; one receipt and quota charge.
  - [ ] Exercise policy/lifecycle serialization, purge claims and bounded shared-blob cleanup.
  - [x] Add real S3 shared/exclusive cleanup, durable purge claims and preparation invocation attribution assertion.
  - [x] Add real PG key/quota/policy/ACL/lifecycle lock waits and both writer orders.
  - [x] Keep demonstrated product defects D1/D2 as known-failure tests with file:line evidence; no product edits.
- [ ] **Lot 2 — Qualification and handoff**
  - [ ] Run scoped integration tests, typecheck and lint under the shared lock.
  - [ ] Pin hashes and run Radar commit-probe/finalization suites read-only; record missing prerequisites.
  - [x] Merge integration `be22b0563` after its L6 merge lands; no rebase.
  - [ ] Scope-check each commit, push, open draft PR targeting `feat/immo-861-integration`.
