# Fix: Resolve remaining @sveltejs/kit + devalue advisories

## Objective
Resolve the remaining UI workspace advisories on `rhanka/entropiq` by upgrading `@sveltejs/kit` (GHSA-fpg4-jhqr-589c, low) and `devalue` (GHSA-77vg-94rm-hx3p / CVE-2026-42570, HIGH) to non-vulnerable versions. No workaround, no ignore. Real upgrades only.

## Scope / Guardrails
- Scope limited to npm package upgrades for the two listed dependencies in `ui/` and root workspace.
- No code changes unless an API break in an upgraded package requires a 1-2 line consumer adjustment.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/entropiq` reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/fix-security-remaining-vulns` with `ENV=test-fix-security-remaining-vulns`.
- Slot 0 ports: API_PORT=9905, UI_PORT=5905, MAILDEV_UI_PORT=1905.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `package.json`
  - `package-lock.json`
  - `ui/package.json`
  - `ui/package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `rules/**`
  - `spec/**`
  - `api/**`
  - `ui/src/**`
  - `packages/**`
  - `e2e/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `.security/vulnerability-register.yaml`
- **Exception process**:
  - Declare exception ID `BR-SEC2-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- none

## AI Flaky tests
- Not applicable. This branch does not touch AI runtime.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: Both upgrades touch the UI workspace and shared root lockfile; a single mono-branch keeps lockfile churn coherent.

## UAT Management (in orchestration context)
- Mono-branch. Smoke check on UI typecheck/lint/unit tests and a production UI image build. No manual UAT required for dep upgrades.

## Advisories Inventory
- Alert #151/#152: `devalue` 5.7.1 (root lockfile) and 5.8.0 (ui lockfile) -> `>= 5.8.1` (CVE-2026-42570, GHSA-77vg-94rm-hx3p, transitive via `@sveltejs/kit` + `svelte`). Severity: HIGH (CVSS 7.5).
- GHSA-fpg4-jhqr-589c: `@sveltejs/kit` 2.52.2 -> `>= 2.53.3` (form remote function file array DoS). Severity: LOW. Not exposed (project does not enable `experimental.remoteFunctions`), upgrade is preventive.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & inventory**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/security.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm isolated worktree `tmp/fix-security-remaining-vulns` on branch `fix/security-remaining-vulns`, HEAD `edbe7d24`.
  - [x] Confirm scope boundaries and Slot 0 ports.
  - [x] Inventory advisories via `gh api /advisories/<ghsa>` and `gh api /repos/rhanka/entropiq/dependabot/alerts`.

- [ ] **Lot 1 — Upgrade `@sveltejs/kit` to 2.53.3+ and force `devalue` override to 5.8.1+**
  - [ ] Bump direct devDep `@sveltejs/kit` in `ui/package.json` to `^2.53.3`.
  - [ ] Add `overrides.devalue` `^5.8.1` to `ui/package.json` so kit and svelte transitive copies resolve to the patched version.
  - [ ] Regenerate root `package-lock.json` (and `ui/package-lock.json` via workspaces) via `make lock-root API_PORT=9905 UI_PORT=5905 MAILDEV_UI_PORT=1905 ENV=test-fix-security-remaining-vulns`.
  - [ ] Verify `package-lock.json` and `ui/package-lock.json` reflect kit 2.53.3+ and devalue 5.8.1+.
  - [ ] Lot gate:
    - [ ] `make typecheck-ui API_PORT=9905 UI_PORT=5905 MAILDEV_UI_PORT=1905 ENV=test-fix-security-remaining-vulns` -> 0 errors
    - [ ] `make lint-ui API_PORT=9905 UI_PORT=5905 MAILDEV_UI_PORT=1905 ENV=test-fix-security-remaining-vulns` -> clean
    - [ ] `make test-ui API_PORT=9905 UI_PORT=5905 MAILDEV_UI_PORT=1905 ENV=test-fix-security-remaining-vulns` -> all pass
    - [ ] `make test-ui-security-sca API_PORT=9905 UI_PORT=5905 MAILDEV_UI_PORT=1905 ENV=test-fix-security-remaining-vulns` -> 0 HIGH/CRITICAL
    - [ ] `make test-api-security-sca API_PORT=9905 UI_PORT=5905 MAILDEV_UI_PORT=1905 ENV=test-fix-security-remaining-vulns` -> regression check, still 0 HIGH/CRITICAL
    - [ ] `make build-ui-image API_PORT=9905 UI_PORT=5905 MAILDEV_UI_PORT=1905 ENV=test-fix-security-remaining-vulns` -> production image builds
    - [ ] `make down API_PORT=9905 UI_PORT=5905 MAILDEV_UI_PORT=1905 ENV=test-fix-security-remaining-vulns`
  - [ ] Atomic commit: `fix(security): upgrade @sveltejs/kit + devalue to patch 2 remaining HIGH advisories (GHSA-fpg4-jhqr-589c, GHSA-77vg-94rm-hx3p)`

- [ ] **Lot 2 — Final validation**
  - [ ] Push branch and create PR with this `BRANCH.md` as body (deferred to user).
  - [ ] Verify CI gates on PR (deferred to user).
  - [ ] Once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge (deferred to user).
