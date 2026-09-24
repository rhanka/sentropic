# Feature: Cluster mesh upstream feedback 0.11.0

## Objective
- [x] Deliver additive F1/F2/F3/F4/F6/F7 and the custody verifier export for h2a.

## Scope / Guardrails
- [x] Worktree `tmp/cm-upstream-feedback`, branch `feat/cluster-mesh-upstream-feedback`, base `75032fc85`.
- [x] Make-only, Docker-first; ENV=test-cm-upstream-feedback last; API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505.
- [x] No push, PR, merge, publish, migrations, or F5 implementation.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/**`
  - `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*`
  - `.github/workflows/**`
  - `api/drizzle/**`
  - All paths outside Allowed Paths.
- [x] **Conditional Paths**: none.
- [x] **Exception process**: stop and record blocked before any forbidden change.

## Feedback Loop
- [x] A1 `attention`: Optional binding availability defaults to available; getters report current bindings and gated bindings reject operations, preserving legacy ports.
- [x] A2 `attention`: Injected NHI takes precedence over the runner; require one source and preserve runner defaults.
- [x] A3 `attention`: Strict expiry is opt-in for legacy compatibility; hosts authenticate canonical bytes. TTL is bounded without adding skew; skew only affects issuance/expiry boundaries. D13 still needs an h2a server challenge; no F5 change.
- [x] A4 `attention`: Device denial is optional on legacy ports and fails closed when absent.
- [x] A5 `attention`: Consumer source missing in h2a checkout; read historical source at `6cf208f7` from local git history instead.
- [x] A6 `attention`: root `lint-cluster-mesh` target + CI wiring deferred to a dedicated Makefile/CI branch (forbidden paths here). The duplicate package recipe is removed; conductor owns the follow-up, accepted when the root target runs in CI.
- [x] A7 `attention`: Use this BRANCH.md for decisions and progress; no out-of-scope spec or Track writes. Independent review is conductor-owned.
- [x] A8 `attention` resolved: Multi-file SCOPE was interpreted as one filter and found no tests; the subsequent full suite passed both files. No test failure or product fix was involved.

## AI Flaky tests
- [x] Not applicable: deterministic package unit tests only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single implementer; no delegated implementation or cherry-picks.

## UAT Management (in orchestration context)
- [x] No UI, Chrome, or VSCode changes; package contract tests are the local acceptance surface.

## Plan / Todo (lot-based)
- [ ] **Lot A — Review fix round 1**
  - [x] R1: Authenticate projection timestamps with canonical bytes; strict expiry/TTL/skew policy and Ed25519 regression tests in `tests/projection.spec.ts`.
  - [x] R2: Remove package lint recipe and published branch-specific commands; record root lint/CI deferral.
  - [ ] R3: Per-kind projection support in port, capabilities and `tests/bindings.spec.ts`.
  - [ ] R4: Public-contract fixtures and runner in `tests/conformance/`; document reuse for EX-12.
  - [ ] R5: Typed NHI argument rejection and negative `tests/nhi.spec.ts` cases.
  - [ ] R6: Injected NHI shape validation, trust documentation and `tests/bindings.spec.ts` cases.
  - [ ] R7: Changelog type widenings, denial feature detection and 0.9 migration guidance.
  - [ ] R8: Replace bare rejection assertions with specific error codes.
  - [ ] Final round-one gate: full package typecheck/tests, scope checks, environment shutdown and commit log.
- [x] **Lot 0 — Baseline**: read rules, template, h2a spec and historical consumer; mechanical branch check passed; published version is 0.10.1.
- [x] **Lot 1 — Bindings**: mesh.ts runtime capabilities and injectable NHI; mesh.spec.ts and bindings.spec.ts compatibility, gated bindings, injection and failure tests; bump package.json to 0.11.0.
- [x] **Lot 2 — Attestation and devices**: nhi.ts optional role/scope and device.ts optional denial; nhi.spec.ts/device.spec.ts positive and negative delegation tests.
- [x] **Lot 3 — Projection and export**: projection.ts expiry and index.ts verifier export; projection.spec.ts expiry boundaries/invalid signatures and custody-export.spec.ts cryptographic positive/negative tests.
- [x] **Lot 4 — Documentation**: README.md SemVer/N-1 and binding contracts; CHANGELOG.md 0.10.0/0.10.1 from history and 0.11.0.
- [x] **Lot 5 — Validation**: package typecheck, lint, 39 files / 249 tests passed; final diff review and scope checks passed; isolated environment stopped.
  - [x] PASS: `make test-cluster-mesh SCOPE=tests/bindings.spec.ts API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-cm-upstream-feedback` (3 tests).
  - [x] FAILED invocation, superseded: `make test-cluster-mesh SCOPE='tests/nhi.spec.ts tests/device.spec.ts' API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-cm-upstream-feedback` (no matching files; A8).
  - [x] PASS: `make typecheck-cluster-mesh test-cluster-mesh API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-cm-upstream-feedback` (249 tests).
  - [x] PASS: `make -f packages/cluster-mesh/lint.mk lint-cluster-mesh API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-cm-upstream-feedback`.
  - [x] PASS before each commit: `make scope-check API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-cm-upstream-feedback`.
  - [x] PASS: `make down API_PORT=9405 UI_PORT=5605 MAILDEV_UI_PORT=1505 ENV=test-cm-upstream-feedback`.
  - [x] Read set: `rules/{MASTER,workflow,subagents,testing}.md`, `plan/BRANCH_TEMPLATE.md`, root README/TODO/PLAN context, package README/changelog and affected source/tests, h2a integration spec sections 7/feedback, historical consumer `6cf208f7`, h2a CLI NHI flags, release implementation commits.
