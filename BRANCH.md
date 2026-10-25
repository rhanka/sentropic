# Feature: Artifacts transport wiring and migration (#861 L6)

## Objective
- [ ] Bind HTTP and MCP to the selected immutable profile and authorized atomic finalizers.

## Scope / Guardrails
- [x] Spec r2: `.tmp/immo-861-artifacts/spec-plan.md`, S3/L6, C1–C7, A1–A8 and E1–E3.
- [x] Worktree: `tmp/worktrees/861-L6`; branch: `feat/artifacts-861-L6`.
- [x] Merge L5 into L4; merge subsequent upstream changes without rebasing.
- [x] ENV: `test-861-l6`; API_PORT=13336, UI_PORT=9536, MAILDEV_UI_PORT=5436.
- [x] Shared Docker flock; existing Make targets only; tear down after each step; no Python.
- [x] Specific-file staging; `make commit`; fewer than 150 authored changed lines per commit.
- [x] Manifest/version changes belong to the integration owner per r2 section 6.1.

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
- [ ] Docker package targets use standalone containers; awaiting a compliant runner or explicit owner direction.
- [x] L6 composes provider and request guards on a request-local coordinator binding; publication.ts stays L4-owned.
- [ ] Integration owner: expose commit-contract, outcome-contract and testing subpaths; reserve the topic version.
- [ ] Integration owner: migrate out-of-scope HTTP upload/template and content/pilot e2e fixtures to required host composition.

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
- [ ] **Lot 1 — Transport regressions first**
  - [x] `http-routes.test.ts`: selected routes, missing configuration, trusted invocation.
  - [x] `mcp.test.ts`: discovery, direct dispatch, profile digest and typed projection.
  - [ ] `http-security.test.ts`, `publication-security.test.ts`: closed inputs and sanitized failures.
  - [x] `http-mcp-service-parity.test.ts`: shared command identity, authorized retry and replay; first 18 L6 cases passed under Compose.
- [ ] **Lot 2 — Wire and migrate**
  - [ ] Required compiled profile/coordinator/context; one execute path and typed projections.
  - [ ] Remove split transport writes; guarded ensure/publish and legacy quarantine.
  - [ ] Export host contracts and selected MCP registry bindings.
- [ ] **Lot 3 — Final validation**
  - [ ] Package typecheck, lint, unit tests and build green under shared flock.
  - [ ] `make scope-check` before each commit; update branch plan with evidence.
  - [ ] Refresh L4/L5 and merge moved heads; push draft PR targeting L4.
