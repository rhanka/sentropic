# Feature: Artifacts transport wiring and migration (#861 L6)

## Objective
- [x] Bind HTTP and MCP to the selected immutable profile and authorized atomic finalizers.

## Scope / Guardrails
- [x] Spec r2: `.tmp/immo-861-artifacts/spec-plan.md`, S3/L6, C1–C7, A1–A8 and E1–E3.
- [x] Worktree: `tmp/worktrees/861-L6`; branch: `feat/artifacts-861-L6`.
- [x] L3 157f231d5, L4 a8df25634 and L5 c703afc68 contained; integration c5b671b35 merged without rebasing.
- [x] ENV: `test-861-l6`; API_PORT=13336, UI_PORT=9536, MAILDEV_UI_PORT=5436.
- [x] Shared Docker flock; existing Make targets only; tear down after each step; no Python.
- [x] Specific-file staging; `make commit`; fewer than 150 authored changed lines per commit.
- [x] Public host subpaths and 0.2.0 manifest are included in L6; final tuple locks/publication stay with integration.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/http.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/src/mcp.ts`
  - `packages/artifacts/src/adapters/s3.ts`
  - `packages/artifacts/src/adapters/postgres.ts`
  - `packages/artifacts/src/server/idempotency.ts`
  - `packages/artifacts/src/index.ts`
  - `packages/artifacts/src/server/commit-contract.ts`
  - `packages/artifacts/src/server/outcome-contract.ts`
  - `packages/artifacts/src/server/commit/types.ts`
  - `packages/artifacts/src/server/commit/coordinator.ts`
  - `packages/artifacts/src/server/commit/brands.ts`
  - `packages/artifacts/l0-freeze/commit-contract.ts`
  - `packages/artifacts/tests/testing.test.ts`
  - `packages/artifacts/src/server/authorized-replay.ts`
  - `packages/artifacts/src/server/service.ts`
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/server/gc.ts`
  - `packages/artifacts/src/testing.ts`
  - `packages/artifacts/tests/fixtures/commit-contract-compatibility.ts`
  - `packages/artifacts/tests/commit-coordinator.integration.test.ts`
  - `packages/artifacts/tests/ensure-authorization.integration.test.ts`
  - `packages/artifacts/tests/publication-authorization.integration.test.ts`
  - `packages/artifacts/tests/service.test.ts`
  - `packages/artifacts/tests/publication.test.ts`
  - `packages/artifacts/tests/idempotency.test.ts`
  - `packages/artifacts/tests/commit-contract-compatibility.test.ts`
  - `packages/artifacts/tests/postgres.integration.test.ts`
  - `packages/artifacts/tests/radar-commit-setup.integration.test.ts`
  - `packages/artifacts/tests/gc-races.test.ts`
  - `packages/artifacts/tests/http-uploads-templates.test.ts`
  - `packages/artifacts/docs/migration-l6.md`
  - `packages/artifacts/examples/radar-commit-setup.ts`
  - `packages/artifacts/tests/transport-exports.test.ts`
  - `packages/artifacts/tests/fixtures/transport-world.ts`
  - `packages/artifacts/tests/content.e2e.test.ts`
  - `packages/artifacts/tests/pilot-contract.e2e.test.ts`
  - `packages/artifacts/package.json`
  - `packages/artifacts/tests/http-mcp-service-parity.test.ts`
  - `packages/artifacts/tests/http-security.test.ts`
  - `packages/artifacts/tests/http-routes.test.ts`
  - `packages/artifacts/tests/mcp.test.ts`
  - `packages/artifacts/tests/publication-security.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/artifacts/package.json`
- [x] Inherited L5 changes are merge ancestry; authored edits stay within L6 scope.

## Feedback Loop
- [x] PR738 P1: real 0.1.2 raw and 0.1.4 three-element ensure/publish keys reproduce 201 instead of 503; quarantine regressions pass after correcting the probes, without new receipts, releases, blobs or guard calls.
- [x] Integration runner consumed via Make variable overrides for ENV=test-861-l6; no infrastructure edits.
- [x] Build and TypeScript passed through `sh-api`; `lint-artifacts` passed through the Compose runner, all under the shared flock.
- [x] Unit campaign: 428 passed across 33 files, zero failures or skips; extended frozen compilation fixture included.
- [x] PostgreSQL/S3 integration: 86 passed across 7 suites, including L3/L4/L5, GC exclusion and independent HTTP/MCP instances.
- [x] Publication E2E: 2 passed on PostgreSQL/S3; migrated content and pilot E2E: 14 passed; shared parity fixture: 9 passed.
- [x] Commands: `make sh-api COMPOSE_RUN_API='docker compose -f docker-compose.immo-861.yml run --rm --no-deps -T qualification' API_PORT=13336 UI_PORT=9536 MAILDEV_UI_PORT=5436 ENV=test-861-l6`, stdin runs `sh /workspace/tmp/861-l6-run.sh unit tests --exclude '**/*.integration.test.ts' --exclude '**/*.e2e.test.ts'`.
- [x] Integration command: `make -f Makefile -f /tmp/861-l6-ops.mk -o build-artifacts test-artifacts-integration SCOPE='tests/commit-coordinator.integration.test.ts tests/publication-authorization.integration.test.ts tests/ensure-authorization.integration.test.ts tests/postgres.integration.test.ts tests/migration.integration.test.ts tests/s3.integration.test.ts tests/radar-commit-setup.integration.test.ts tests/content.e2e.test.ts tests/pilot-contract.e2e.test.ts tests/publication.e2e.test.ts --maxWorkers=1 --no-file-parallelism' API_PORT=13336 UI_PORT=9536 MAILDEV_UI_PORT=5436 ENV=test-861-l6`; 88 passed before the two E2E fixture migrations, whose 14 cases then passed in the focused run.
- [x] Final focused command uses the same `sh-api` runner with stdin `sh /workspace/tmp/861-l6-run.sh unit tests/content.e2e.test.ts tests/pilot-contract.e2e.test.ts tests/http-mcp-service-parity.test.ts`: 23 passed.
- [x] Host `harness check scope` on the exact authored path set returned `PASS C2 (sentropic)`.
- [x] Make scope-check uses the installed host harness through a temporary overlay, excluding inherited merge changes only during merges.
- [x] Carry-over: converge operational coordinator/participant onto frozen L0 shapes and compile the maintained fixture.
- [x] Canonical coordinator operation methods and transaction-bound admission participant implemented against the extended fixture.
- [x] Carry-over: receipt identity, missing binding, replay authority, late barrier and transaction-held GC exclusion.
- [x] Replay validates receipt identity under the binding lock; missing target denies before the host guard.
- [x] Explicitly armed barrier points hold late waiters; PostgreSQL GC retains one transaction through deletion.
- [x] L3 integration regressions now call the canonical coordinator's prepared-unit methods.
- [x] Added independent-connection PostgreSQL GC exclusion and concurrent HTTP/MCP ensure receipt regressions.
- [x] Legacy inventory quarantine, typed outcome exports and selected registry handlers wired.
- [x] Frozen participant quota reservations are scoped and memoized per transaction, with no replay recharge.
- [x] Registry baseline 0.1.4 checked; 0.2.0 host export map and migration guide included, without publishing.
- [x] Migrated content/pilot E2E fixtures to the guarded selected profile; preserved all seven content journeys.
- [x] HTTP/MCP parity now uses the same guarded fixture as the content journeys.
- [x] L6 composes provider and request guards on a request-local coordinator binding and adapts the L4/L5 callers.
- [x] Commit-contract, outcome-contract and testing subpaths exposed; local manifest bumped to 0.2.0 after checking registry 0.1.4.
- [x] HTTP upload/template and content/pilot E2E fixtures migrated; unselected operations remain unavailable.
- [x] Draft PR #738 targets feat/immo-861-integration; owner release/tuple/Radar qualification remains L8/L9 work.

## AI Flaky tests
- [x] No AI-dependent tests or timeout changes.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: L6 consumes L4/L5 and remains independent of L7.

## UAT Management (in orchestration context)
- [x] Package-only transport change; integrated consumer qualification belongs to L8.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read Docker lock, rules, template and r2 contracts; mechanical branch check passed.
  - [x] Create isolated L6 worktree and merge L5.
- [x] **Lot 1 — Transport regressions first**
  - [x] `http-routes.test.ts`: selected routes, missing configuration, trusted invocation.
  - [x] `mcp.test.ts`: discovery, direct dispatch, profile digest and typed projection.
  - [x] `http-security.test.ts`, `publication-security.test.ts`: closed inputs and sanitized failures.
  - [x] `http-mcp-service-parity.test.ts`: shared command identity, authorized retry and replay; all 9 cases passed under Compose.
- [x] **Lot 2 — Wire and migrate**
  - [x] Required compiled profile/coordinator/context; one execute path and typed projections.
  - [x] Remove split transport writes; guarded ensure/publish and legacy quarantine.
  - [x] Export host contracts, public subpaths and selected MCP registry bindings.
- [x] **Lot 3 — Final validation**
  - [x] Package typecheck, lint, unit tests and build green under shared flock.
  - [x] `make scope-check` before each commit; branch plan updated with evidence.
  - [x] Upstream heads refreshed; draft PR #738 targets the pushed integration branch.
- [x] Transport migration checkpoint: 28.
