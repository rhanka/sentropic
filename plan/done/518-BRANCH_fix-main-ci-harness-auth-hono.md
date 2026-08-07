# Archive: Restore main CI validation and publication for harness and auth-hono

## Objective
Diagnose and fix the two failed jobs in main CI run 31142348331: `validate-harness` and `publish-auth-hono`. Keep the correction limited to the proven causes and restore a green main publication lane.

## Scope / Guardrails
- Scope limited to the failing harness/auth-hono CI paths and their directly affected tests or release metadata.
- No DB migrations or product behavior changes.
- Make-only workflow; no direct Docker commands.
- Development occurs only in `tmp/fix-main-ci-harness-auth-hono`.
- Tests use `ENV=test-fix-main-ci-harness-auth-hono`, never root `dev`.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/ci.yml`
  - `packages/harness/**`
  - `packages/auth-hono/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/drizzle/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (bootstrap publication only; `BR00-EX1`)
  - `plan/done/518-BRANCH_fix-main-ci-harness-auth-hono.md` (branch archive only; `BR00-EX2`)
  - `package.json`
  - `package-lock.json`
- **Exception process**:
  - Declare a `BR00-EXn` item in `## Feedback Loop` with reason, impact, and rollback before touching a conditional path.

## Feedback Loop
- `BR-CI-01`: Main CI run 31142348331 `validate-harness` failed before typecheck because the GitHub runner timed out reaching `registry-1.docker.io` while booting BuildKit. A same-SHA rerun in workflow-dispatch run 31142823600 passed `validate-harness`; no repository change is appropriate.
- `BR-CI-02`: Main CI run 31142348331 `publish-auth-hono` built the tarball then failed `ENEEDAUTH`, proving `@sentropic/auth-hono@0.15.0` has no configured npm Trusted Publisher yet.
- `BR00-EX1` (accepted, 2026-08-07): modify `Makefile` only to make the existing token bootstrap publication invoke npm with provenance disabled. Reason: the bootstrap token path otherwise inherits `publishConfig.provenance: true` and fails with `Automatic provenance generation not supported for provider: null`. Impact: only the one-time bootstrap artifact lacks provenance; normal OIDC publication remains unchanged. Rollback: revert the explicit bootstrap-only npm flag after the package is published and its Trusted Publisher is configured.
- `BR00-EX2` (accepted, 2026-08-07): archive this completed plan at `plan/done/518-BRANCH_fix-main-ci-harness-auth-hono.md` and remove root `BRANCH.md` before merging. Reason: mandatory branch-closure workflow. Impact: historical planning record moves out of the branch root only. Rollback: restore `BRANCH.md` from the archive commit if the branch needs to reopen.

## AI Flaky tests
- N/A. These are deterministic CI validation and publication jobs.

## Orchestration Mode
- [x] **Mono-branch** — both failures are in one main CI execution and share a single focused diagnostic.
- Rationale: diagnose independently, integrate only the smallest fixes supported by evidence.

## Plan / Todo
- [x] **Lot 0 — Evidence**
  - [x] Create and validate the isolated worktree.
  - [x] Record the harness debug act.
  - [x] Extract the exact failures from GitHub Actions job logs.
  - [x] Name one evidenced root cause per job.

- [x] **Lot 1 — Focused fixes**
  - [x] Confirm `validate-harness` passes when GitHub retries the transient Docker Hub bootstrap.
  - [x] Fix the `publish-auth-hono` token bootstrap provenance conflict.
  - [x] Run only the relevant make validation targets for the affected packages (`make build-auth-hono` and `make pack-auth-hono`).

- [x] **Lot N — Delivery**
  - [x] Run `make scope-check ENV=test-fix-main-ci-harness-auth-hono`.
  - [x] Commit atomically with `make commit`.
  - [x] Push and open draft PR #518 using this plan as its body.
  - [x] Verify complete CI run 31143590125 passed, including `validate-harness` and `validate-auth-hono`.
  - [x] Archive/remove `BRANCH.md` before merge.
