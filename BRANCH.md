# Feature: Dependency security batch 2026-11-26 (patch/minor)

## Objective
Resolve all class (a) patch/minor Dependabot security alerts across root, `api`, `ui`, `apps/auth-idp/web`, `apps/llm-gateway`, `packages/*`, and the `selected` packaging fixture with zero breaking changes, all security overrides preserved, and passing container security scans on `ui` and `e2e`.

## Scope / Guardrails
- Scope limited to `package.json`, `package-lock.json`, `api/package.json`, `api/package-lock.json`, `ui/package.json`, `ui/package-lock.json`, `ui/Dockerfile`, `e2e/Dockerfile`, `apps/auth-idp/web/package.json`, `apps/auth-idp/web/package-lock.json`, `apps/llm-gateway/package.json`, `packages/*/package.json`, `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`, `tools/memory-mcp-l5/artifacts/**`, and `BRANCH.md`.
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
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`

## Feedback Loop
- None.

## AI Flaky tests
- None expected.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single dependency security batch PR)
- [ ] **Multi-branch**
- Rationale: All class (a) bumps and container CVE fixes belong to one cohesive security batch and single CI cycle.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & triage**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Create `chore/deps-security-batch-1126` from `origin/main` in `tmp/cm-release-0270`.
  - [x] Triage all 127 open Dependabot alerts and 19 open Dependabot PRs into `.tmp/rv/deps-security-triage.md`.

- [x] **Lot 1 — Class (a) dependency & lockfile bumps**
  - [x] Bump `vitest` (`4.0.18`/`4.1.0`/`4.1.5` -> `4.1.12`) and `@vitest/ui` (`4.1.5` -> `4.1.12`) across `api`, `apps/llm-gateway`, and affected `packages/*`.
  - [x] Bump root and `api` security overrides (`fast-uri` -> `^3.1.9`, `ip-address` -> `^10.7.6`, `mermaid` -> `^11.16.1`, `uuid` -> `^11.1.1` in `api`, `source-map-js` -> `1.2.2` in `api`) while keeping all existing overrides intact (including `@sentropic/engram@0.28.0` -> `officeparser`).
  - [x] Bump `ui` (`@sveltejs/adapter-static` `^3.0.11`, `mermaid` `^11.16.1`) and `apps/auth-idp/web` (`@sveltejs/adapter-static` `^3.0.11`, `@sveltejs/kit` `^2.70.4`, `vite` `^7.3.8`).
  - [x] Refresh `package-lock.json`, `api/package-lock.json`, `ui/package-lock.json`, `apps/auth-idp/web/package-lock.json`, and `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` inside Docker.

- [x] **Lot 2 — Container CVE fixes (r2)**
  - [x] Pin `libxml2=2.13.9-r5` and `libexpat=2.11.0-r0` in `ui/Dockerfile` and `e2e/Dockerfile`.
  - [x] Rebuild `ui` image and pass `test-ui-security-container` in Docker (`e2e` verified on CI due to 48 GB host disk guard).

- [ ] **Lot N — Validation & PR**
  - [x] Verify `make test-security-sca-gate`, `make test-ci-lockfile-installs`, `make check-train-lock-integrity`, `make test-publishable-manifests`, `make build-idp-web`.
  - [x] Verify package typecheck/test/build (`local-scheduler`, `harness`, `cluster-mesh`, `llm-mesh`, `llm-gateway`, `artifacts`, `mcp-broker`, `mcp-connector-github`).
  - [ ] Verify `make scope-check`, remove `BRANCH.md` in final commit, update PR #1083 body with lockfile justifications, push, and watch `gh pr checks 1083 --watch` until green.
