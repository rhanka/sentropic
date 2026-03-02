# Feature: API minimatch vulnerability remediation

## Objective
Eliminate the API-side `minimatch` vulnerability path with the smallest complete change set. Prefer semver-compatible dependency upgrades first, keep scope restricted to API/tooling dependency chain hardening, and provide before/after vulnerability evidence.

## Scope / Guardrails
- Scope limited to API/tooling dependency chain (`minimatch`, `eslint`/`typescript` ecosystem as needed) and compatibility fixes only.
- One migration max in `api/drizzle/*.sql` (not expected for this branch).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/fix-api-minimatch`.
- Automated test campaigns must run on dedicated environments (`ENV=test-fix-api-minimatch`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/package-lock.json`
  - `api/tsconfig*.json`
  - `api/.eslintrc*`
  - `api/eslint.config.*`
  - `api/src/**` (only if required by tooling upgrade breakage)
  - `api/tests/**` (only if required by tooling upgrade breakage)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `ui/**`
  - `e2e/**`
  - `.cursor/rules/**`
  - `docker-compose*.yml`
  - `Makefile`
  - other tmp worktrees
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/Dockerfile` (only via declared exception)
- **Exception process**:
  - Declare exception ID `BR-SEC-MINIMATCH-EXn` in `## Feedback Loop` before touching any out-of-scope path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- **ID**: `BR-SEC-MINIMATCH-EX1`
  - Branch: `fix/api-minimatch`
  - Owner: `codex`
  - Severity: `high`
  - Status: `acknowledge` (user-approved scope extension)
  - Repro steps:
    - Run `make test-api-security-container API_PORT=8795 UI_PORT=5185 MAILDEV_UI_PORT=1095 ENV=test-fix-api-minimatch`
  - Expected:
    - No unaccepted HIGH minimatch findings in API image scan.
  - Actual:
    - HIGH findings on npm bundled minimatch `10.2.2`:
      - `CVE-2026-27903_api_minimatch_10.2.2`
      - `CVE-2026-27904_api_minimatch_10.2.2`
  - Evidence:
    - `.security/container-api-parsed.yaml`
    - make output signature: `usr/local/lib/node_modules/npm/node_modules/minimatch/package.json`
  - Decision needed:
    - Patch `api/Dockerfile` to force npm bundled minimatch upgrade (`10.2.4`) in base and production stages.
  - Impact:
    - Adds one security hardening step similar to existing npm internal `glob`/`tar` patching.
  - Rollback:
    - Revert Dockerfile minimatch patch blocks and rebuild image.
- **ID**: `BR-SEC-MINIMATCH-FL1`
  - Branch: `fix/api-minimatch`
  - Owner: `codex`
  - Severity: `medium`
  - Status: `acknowledge` (resolved via Option B)
  - Repro steps:
    - Run `make exec-api CMD="npm run typecheck" API_PORT=8895 UI_PORT=5285 MAILDEV_UI_PORT=1195 ENV=test-fix-api-minimatch`
  - Expected:
    - Typecheck completes with exit code 0/1 and diagnostics.
  - Actual:
    - With `typescript@5.9.3`, `tsc --noEmit` was unstable (`Error 137` / OOM).
    - After rollback to `typescript@5.4.5` and minimal typing fixes in `api/src`, typecheck completes with exit code 0.
  - Evidence:
    - before: `make exec-api CMD="npm run typecheck" ...` -> non-terminating/OOM.
    - after: `make exec-api CMD="npm run typecheck" ...` -> pass.
  - Decision needed:
    - none (decision applied: Option B).
  - Impact:
    - Stable typecheck restored while keeping minimatch remediation and upgraded lint/test stack.
  - Rollback:
    - Re-upgrade TypeScript and re-run full compatibility pass if desired later.

## AI Flaky tests
- Not in scope for this branch (API dependency/security/tooling change only, no AI behavior change expected).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single orthogonal security fix branch with tightly bounded dependency/tooling scope.

## UAT Management (in orchestration context)
- **Web app**:
  - [ ] N/A expected: no UI code touched (`ui/**` forbidden).
  - [ ] Confirm API-compatible contract behavior via scoped API tests instead of UI UAT.
- **Chrome plugin**:
  - [ ] N/A expected: no chrome/plugin paths touched.
- **VSCode plugin**:
  - [ ] N/A expected: no vscode/plugin paths touched.

## Environment mapping
- Branch env: `ENV=dev-fix-api-minimatch`
- Test env: `ENV=test-fix-api-minimatch`
- Suggested ports (if service startup is needed): `API_PORT=8795`, `UI_PORT=5185`, `MAILDEV_UI_PORT=1095`

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read required `.mdc` files and mandatory docs in provided order.
  - [x] Confirm isolated worktree and branch (`tmp/fix-api-minimatch`, `fix/api-minimatch`).
  - [x] Confirm scope and guardrails from launch packet.
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last.
  - [x] Define env mapping for branch/test.
  - [x] Create this `BRANCH.md` from template.

- [x] **Lot 1 — Dependency chain investigation and baseline evidence**
  - [x] Identify exactly which packages pull vulnerable `minimatch` (direct/transitive) at root and `api/`.
  - [x] Record vulnerability evidence (command + affected versions/paths) before any fix.
  - [x] Decide smallest safe fix path:
    - [x] semver-compatible bumps first
    - [x] if only major upgrades fix it, stop and request conductor decision with options
  - [x] Lot gate:
    - [x] Vulnerability baseline command(s) captured with concise summary.

- [x] **Lot 2 — Apply dependency/tooling remediation**
  - [x] Upgrade dependency chain to remove vulnerable `minimatch` path (API/tooling first).
  - [x] Keep change minimal (`eslint`/`typescript` and related tooling only when required).
  - [x] Update lockfile(s) consistently.
  - [x] If upgrades cause lint/typecheck breakage, apply minimal compatibility changes in:
    - [ ] `api/tsconfig*.json` (not needed)
    - [x] `api/.eslintrc*` or `api/eslint.config.*`
    - [x] `api/src/**` or `api/tests/**` (typed union fix for OpenAI tool mapping + async generator compatibility)
  - [ ] Commit atomically once slice is coherent.

- [x] **Lot 3 — Focused validation**
  - [x] Vulnerability check after fix (same command family as Lot 1) and compare before/after.
  - [x] API lint/typecheck in impacted area.
    - [x] `make exec-api CMD="npm run typecheck" API_PORT=8795 UI_PORT=5185 MAILDEV_UI_PORT=1095 ENV=dev-fix-api-minimatch`
    - [x] `make exec-api CMD="npm run lint" API_PORT=8795 UI_PORT=5185 MAILDEV_UI_PORT=1095 ENV=dev-fix-api-minimatch` (0 errors, warnings only)
  - [x] Scoped API tests for impacted files only (file-level explicit list once identified).
    - [x] `make test-api SCOPE=tests/security/security-basic.test.ts API_PORT=8895 UI_PORT=5285 MAILDEV_UI_PORT=1195 ENV=test-fix-api-minimatch`
  - [ ] If a failure occurs:
    - [x] capture exact signature
    - [x] gather relevant logs
    - [x] diff vs `origin/main`
    - [x] classify product bug vs test bug before patching

- [ ] **Lot N — Final validation and handoff**
  - [ ] Confirm scope adherence (allowed paths only).
  - [ ] Confirm before/after vulnerability evidence is explicit.
  - [ ] Ensure branch env cleanup if services were started:
    - [ ] `make down ENV=dev-fix-api-minimatch`
    - [ ] `make ps ENV=dev-fix-api-minimatch`
  - [ ] Prepare concise run report:
    - [ ] Done (files)
    - [ ] Checks run (commands + result)
    - [ ] Blockers/decisions needed
    - [ ] Risks
    - [ ] Next immediate action + ETA
