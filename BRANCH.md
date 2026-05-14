# Fix: Resolve 4 HIGH Dependabot vulnerabilities

## Objective
Resolve all 4 HIGH severity Dependabot alerts on `rhanka/entropiq` by upgrading the affected npm packages to non-vulnerable versions. No workaround, no ignore, no downgrade. Real upgrades only.

## Scope / Guardrails
- Scope limited to npm package upgrades for vulnerable dependencies in `api/`, `ui/`, and root workspace.
- No code changes unless an API break in an upgraded package requires a 1-2 line consumer adjustment.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/entropiq` reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/fix-security-high-vulnerabilities` with `ENV=test-fix-security-high-vulnerabilities`.
- Slot 0 ports: API_PORT=9090, UI_PORT=5180, MAILDEV_UI_PORT=1090.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/package-lock.json`
  - `ui/package.json`
  - `ui/package-lock.json`
  - `packages/*/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `rules/**`
  - `spec/**`
  - `api/src/**`
  - `ui/src/**`
  - `packages/*/src/**`
  - `e2e/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `.security/vulnerability-register.yaml`
- **Exception process**:
  - Declare exception ID `BR-SEC-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR-SEC-N1 (`attention`): `tests/unit/google-drive-oauth.test.ts > derives the public app return base URL from the current sent-tech API host` fails locally because the worktree `.env` defines `AUTH_CALLBACK_BASE_URL=http://localhost:5173`, which leaks into the test process. The function reads `AUTH_CALLBACK_BASE_URL` before the test's `delete process.env.AUTH_CALLBACK_BASE_URL` takes effect. Verified pre-existing on origin/main (same failure with no changes applied). CI confirms test passes when env var is absent. Not a regression caused by this branch. Recommend: separate hardening branch to make the test resilient to ambient env vars (e.g., `vi.stubEnv` or read env lazily inside the function).

## AI Flaky tests
- Not applicable. This branch does not touch AI runtime.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: Security patches share the same workspace and lockfile churn; mono-branch with one commit per CVE keeps history clean.

## UAT Management (in orchestration context)
- Mono-branch. Smoke check on API unit tests and contract tests only. No manual UAT required for dep upgrades.

## HIGH Dependabot Alerts Inventory
- Alert #135: `fast-xml-builder` 1.1.4 -> 1.1.7+ (CVE-2026-44665, GHSA-5wm8-gmm8-39j9, transitive in `api/package-lock.json`)
- Alert #94: `vite` 7.3.1 -> 7.3.2+ (CVE-2026-39363, GHSA-p9ff-h696-f583, direct devDep in `ui/`)
- Alert #93: `vite` 7.3.1 -> 7.3.2+ (CVE-2026-39364, GHSA-v2wj-q39q-566r, same fix as #94)
- Alert #72: `flatted` 3.4.1 -> 3.4.2+ (CVE-2026-33228, GHSA-rf6f-7fwh-wjgh, transitive in `ui/package-lock.json`)

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & inventory**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/security.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/fix-security-high-vulnerabilities` on `origin/main`.
  - [x] Confirm scope boundaries.
  - [x] Inventory HIGH Dependabot alerts via `gh api`.

- [x] **Lot 1 — Upgrade `vite` in `ui/` to 7.3.2+ (CVE-2026-39363, CVE-2026-39364)**
  - [x] Bump direct devDep `vite` in `ui/package.json` to `^7.3.2` (resolved to 7.3.3).
  - [x] `make install-ui-dev NPM_LIB=vite@^7.3.2 ENV=test-fix-security-high-vulnerabilities`
  - [x] Regenerate stale `ui/package-lock.json` (workspace-local) via isolated install in container.
  - [x] Lot gate:
    - [x] `make typecheck-ui ENV=test-fix-security-high-vulnerabilities` -> 0 errors
    - [x] `make lint-ui ENV=test-fix-security-high-vulnerabilities` -> clean
    - [x] `make test-ui ENV=test-fix-security-high-vulnerabilities` -> 370/370 pass
  - [x] Atomic commit: `fix(security): upgrade vite to 7.3.3 (CVE-2026-39363 CVE-2026-39364 high)`

- [x] **Lot 2 — Upgrade `flatted` to 3.4.2+ via override (CVE-2026-33228)**
  - [x] Update `ui/package.json` `overrides.flatted` to `^3.4.2`.
  - [x] Refresh `ui/package-lock.json` via isolated regenerate in container.
  - [x] Lot gate:
    - [x] `make typecheck-ui ENV=test-fix-security-high-vulnerabilities` -> 0 errors
    - [x] `make lint-ui ENV=test-fix-security-high-vulnerabilities` -> clean
    - [x] `make test-ui ENV=test-fix-security-high-vulnerabilities` -> 370/370 pass
  - [x] Atomic commit: `fix(security): upgrade flatted to 3.4.2 (CVE-2026-33228 high)`

- [x] **Lot 3 — Upgrade `fast-xml-builder` to 1.1.7+ via override (CVE-2026-44665)**
  - [x] Add `overrides.fast-xml-builder` to `api/package.json` at `^1.1.7` (resolved to 1.2.0).
  - [x] Refresh `api/package-lock.json` via isolated regenerate in container.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-fix-security-high-vulnerabilities` -> 0 errors
    - [x] `make lint-api ENV=test-fix-security-high-vulnerabilities` -> 0 errors, 184 warnings (pre-existing console.log warnings)
    - [x] `make test-api-unit ENV=test-fix-security-high-vulnerabilities` -> 493/494 pass (1 pre-existing failure in `tests/unit/google-drive-oauth.test.ts` due to local .env AUTH_CALLBACK_BASE_URL; not a regression — verified by reproducing on baseline; CI passes)
  - [x] Atomic commit: `fix(security): upgrade fast-xml-builder to 1.2.0 (CVE-2026-44665 high)`

- [x] **Lot 4 — Final validation**
  - [x] `make typecheck-api ENV=test-fix-security-high-vulnerabilities` -> 0 errors
  - [x] `make typecheck-ui ENV=test-fix-security-high-vulnerabilities` -> 0 errors
  - [x] `make lint-api ENV=test-fix-security-high-vulnerabilities` -> 0 errors, 184 warnings (pre-existing)
  - [x] `make lint-ui ENV=test-fix-security-high-vulnerabilities` -> clean
  - [x] `make test-api-unit ENV=test-fix-security-high-vulnerabilities` -> 493/494 pass (1 pre-existing failure, see Feedback Loop BR-SEC-N1)
  - [x] `make test-api-endpoints SCOPE=tests/api/chat.test.ts ENV=test-fix-security-high-vulnerabilities` -> 28/28 pass
  - [x] `make test-api-endpoints SCOPE=tests/api/chat-bootstrap-contract.test.ts ENV=test-fix-security-high-vulnerabilities` -> 1/1 pass
  - [x] `make test-api-endpoints SCOPE=tests/api/chat-checkpoint-contract.test.ts ENV=test-fix-security-high-vulnerabilities` -> 1/1 pass
  - [x] `make test-api-endpoints SCOPE=tests/api/chat-message-actions.test.ts ENV=test-fix-security-high-vulnerabilities` -> 4/4 pass
  - [x] `make down ENV=test-fix-security-high-vulnerabilities` -> services stopped
  - [ ] Push branch and create PR with this `BRANCH.md` as body.
