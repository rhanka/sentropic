# Feature: ARCH-11 G1c asynchronous tenant authorization contract

## Objective
- [ ] Make the mcp-platform tenant resolver contract asynchronous while preserving fail-closed authorization and concurrent resolver calls.

## Scope / Guardrails
- [ ] Scope limited to `packages/mcp-platform/src/authz.ts`, `packages/mcp-platform/tests/authz.test.ts`, package metadata, and this branch file.
- [ ] Make-only workflow; no API changes.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - `packages/mcp-platform/src/authz.ts`
  - `packages/mcp-platform/tests/authz.test.ts`
  - `packages/mcp-platform/tests/persistence.test.ts`
  - `packages/mcp-platform/package.json`
  - `packages/mcp-platform/etc/mcp-platform.api.md`
  - `BRANCH.md`
- [ ] **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`

## Feedback Loop
- [ ] None.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read governing rules, the ARCH-11 G1c contract, implementation, and authorization tests.
  - [x] Verify the isolated branch and Make targets.
- [x] **Lot 1 — Async resolver contract**
  - [x] Change `TenantResolver`, tenant resolution, request authorization, and in-memory registry to promises.
  - [x] Initiate enrollment and every present domain-hint lookup concurrently after token verification.
  - [x] Update all mcp-platform authorization test call sites and add verify-order and concurrent-hint tests.
  - [x] Bump `@sentropic/mcp-platform` patch version and verify the public API report.
- [ ] **Lot 2 — Validation and commit**
  - [x] Run `make test-mcp-platform ENV=arch11-async-authz`.
  - [x] Run `make typecheck-mcp-platform ENV=arch11-async-authz` (passes).
  - [x] Run `make test-mcp-platform ENV=arch11-async-authz` (89 tests pass).
  - [x] Run `make api-extract-mcp-platform` and `make pack-mcp-platform` (pass).
  - [x] Regenerate the root lockfile with `make lock-root`.
  - [ ] Global `make lint` is blocked by missing Docker buildx while starting the unrelated UI image; targeted MCP gates pass.
  - [x] Commit the atomic change with `make commit`.
