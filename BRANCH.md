# Feature: Lot F — publishable mcp-auth dependency

## Objective
- [x] Repair the mcp-auth dependency manifest for release 0.2.1 and guard against local dependency references.

## Scope / Guardrails
- [x] Worktree: `tmp/mcp-auth-dep-fix`; branch: `fix/mcp-auth-oauth-verify-dep`; base: `origin/main`.
- [x] Make-only, Docker-first; no push, PR, merge, or publish.
- [x] Environment: `ENV=test-mcp-auth-dep-fix`; ports: `API_PORT=9430 UI_PORT=5630 MAILDEV_UI_PORT=1530`; ENV always last.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `packages/mcp-auth/**`
  - `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `.github/workflows/**`
  - All other paths except the conditional path below.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`: only if strictly required; declare `BRF-EX1` with reason, impact, and rollback first.

## Feedback Loop
- [x] BRF-A1 — attention: use the existing make targets' explicit local oauth-verify symlink; avoid a workspace install and lockfile churn. Owner: branch implementer; 2026-09-24.
- [x] BRF-A2 — attention: out-of-monorepo install proof deferred to post-publish registry verification. No suitable existing make target; candidate target only packs llm-mesh/gateway. Owner: conductor; 2026-09-24.
- [x] BRF-A3 — attention: pack-mcp-auth is dry-run only; inspect a real temporary tarball inside the Docker-run package test, then remove it. No Makefile change or host npm required. Owner: branch implementer; 2026-09-24.

## AI Flaky tests
- [x] None applicable: deterministic package tests.

## Orchestration Mode (AI-selected)
- [x] Mono-branch execution; one bounded fix, no delegated implementation.

## UAT Management (in orchestration context)
- [x] No UI surfaces affected; package qualification is the acceptance surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory rules and branch template; verify branch mechanically with harness.
  - [x] Registry latest is 0.2.0 with a file dependency; origin/main oauth-verify is 0.1.0.
  - [x] Discover make targets and verify allocated ports are free.
- [x] **Lot F — Manifest repair**
  - [x] Add `packages/mcp-auth/tests/package-manifest.test.ts` for dependencies, peerDependencies, and optionalDependencies.
  - [x] Observe the regression test fail against the original manifest: dependencies.@sentropic/oauth-verify matched `file:`.
  - [x] Bump `packages/mcp-auth/package.json` to 0.2.1 and use `^0.1.0`.
  - [x] Add minimal `packages/mcp-auth/CHANGELOG.md`; precedent: packages/cluster-mesh/CHANGELOG.md.
- [x] **Final validation**
  - [x] `make typecheck-mcp-auth test-mcp-auth pack-mcp-auth API_PORT=9430 UI_PORT=5630 MAILDEV_UI_PORT=1530 ENV=test-mcp-auth-dep-fix`: PASS, 51 tests across seven files.
  - [x] Packed dependencies: `{"@sentropic/oauth-verify":"^0.1.0"}`; realpath assertion confirms local oauth-verify resolution.
  - [x] Record the required deferred clean consumer proof in BRF-A2.
  - [x] `make down API_PORT=9430 UI_PORT=5630 MAILDEV_UI_PORT=1530 ENV=test-mcp-auth-dep-fix`: PASS.
  - [x] `make ps API_PORT=9430 UI_PORT=5630 MAILDEV_UI_PORT=1530 ENV=test-mcp-auth-dep-fix`: no remaining services.
  - [x] Review the minimal diff; stage only BRANCH.md and the three package files for scope-check and make commit.
  - [x] `make scope-check API_PORT=9430 UI_PORT=5630 MAILDEV_UI_PORT=1530 ENV=test-mcp-auth-dep-fix`: PASS C2; commit with `fix(mcp-auth): use published oauth-verify dependency`.
