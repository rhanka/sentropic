# Feature: MCP host tool workspaces_list (wagon, train 1b)

## Objective
- [x] Host tool `workspaces_list` on `/api/v1/mcp`: no arguments, closed schema, listed under `mcp:discover`, called under `mcp:tools:invoke` through `authorize()`.
- [x] Response `{workspaces:[{workspaceRef, name, role, publishable}]}`: exactly the `createArtifactAuthorization.read` predicate for the token tenant; `publishable` = that decision's `writable`.

## Scope / Guardrails
- [x] Branch feat/mcp-workspaces-list from origin/main a5d8dee87; worktree tmp/mcp-workspaces-list; ENV=test-ws-list.
- [x] Wagon: no PR, no version bump, no lock, APP-P1 pin, fixture or L5 manifest change; the train 1b integration lane merges it.
- [x] Make only; no Python, attribution trailers, CI skips or reruns.
- [x] Wired as a `createRegistryDispatchRouter` port, never a registry provider; the APP-P1 manifest stays at 4 tools.
- [x] REST `/api/v1/workspaces` stays closed to OAuth bearers.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/mcp/registry-dispatch.ts`
  - `api/src/routes/namespaces/mcp.ts`
  - `api/src/services/artifacts/authorization.ts`
  - `api/src/services/artifacts/instance.ts`
  - `api/src/services/artifacts/workspace-directory.ts`
  - `api/tests/api/mcp-workspaces-list-dispatch.test.ts`
  - `api/tests/api/mcp-workspaces-list-directory.test.ts`
  - `api/tests/api/registry-dispatch-terminal.test.ts`
  - `api/tests/api/app-artifacts-transport.test.ts`
  - `api/tests/api/mcp-resource-server.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/drizzle/**`
  - `package-lock.json`
- **Conditional Paths (allowed with declared exception)**:
  - None.

## Feedback Loop
- [x] acknowledge: test list (a)-(h) from s-archi (session sentropic-15); invalid arguments answer -32600 invalid_request (HTTP 400).
- [ ] attention: local scoped run blocked by the disk rule (host above 90%, no new local image build); validation runs in the train 1b CI.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: wagon branch merged by the train 1b integration lane.

## Plan / Todo (lot-based)
- [ ] Lot 1: red tests (a)-(h).
  - [x] `api/tests/api/mcp-workspaces-list-dispatch.test.ts` (a) discovery, (b) arguments, (c) scope and admission.
  - [ ] `api/tests/api/mcp-workspaces-list-directory.test.ts` (d) filter, (e) anti-drift, (f) revoked credential, (g) shape and order.
  - [ ] `api/tests/api/mcp-resource-server.test.ts` (h) REST stays 401 for an OAuth bearer.
  - [x] `api/tests/api/registry-dispatch-terminal.test.ts`, `api/tests/api/app-artifacts-transport.test.ts`: tools/list carries workspaces_list.
- [ ] Lot 2: implementation (shared authority source, workspace directory, dispatcher port, wiring).
- [ ] Lot gate: `make typecheck-api`, `make lint-api`, scoped `make test-api-endpoints SCOPE=...` in the train 1b CI.
