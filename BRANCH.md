# Feature: Dependency security batch 2026-11-26 (patch/minor)

## Objective
Resolve all class (a) patch/minor Dependabot security alerts across root, `api`, `ui`, `apps/auth-idp/web`, `apps/llm-gateway`, `packages/*`, and the `selected` packaging fixture with zero breaking changes, all security overrides preserved, passing container security scans, and verified r3 fixes for R1–R4.

## Scope / Guardrails
- Scope limited to `package.json`, `package-lock.json`, `api/package.json`, `api/package-lock.json`, `ui/package.json`, `ui/package-lock.json`, `ui/Dockerfile`, `e2e/Dockerfile`, `apps/auth-idp/web/package.json`, `apps/auth-idp/web/package-lock.json`, `apps/llm-gateway/package.json`, `packages/*/package.json`, `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`, `tools/memory-mcp-l5/artifacts/**`, `scripts/ci/tool-locks.json`, `Makefile`, `.github/workflows/ci.yml`, and `BRANCH.md`.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/cm-release-0270` (`chore/deps-security-batch-1126`).
- Automated tests run on `ENV=deps-sec` / `ENV=test-deps-sec`, never on `ENV=dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/package-lock.json`
  - `ui/package.json`
  - `ui/package-lock.json`
  - `ui/Dockerfile`
  - `e2e/Dockerfile`
  - `apps/auth-idp/web/package.json`
  - `apps/auth-idp/web/package-lock.json`
  - `apps/llm-gateway/package.json`
  - `packages/*/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `tools/memory-mcp-l5/artifacts/**`
  - `scripts/ci/tool-locks.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/**`
  - `api/drizzle/*.sql` (max 1 file)

## Feedback Loop
- `BR1083-EX1` (`attention` -> `acknowledge`): Scope exception for `Makefile`, `.github/workflows/ci.yml`, and `scripts/ci/tool-locks.json`.
  - Reason: Review R1 requires the five class (a) packages (`artifacts`, `connector-host`, `harness`, `local-scheduler`, `skills`) to execute and log `vitest@4.1.12` in their `make` and CI test lanes instead of pinned `vitest@4.0.18` / `vitest@4.1.0` locked tools; also `lock-api` requires isolated `node:24-alpine` `--workspaces=false` execution so npm regenerates `api/package-lock.json` without building a full compose stack under the 48 GB host disk guard.
  - Impact: Updates `vitest@4.1.12` specs and adds `vitest --version` logging in `test-artifacts`, `test-artifacts-integration`, `test-connector-host`, `test-harness`, `typecheck-local-scheduler`, `test-local-scheduler`, and `test-skills`; adds `make test-skills ENV=test-ci-skills` to `validate-skills` in `.github/workflows/ci.yml`; regenerates `scripts/ci/tool-locks.json` via `make lock-ci-tools`.
  - Rollback: Revert the r3 `Makefile`, `.github/workflows/ci.yml`, and `scripts/ci/tool-locks.json` commits.

## AI Flaky tests
- None expected.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single dependency security batch PR)
- [ ] **Multi-branch**
- Rationale: All class (a) bumps, container fixes, and r3 review remediations belong to one cohesive security batch and single CI cycle.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & triage**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Create `chore/deps-security-batch-1126` from `origin/main` in `tmp/cm-release-0270`.
  - [x] Triage all 127 open Dependabot alerts and 19 open Dependabot PRs into `.tmp/rv/deps-security-triage.md`.

- [x] **Lot 1 — Class (a) dependency & lockfile bumps**
  - [x] Bump `vitest` (`4.0.18`/`4.1.0`/`4.1.5` -> `4.1.12`) and `@vitest/ui` (`4.1.5` -> `4.1.12`) across `api`, `apps/llm-gateway`, and affected `packages/*`.
  - [x] Bump root and `api` security overrides while keeping all existing overrides intact (including `@sentropic/engram@0.28.0` -> `officeparser`).
  - [x] Bump `ui` and `apps/auth-idp/web` class (a) packages.

- [x] **Lot 2 — Container CVE fixes (r2)**
  - [x] Pin `libxml2=2.13.9-r5` and `libexpat=2.11.0-r0` in `ui/Dockerfile` and `e2e/Dockerfile`.

- [ ] **Lot 3 — Review r3 remediations (R1–R4 & N1–N4)**
  - [x] Regenerate `package-lock.json` via `make lock-root ENV=deps-sec` from `origin/main` lock state, removing hand-added `overrides` and stale `4.1.5` peers, and prove `officeparser@8.2.0` / `6.0.7` subtrees are byte-identical to `origin/main`.
  - [x] Re-sync and regenerate `api/package-lock.json` via Docker `make lock-api ENV=deps-sec` from `origin/main` lock state, syncing reverted workspace manifests and removing stale `4.1.5` peers, and prove `officeparser@6.0.7` subtree is byte-identical to `origin/main`.
  - [x] Bump the five packages' locked-tool `vitest` specs to `4.1.12` in `Makefile` (with version logging), add `test-skills` to CI `validate-skills`, and regenerate `scripts/ci/tool-locks.json` via `make lock-ci-tools ENV=deps-sec`.
  - [x] Disclose `uuid` major-range override (`^11.1.1`) and notes N1–N3 in triage and PR #1083 body.

- [ ] **Lot N — Validation & PR**
  - [x] Re-run affected `make` targets in Docker (`test-ci-lockfile-installs`, `memory-l5-verify`, `test-security-sca-gate`, `test-harness`, `test-local-scheduler`, `typecheck-local-scheduler`, `test-artifacts`, `test-connector-host`, `test-skills`, `test-publishable-manifests`).
  - [ ] Verify `make scope-check ENV=deps-sec`, remove `BRANCH.md` in final commit, update PR #1083 body, push, and watch `gh pr checks 1083 --watch` until green.
