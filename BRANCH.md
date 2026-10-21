# Feature: fix(security): patch Go stdlib CVE-2026-111943 in API toolbox

## Objective
- [ ] Remove Go 1.26.9 from scanned toolbox binaries using the first patched release, Go 1.26.10, pinned by exact digest.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/fix-go-stdlib-cve`; branch: `fix/go-stdlib-cve-2026-111943`; base: `origin/main` at `50e612a0e`.
- [x] Make-only; `ENV=test-go-cve` last; zero Python; one Docker build at a time.
- [x] No CVE exceptions, allowlist changes, floating pins, merge, or publication.
- [x] No services or host ports needed; containers run without published ports.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `api/Dockerfile`
  - [x] `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `.security/**`
  - [x] `package*.json`
  - [x] `plan/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `.github/workflows/**` (not authorized)
- [x] **Exception process**:
  - [x] No scope exceptions; limit implementation to the vulnerable Go base-image pin.

## Feedback Loop
- [x] Main run `39597025379`, job `119215921954`: four HIGH `CVE-2026-111943_api-tool_stdlib_v1.26.9` findings; #709 EX5 identifies fixes 1.26.10 and 1.27.3.
- [x] Coverage: CI scans API production, API toolbox and UI production; only toolbox copies binaries rebuilt with Go 1.26.9, from `ci-esbuild`.
- [x] Inventory: `/workspace/node_modules/{@esbuild/linux-ARCH/bin/esbuild,esbuild/bin/esbuild}` (0.19.12), and both paths under `@esbuild-kit/core-utils/node_modules` (0.18.20).

## AI Flaky tests
- [x] No flaky-test exemptions; security and toolbox runtime checks are blocking.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one author, isolated branch, sequential builds and validation.

## UAT Management (in orchestration context)
- [x] No user-facing change; qualify both esbuild Node interfaces with the existing runtime gate.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, template, Make targets, CI failure and #709; create worktree; pass `harness check branch`.
  - [x] Inventory Go pins and scanned stages; verify the patched digest in the registry.
- [ ] **Lot 1 — Patch and qualify**
  - [x] Change only the `ci-esbuild` pin to Go 1.26.10.
  - [ ] `make build-api-tool-image REGISTRY=local ENV=test-go-cve`.
  - [ ] `make test-api-tool-security-container REGISTRY=local ENV=test-go-cve`; inspect complete Go package inventory.
  - [ ] `make test-ci-api-tool-runtime REGISTRY=local ENV=test-go-cve`: npm, Vitest, both esbuild transforms and Node protocols.
  - [x] `make test-ci-api-tooling ENV=test-go-cve`: existing `scripts/test-api-tooling.sh`; all registry/cache/hash regressions pass; no new test files.
- [ ] **Lot N — Final validation**
  - [x] `make scope-check ENV=test-go-cve` before every selective-stage, make-only commit; C2 passes.
  - [ ] Push; open draft PR with this file as body; post three-step plan.
  - [ ] Verify CI green on the exact head; leave draft and unmerged.
  - [ ] Report image, old/new digest, PR number and CI URL.
