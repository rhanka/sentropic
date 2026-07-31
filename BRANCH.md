# Feature: Connector Host API Ports L2

## Objective
Implement the API-side P1 ports and the deny-by-default Google Drive host mount for `@sentropic/connector-host`.

## Scope / Guardrails
- Scope limited to `api/**`, `Makefile`, `package-lock.json`, and this branch plan.
- No schema or migration changes.
- Consume, but do not modify, `packages/connector-host/**`, `packages/mcp-platform/**`, and `packages/mcp-connector-google/**`.
- Do not modify `api/src/services/secret-crypto.ts` or the public `resolveGoogleDriveTokenSecret` null-return contract.
- Make-only workflow, no direct Docker commands.
- Automated tests run only on `ENV=test-connector-host-api` with `API_PORT=9080`, `UI_PORT=5280`, and `MAILDEV_UI_PORT=1180`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `Makefile`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/connector-host/**`
  - `packages/mcp-platform/**`
  - `packages/mcp-connector-google/**`
  - `api/src/services/secret-crypto.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR480-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.

## Feedback Loop
- [x] `BR480-ACK1` — The owner reassigned API host wiring to this lane and authorized the API plus root-lockfile scope. No schema change is required because migration 0040 already permits Gmail rows.
- [x] `BR480-EX2` — Owner authorized the Makefile CI repair: add the three workspace-package build targets and wire them into `prepare-node-workspace`. Impact: API CI prepares the published-package exports before typecheck and unit tests. Rollback: remove the targets and their prerequisite wiring.
- [x] `BR480-EX3` — L1 defect surfaced by the first real adapter: `mountConnectorHost` built its capability-visibility `VisibilityContext` with a hardcoded empty `scopes`, so `listVisibleCapabilities` denied every scope-gated adapter as missing (all Google capabilities require `drive.readonly`/`gmail.readonly`; the L1 fake connector declares no required scopes, which hid the defect). Fix: source visibility scopes from the mounted adapter's `manifest.authz.scopes`; the explicit exposure allowlist and policy remain the real per-request narrowing (deny-as-missing discovery only). Impact: `packages/connector-host/src/mount.ts` only (private package `@sentropic/connector-host` v0.0.0 — no version/publish change); the Drive mount end-to-end unit test now returns `ok:true`. Rollback: restore `scopes: []`. Flagged to architect for L1 contract review.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one bounded API integration lane with a single final test cycle.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and contract review**
  - [x] Verify `feat/connector-host-api-ports` with `harness check branch`.
  - [x] Verify scope before edits with `harness check scope`.
  - [x] Read connector-host ports/mount, Google adapter exports, secret crypto, account lifecycle, Drive route, and L2 specification.
  - [x] Confirm no migration is needed and define the isolated test environment and ports.

- [x] **Lot 1 — Workspace dependencies**
  - [x] Add API file dependencies for connector host, MCP platform, and Google connector adapters in `api/package.json`.
  - [x] Regenerate root `package-lock.json` with `make lock-root`.
  - [x] Confirm API resolves `@sentropic/connector-host` through the root workspace lockfile.
  - [x] Commit dependencies and lockfile via `make commit`.

- [x] **Lot 2 — Google Drive secret port**
  - [x] Add `api/src/services/connector-host/google-drive.ts` with a `SecretAccessError`-shaped unavailable path.
  - [x] Preflight encrypted account material through throwing `decryptSecret` so `SecretEnvelopeError` propagates unchanged.
  - [x] Reuse the existing per-account refresh resolver without changing its public null contract.
  - [x] Commit the secret port via `make commit`.

- [x] **Lot 3 — Resolvers and single mount**
  - [x] Resolve enrolled Google Drive accounts to opaque connector instances and deny ambiguous selection.
  - [x] Bind principal and workspace to the server-authenticated session with `requireWorkspaceAccess`.
  - [x] Apply the finite P1 Drive capability allowlist and mount `googleDriveLiveAdapter` through `mountConnectorHost`.
  - [x] Commit resolvers and mount factory via `make commit`.

- [ ] **Lot 4 — Hermetic proof and validation**
  - [x] Wire the API image to install and build the three new workspace dependencies.
  - [x] Build the three workspace-package exports during node-workspace preparation for API CI.
  - [x] Add `api/tests/unit/connector-host.test.ts` for secret classification, account ambiguity, session/workspace denial, and mounted Drive behavior.
  - [ ] Run scoped API unit tests: `make test-api-unit SCOPE=tests/unit/connector-host.test.ts API_PORT=9080 UI_PORT=5280 MAILDEV_UI_PORT=1180 ENV=test-connector-host-api`.
  - [ ] Run `make typecheck-lint-api ENV=test-connector-host-api`.
  - [ ] Run `make scope-check` before every commit and confirm a clean worktree after the final commit.
  - [x] Commit tests via `make commit`.
