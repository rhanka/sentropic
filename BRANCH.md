# Fix: Patch HIGH devalue + MEDIUM svelte/mermaid/hono/uuid/vite CVE advisories

## Objective
Resolve outstanding Dependabot CVE alerts on `rhanka/sentropic` (HIGH `devalue` plus MEDIUM `svelte`, `mermaid`, `hono`, `uuid`, `vite`) by upgrading the affected npm packages and refreshing all three workspace lockfiles in sync. No workaround, no ignore. Real upgrades only.

## Scope / Guardrails
- Scope limited to npm package upgrades and workspace lockfile refreshes for the listed dependencies in root, `api/`, and `ui/`.
- No code changes unless an API break in an upgraded package requires a 1-2 line consumer adjustment.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/fix-security-cve-may26` with `ENV=test-fix-security-cve-may26`.
- Ports: `API_PORT=9145 UI_PORT=5345 MAILDEV_UI_PORT=1245`.
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
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `rules/**`
  - `spec/**`
  - `api/src/**`
  - `ui/src/**`
  - `packages/**`
  - `e2e/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `.security/vulnerability-register.yaml`
- **Exception process**:
  - Declare exception ID `BR-SEC3-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR-SEC3-N1 (`attention`): PR #157 only refreshed root `package-lock.json` and left `ui/package-lock.json` stale (devalue 5.8.0, @sveltejs/kit 2.52.2). This branch refreshes per-workspace lockfiles via `make install-ui-dev` / `make install-api` after each override change so Dependabot alerts close on every manifest.

## AI Flaky tests
- Not applicable. This branch does not touch AI runtime.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: All upgrades share the same workspace lockfiles; mono-branch with one commit per CVE keeps history clean.

## UAT Management (in orchestration context)
- Mono-branch. Smoke check on UI typecheck/lint/unit tests and `make build-api build-ui-image` audit gate. No manual UAT required for dep upgrades.

## Advisories Inventory (current open Dependabot alerts on main)
- HIGH `devalue` 5.8.0 (`ui/package-lock.json`) -> `>= 5.8.1` (CVE-2026-42570, GHSA-77vg-94rm-hx3p, sparse-array DoS) — root lockfile already 5.8.1, ui lockfile stale.
- MEDIUM `svelte` 5.55.5 (root + ui lockfiles) -> `>= 5.55.7` (CVE-2026-42573, CVE-2026-42599, CVE-2026-42567, GHSA-f3cj-j4f6-wq85 SSR Promise hydratable XSS).
- MEDIUM `mermaid` 11.14.0 (root lockfile only) -> `>= 11.15.0` (CVE-2026-41150, CVE-2026-41149, CVE-2026-41159, CVE-2026-41148). ui lockfile already 11.15.0.
- MEDIUM `hono` 4.12.15 (root lockfile only) -> `>= 4.12.18` (CVE-2026-44458, CVE-2026-44457, CVE-2026-44456, CVE-2026-44455). api lockfile already 4.12.18.
- MEDIUM `uuid` 11.1.0 (root, via `mermaid/node_modules/uuid`) -> `>= 11.1.1` (CVE-2026-41907). Will be covered by mermaid bump (mermaid 11.15.0 pulls uuid 11.1.1+).
- MEDIUM `vite` 5.4.21 (transitive via `vite-node 1.6.1` -> `vitest 1.6.1` in ui workspace) -> `>= 6.4.2` (CVE-2026-39365). Direct devDep `vite` already 7.3.3.
- LOW `cookie` 0.6.0, LOW `hono` 4.12.18+ (CVE-2026-44459), MEDIUM `esbuild` (no CVE): skipped per launch packet.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & inventory**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/security.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Worktree on branch `fix/security-cve-may26`, HEAD `70e008fd`.
  - [x] Confirm scope boundaries and ports.
  - [x] Inventory advisories via `gh api repos/rhanka/sentropic/dependabot/alerts`.
  - [x] Confirm `make lock-root` does NOT refresh per-workspace lockfiles -> use `make install-*` (dev stack required).
  - [x] `make up API_PORT=9145 UI_PORT=5345 MAILDEV_UI_PORT=1245 ENV=test-fix-security-cve-may26` -> all services Healthy.

- [ ] **Lot 1 — Upgrade `devalue` to 5.8.1 in `ui/package-lock.json` (CVE-2026-42570 HIGH)**
  - [ ] Override already present in `ui/package.json`; refresh `ui/package-lock.json` via `make install-ui-dev` (no-op install resolves override).
  - [ ] Verify ui lockfile shows devalue 5.8.1.
  - [ ] Atomic commit: `fix(security): refresh ui lockfile to pull devalue 5.8.1 (CVE-2026-42570 high)`

- [ ] **Lot 2 — Upgrade `svelte` to 5.55.7+ (CVE-2026-42573 CVE-2026-42599 CVE-2026-42567 medium)**
  - [ ] Bump `ui/package.json` direct devDep `svelte` to `^5.55.7`.
  - [ ] `make install-ui-dev NPM_LIB=svelte@^5.55.7 ENV=test-fix-security-cve-may26`.
  - [ ] `make lock-root API_PORT=9145 UI_PORT=5345 MAILDEV_UI_PORT=1245 ENV=test-fix-security-cve-may26`.
  - [ ] Atomic commit.

- [ ] **Lot 3 — Upgrade `mermaid` to 11.15.0+ via root override (CVE-2026-41150 41149 41159 41148 medium + bonus uuid CVE-2026-41907)**
  - [ ] Add `overrides.mermaid` and `overrides.uuid` to root `package.json` to force the patched versions across the root workspace.
  - [ ] `make lock-root API_PORT=9145 UI_PORT=5345 MAILDEV_UI_PORT=1245 ENV=test-fix-security-cve-may26`.
  - [ ] Atomic commit.

- [ ] **Lot 4 — Upgrade `hono` to 4.12.18+ via root override (CVE-2026-44458 44457 44456 44455 medium)**
  - [ ] Add `overrides.hono` to root `package.json` to pin the patched version across root workspace.
  - [ ] `make lock-root API_PORT=9145 UI_PORT=5345 MAILDEV_UI_PORT=1245 ENV=test-fix-security-cve-may26`.
  - [ ] Atomic commit.

- [ ] **Lot 5 — Upgrade `vitest` in `ui/` to >=2 (drops vulnerable `vite 5.4.21` transitive — CVE-2026-39365 medium)**
  - [ ] Bump `ui/package.json` direct devDep `vitest` from `^1.5.0` to `^3.0.0` (or `^2.0.0` if breaking).
  - [ ] `make install-ui-dev NPM_LIB=vitest@^3.0.0 ENV=test-fix-security-cve-may26`.
  - [ ] `make lock-root API_PORT=9145 UI_PORT=5345 MAILDEV_UI_PORT=1245 ENV=test-fix-security-cve-may26`.
  - [ ] If vitest upgrade breaks ui tests, fall back to override `overrides.vite` to `^6.4.2` (transitive) — document fallback in commit message.
  - [ ] Atomic commit.

- [ ] **Lot 6 — Final validation**
  - [ ] `make build-api API_PORT=9145 UI_PORT=5345 MAILDEV_UI_PORT=1245 ENV=test-fix-security-cve-may26` -> Dockerfile audit gate passes.
  - [ ] `make build-ui-image API_PORT=9145 UI_PORT=5345 MAILDEV_UI_PORT=1245 ENV=test-fix-security-cve-may26` -> UI image builds.
  - [ ] `make typecheck-ui ENV=test-fix-security-cve-may26` -> 0 errors.
  - [ ] `make test-ui-security-sca ENV=test-fix-security-cve-may26` -> 0 HIGH/CRITICAL.
  - [ ] `make test-api-security-sca ENV=test-fix-security-cve-may26` -> 0 HIGH/CRITICAL.
  - [ ] `make down ENV=test-fix-security-cve-may26`.
  - [ ] Push branch and create PR with this `BRANCH.md` as body.
