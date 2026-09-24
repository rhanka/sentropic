# Feature: Cluster mesh upstream feedback 0.11.0

## Objective
- [ ] Deliver additive F1/F2/F3/F4/F6/F7 and the custody verifier export for h2a.

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
- [x] A3 `attention`: Projection expiry uses optional Unix milliseconds, checked after verification; verifiers must authenticate expiry with the signed payload; no replay registry or F5 change.
- [x] A4 `attention`: Device denial is optional on legacy ports and fails closed when absent.
- [x] A5 `attention`: Consumer source missing in h2a checkout; read historical source at `6cf208f7` from local git history instead.
- [x] A6 `attention`: No root cluster-mesh lint target exists; add a package-local Docker lint Makefile within allowed scope.
- [x] A7 `attention`: Use this BRANCH.md for decisions and progress; no out-of-scope spec or Track writes. Independent review is conductor-owned.

## AI Flaky tests
- [x] Not applicable: deterministic package unit tests only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single implementer; no delegated implementation or cherry-picks.

## UAT Management (in orchestration context)
- [x] No UI, Chrome, or VSCode changes; package contract tests are the local acceptance surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read rules, template, h2a spec and historical consumer; mechanical branch check passed; published version is 0.10.1.
- [x] **Lot 1 — Bindings**: mesh.ts runtime capabilities and injectable NHI; mesh.spec.ts and bindings.spec.ts compatibility, gated bindings, injection and failure tests; bump package.json to 0.11.0.
- [ ] **Lot 2 — Attestation and devices**: nhi.ts optional role/scope and device.ts optional denial; nhi.spec.ts/device.spec.ts positive and negative delegation tests.
- [ ] **Lot 3 — Projection and export**: projection.ts expiry and index.ts verifier export; projection.spec.ts expiry boundaries/invalid signatures and custody-export.spec.ts cryptographic positive/negative tests.
- [ ] **Lot 4 — Documentation**: README.md SemVer/N-1 and binding contracts; CHANGELOG.md 0.10.0/0.10.1 from history and 0.11.0.
- [ ] **Lot 5 — Validation**: package typecheck, lint, full tests, final diff review, scope-check, environment cleanup and committed handoff.
