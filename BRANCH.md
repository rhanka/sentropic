# Feature: Artifacts share R1/R5 fix (single-wagon 0.2.15)

## Objective
Fix review findings R1 (raw sub fallback in userRef projection) and R5 (revoke blocked for dormant principals) in `@sentropic/artifacts`, with scoped tests and a single-wagon 0.2.15 release.

## Scope / Guardrails
- Scope limited to `@sentropic/artifacts` userRef projection, revoke approval gate, scoped tests, and the single-wagon 0.2.15 release files.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/share-r1-r5` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Docker through `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make … ENV=test-share-r1r5` (one slot per command, never nested).
- No `[skip ci]` in any commit; never `gh run rerun` (fresh pull_request run via a new commit instead).
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- Every existing MCP tool definition stays byte-identical (tools/list snapshot must pass); output values change, schemas do not.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/http.ts`
  - `packages/artifacts/src/server/management.ts`
  - `packages/artifacts/src/server/ports.ts`
  - `packages/artifacts/tests/share-r1-r5.test.ts`
  - `packages/artifacts/tests/fixtures/memory-directory.ts`
  - `packages/artifacts/tests/share-g2-errors.test.ts`
  - `packages/artifacts/CHANGELOG.md`
  - `packages/artifacts/package.json`
  - `package-lock.json`
  - `api/package-lock.json`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
  - `tools/memory-mcp-l5/artifacts/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single small fix with scoped tests and one CI on the final head.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI surface changes; UAT = package suites + CI. No browser UAT for this fix.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/share-r1-r5`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/worktrees/share-r1-r5` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read the relevant `.mdc` files and `README.md`.
  - [ ] Create/confirm isolated worktree `tmp/worktrees/share-r1-r5` and run development there.
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Define environment mapping (`dev`, `test`, `e2e`) and ports for this branch.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Confirm scope and guardrails.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
- [ ] **Lot 1 — R1 no-raw-sub projection**
  - [ ] Replace every `describePrincipal(...)?.userRef ?? internalId` fallback with the opaque unknown value.
  - [ ] Cover `projectUserRef`, `list_access` grants + owner, `set_access` receipt, `list_versions` v1 author (plus v2 authorPrincipalId).
  - [ ] Add tests proving no raw internal id appears in any output.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint` scoped to artifacts
    - [ ] Scoped run: `docker-slot.sh make test-artifacts` equivalent with `ENV=test-share-r1r5`
- [ ] **Lot 2 — R5 revoke for dormant principals**
  - [ ] Limit `assertShareable` approval enforcement to `grant`; allow `revoke` for suspended/deleted principals.
  - [ ] Add tests: suspend beneficiary then revoke then re-approve still refused; deleted principal grant revoked.
  - [ ] Lot gate: scoped artifacts tests `ENV=test-share-r1r5`
- [ ] **Lot 3 — Single-wagon 0.2.15 release**
  - [ ] Bump `@sentropic/artifacts` to 0.2.15 with CHANGELOG entry.
  - [ ] Refresh locks, APP-P1 pin, fixtures and L5 manifest through make.
  - [ ] Verify MCP tool definitions byte-identical (tools/list snapshot).
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest scoped artifacts suite `ENV=test-share-r1r5`
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.

## Lot 0 environment
- Worktree: `tmp/worktrees/share-r1-r5`, branch `fix/artifacts-share-r1-r5`, base `origin/main` `b9cdb2d33`.
- Test env: `ENV=test-share-r1r5` (always last argument); never `ENV=dev`.
- Ports: `API_PORT=8793`, `UI_PORT=5179`, `MAILDEV_UI_PORT=1093`.
