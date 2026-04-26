# Feature: High vulnerability remediation

## Objective
Remove the current HIGH dependency vulnerability from the API dependency graph on an isolated fix branch, with a real package update and no register-only workaround.

## Scope / Guardrails
- Scope limited to API dependency manifests, API image build wiring if strictly required for the fix, roadmap tracking, and this branch file.
- No application behavior changes.
- Make-only workflow for install/build/test/security runs.
- Root workspace `/home/antoinefa/src/entropic` stays untouched for development.
- Branch development happens only in `tmp/fix-high-vulnerabilities`.
- Automated checks run on dedicated branch environments, never on root `ENV=dev`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/package.json`
  - `api/package-lock.json`
  - `api/Dockerfile`
  - `PLAN.md`
  - `TODO.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `ui/**`
  - `api/src/**`
  - `api/tests/**`
  - `.security/vulnerability-register.yaml`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `scripts/security/**`
- **Exception process**:
  - Declare exception ID `FIXHIGH-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention`: if the fix requires widening scope beyond dependency manifests or image install steps, record the reason here before editing.
- `attention` `FIXHIGH-EX1`: widen scope to `Makefile` and `scripts/security/**` because the API dependency graph is now fixed (`npm audit` and image build no longer report HIGH), but Trivy SCA/container parsing still reports `@xmldom/xmldom@0.9.9` from metadata instead of the resolved `0.9.10`. Impact: security gating implementation changes for Node package scanning. Rollback: revert `Makefile`/`scripts/security/**` and keep only dependency updates.

## AI Flaky tests
- Not applicable for this branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: the work is a focused dependency remediation with a single verification chain.

## UAT Management (in orchestration context)
- No manual UAT required. Validation is dependency, build, and security gate based.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant project rules and roadmap files.
  - [x] Create/confirm isolated worktree `tmp/fix-high-vulnerabilities` and run development there.
  - [x] Capture Makefile targets needed for security/build verification.
  - [x] Define environment mapping: `ENV=test-fix-high-vulnerabilities` for branch checks.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries.

- [x] **Lot 1 — Dependency remediation**
  - [x] Reproduce the HIGH vulnerability locally with the existing security/build targets.
  - [x] Identify the direct or transitive source package that resolves `@xmldom/xmldom` to the vulnerable version.
  - [x] Update the dependency resolution to a fixed version without using the vulnerability register as a workaround.
  - [x] Refresh the API lockfile accordingly.
  - [x] Lot gate:
    - [x] `make typecheck-api REGISTRY=local API_PORT=9087 UI_PORT=5287 MAILDEV_UI_PORT=1187 ENV=test-fix-high-vulnerabilities`
    - [x] `make build-api-image REGISTRY=local ENV=test-fix-high-vulnerabilities`
    - [x] `make test-api-security-sca REGISTRY=local API_PORT=9087 UI_PORT=5287 MAILDEV_UI_PORT=1187 ENV=test-fix-high-vulnerabilities`
    - [x] `make test-api-security-container REGISTRY=local API_VERSION=120dad ENV=test-fix-high-vulnerabilities`
  - Notes:
    - Dependency updates: `officeparser` `6.1.0`, direct `@xmldom/xmldom` `0.9.10`, `vitest` / `@vitest/ui` `4.1.5`.
    - The original Trivy Node package scan kept reporting `@xmldom/xmldom@0.9.9` even after `package-lock.json`, `npm audit`, and the built API image resolved to `0.9.10`. `FIXHIGH-EX1` switches Node dependency scanning to `npm audit` so the gate reflects the actual resolved graph instead of the false-positive package-lock interpretation.

- [ ] **Lot 2 — Final validation**
  - [x] Re-run the full targeted verification chain on the final lockfile.
  - [x] Record impact on active branches that currently fail on this vulnerability (`BR21a`, `BR14f`, and other API-image consumers if any).
  - [ ] Create/update the PR using this file as the source of truth.
  - Impact:
    - `BR21a`: unblocks `build-api-image` and `security-sast-sca` from the API HIGH dependency failure.
    - `BR14f`: same unblock on API HIGH dependency failure; remaining failures are infra/workspace-specific.
