# Feature: llm-gateway L1.5 — global protected identification egress invariant

## Objective
Enforce the default-ON global Protected Identification Set (`P`) ingress-to-egress invariant across `@sentropic/llm-gateway` routed, native, and legacy flows with zero config or port bypass, plus P3 follow-ups `r8-F1` and `r8-F2`.

## Scope / Guardrails
- Scope limited to Sub-Lot `L1.5` of `spec/SPEC_EVOL_LLM_GW_RELAY_CHAIN.md` (r8) and companion `@sentropic/llm-gateway` minor version bump (`BR-GWRC-EX3` precedent).
- Make-only workflow, no direct npm/node/docker on host, `ENV=test-gw-l15` always last, ports `API_PORT=9198 UI_PORT=5398 MAILDEV_UI_PORT=1298`.
- Branch work in isolated worktree `tmp/gw-relay-l15` on `feat/gw-relay-l15`.
- All new text, code, tests, commits, and PR in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-gateway/src/guards/**`
  - `packages/llm-gateway/src/ports/**`
  - `packages/llm-gateway/src/router/**`
  - `packages/llm-gateway/src/route-flow-core.ts`
  - `packages/llm-gateway/src/route-json-flow.ts`
  - `packages/llm-gateway/src/route-stream-flow.ts`
  - `packages/llm-gateway/src/route-native.ts`
  - `packages/llm-gateway/src/flow.ts`
  - `packages/llm-gateway/src/index.ts`
  - `packages/llm-gateway/src/session-service.ts`
  - `packages/llm-gateway/src/node/gateway-host.ts`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-gateway/package.json`
  - `packages/llm-gateway/CHANGELOG.md`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `api/tests/unit/gateway-package-version.test.ts`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/llm-gateway/src/native-headers.ts`
  - `packages/llm-mesh/**`
  - `packages/cluster-mesh/src/**`
  - `api/src/**`
  - `apps/**`
  - `deploy/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - `BR-GWRC-EX3` (version-bump companions precedent from #1053): covers `packages/llm-gateway/{package.json,CHANGELOG.md}`, `packages/cluster-mesh/tests/fixtures/train.ts`, `packages/cluster-mesh/tests/packaging/fixtures/selected/{package.json,package-lock.json}`, `api/tests/unit/gateway-package-version.test.ts`, and root `package-lock.json` for `@sentropic/llm-gateway` minor bump `0.24.0 -> 0.25.0` required by CI `enforce-package-bump`.

## Feedback Loop
- `acknowledge`: `BR-GWRC-EX3` precedent applied for `@sentropic/llm-gateway` minor bump `0.24.0 -> 0.25.0` (rationale: CI `enforce-package-bump` blocks merge when `packages/llm-gateway/src/**` changes without a semver bump; impact: version pin metadata and lockfiles only, zero new third-party dependencies, `@sentropic/cluster-mesh` peer range `>=0.19.0 <0.28.0` already admits `0.25.0`; rollback: revert bump commit).

## AI Flaky tests
- None expected; `apps/artifact-content/tests/data-plane-relay.test.ts` is unrelated and may be rerun once in CI if transient.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: Single cohesive sub-lot `L1.5` in `@sentropic/llm-gateway` with single PR.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`, spec r8, and r8 review.
  - [x] Create isolated worktree `tmp/gw-relay-l15` on `feat/gw-relay-l15` from `origin/main` (`e7270e0d9`).
  - [x] Confirm Make targets, ports (`API_PORT=9198 UI_PORT=5398 MAILDEV_UI_PORT=1298`), and `ENV=test-gw-l15`.

- [x] **Lot 1 — L1.5 Global Protected Identification Invariant (`P`)**
  - [x] Write Red tests in `packages/llm-gateway/tests/protected-identification-egress.test.ts`.
  - [x] Implement `packages/llm-gateway/src/guards/protected-identification.ts`, `errors.ts` (`protected-identification-mutated`), `ports/gateway-state.ts` (`integrity` union), and `index.ts` export.
  - [x] Enforce `P`-aware `mask_in_flight` refusal in `packages/llm-gateway/src/guards/guard-engine.ts` and update `tests/guard-engine.test.ts` + `tests/contract-snapshot.test.ts`.
  - [x] Wire ingress capture, pre-`markDurableAttempt`/`markRouteDispatched` egress check, `r8-F1` catch short-circuit, `r8-F2` uniform `Connection:` rejection, and refusal audit receipt persistence in `route-flow-core.ts`, `route-json-flow.ts`, `route-stream-flow.ts`, `router/index.ts`, `session-service.ts`, and `node/gateway-host.ts`.
  - [x] Wire ingress capture, egress check, and refusal audit sink in `flow.ts`.
  - [x] Complete 3-wire x multi-source negative tests, compliant byte-identity tests, `count_tokens` passthrough, and `startGatewayHost` receipt tests.

- [ ] **Lot 2 — Version bump (`BR-GWRC-EX3`) & Final validation**
  - [ ] Verify published npm version and bump `@sentropic/llm-gateway` to `0.25.0` with CHANGELOG entry and regenerated fixtures (`make lock-root`, `make pack-candidate-siblings`, `refresh-lazy-package-lock`).
  - [ ] Run full `make test-llm-gateway`, `make typecheck-llm-gateway`, `make lint-llm-gateway`, `make pack-llm-gateway`, `make test-cluster-mesh`, `make typecheck-cluster-mesh`, `make test-api-unit SCOPE=gateway-package-version`, and `make scope-check`.
  - [ ] Drop `BRANCH.md` before final push, open PR, wait for CI green, and clean up `ENV=test-gw-l15` (`make down-volumes`, `make down`, `make clean`).
