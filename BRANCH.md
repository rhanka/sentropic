# Feature: llm-gateway L1.3c — vendored agent-stats scanner core

## Objective
Implement Sub-Lot L1.3c of `spec/SPEC_EVOL_LLM_GW_RELAY_CHAIN.md` (r8): pure-TypeScript vendored `agent-stats` secret scanner core (`SecretScannerPort`, `KUBECONFIG_PATTERNS`, structured `CustomSecretPattern[]` / `scanCustom`, disjoint-interval `dedupeRanges` fix, `<<SECRET:<safeRuleId>:<sha256_16hex>>>` tags) wired into `GuardEngine` with zero new dependencies.

## Scope / Guardrails
- Scope limited to `@sentropic/llm-gateway` guards/ports/exports/tests and `BR-GWRC-EX3` version bump companions (`0.25.0` -> `0.26.0`).
- Zero new third-party dependencies (`@secretlint/*` and `js-yaml` belong to L1.3d).
- Make-only workflow, no direct npm/node/docker on host, `ENV=test-gw-l13c` always last.
- Ports: `API_PORT=9198 UI_PORT=5398 MAILDEV_UI_PORT=1298 ENV=test-gw-l13c`.
- Atomic commits under 150 lines via `make commit MSG="..."`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/src/guards/**`
  - `packages/llm-gateway/src/ports/**`
  - `packages/llm-gateway/src/index.ts`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-gateway/package.json`
  - `packages/llm-gateway/CHANGELOG.md`
  - `api/tests/unit/gateway-package-version.test.ts`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `deploy/**`
  - `packages/llm-mesh/**`
  - `packages/cluster-mesh/src/**`
  - `api/src/**`
  - `apps/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json` (`BR-GWRC-EX3`)
  - `api/tests/unit/gateway-package-version.test.ts` (`BR-GWRC-EX3`)
  - `packages/cluster-mesh/tests/fixtures/train.ts` (`BR-GWRC-EX3`)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (`BR-GWRC-EX3`)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (`BR-GWRC-EX3`)
- **Exception process**:
  - `BR-GWRC-EX3` (precedent from PR #1053 and PR #1056): CI `enforce-package-bump` requires bumping `@sentropic/llm-gateway` (`0.25.0` -> `0.26.0`) whenever `packages/llm-gateway/src/**` changes, which requires updating root `package-lock.json`, `api/tests/unit/gateway-package-version.test.ts`, `packages/cluster-mesh/tests/fixtures/train.ts`, and `packages/cluster-mesh/tests/packaging/fixtures/selected/{package.json,package-lock.json}` in lockstep via make targets. Impact: version/integrity metadata alignment only, zero added dependencies. Rollback: revert the bump commit.

## Feedback Loop
- `acknowledge` (`BR-GWRC-EX3`): Version bump companion files aligned with `#1053` and `#1056` precedent (`>=0.19.0 <0.28.0` range already admits `0.26.0`).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single sub-lot L1.3c, single PR)
- [ ] **Multi-branch**
- Rationale: Sub-lot L1.3c is a self-contained pure-TS change in `@sentropic/llm-gateway`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, spec r8 L1.3c, and Carbon P1-4 review.
  - [x] Create worktree `tmp/gw-relay-l13c` on `feat/gw-relay-l13c` from `origin/main` (`13490b16b`).
  - [x] Declare `BRANCH.md` scope boundaries and `BR-GWRC-EX3`.
- [x] **Lot 1 — Pure-TS vendored scanner core (L1.3c)**
  - [x] Write failing test `packages/llm-gateway/tests/secret-scanner.test.ts` (Red).
  - [x] Implement `SecretMatch`, `CustomSecretPattern`, `SecretScanOptions`, `SecretScannerPort` in `packages/llm-gateway/src/ports/guards.ts`.
  - [x] Implement `KUBECONFIG_PATTERNS`, `scanCustom`, disjoint `dedupeRanges`, `formatSecretRedactionTag`, `redactSecretMatches`, `scanSecrets`, `PureSecretScanner` in `packages/llm-gateway/src/guards/secret-scanner.ts` and export from `src/index.ts`.
  - [x] Wire `SecretScannerPort` and structured `customPatterns` into `packages/llm-gateway/src/guards/guard-engine.ts`.
  - [x] Verify Green: scoped tests, full `llm-gateway` test suite, typecheck, lint, scope-check.
- [x] **Lot 2 — Package version bump (`0.25.0` -> `0.26.0`) & CI**
  - [x] Bump `@sentropic/llm-gateway` to `0.26.0`, add `CHANGELOG.md` entry, regenerate consumer fixtures via make targets (`BR-GWRC-EX3`).
  - [x] Verify pack, cluster-mesh, api-unit gateway-package-version, scope-check.
  - [ ] Drop `BRANCH.md`, clean test stack (`make down-volumes`, `make down`, `make clean`), push and open PR, wait for CI green.
