# Feature: Gemini 4 Carbon Effort Target Resolution in @sentropic/llm-mesh

## Objective
- [x] Complete Gemini 4 Carbon (`gemini-4-carbon`) Cloud Code routing in `@sentropic/llm-mesh` (`0.38.1`) so `gemini-4-carbon` and `gemini-4-carbon-low|medium|high` resolve on `gemini`/`cloud-code` with reasoning effort and `x-sentropic-served` carries `model=gemini-4-carbon`, without changing any serving-table default.

## Scope / Guardrails
- [x] Scope limited to `@sentropic/llm-mesh` Cloud Code effort target resolution, tests, changelog, version bump `0.38.1`, and declared lockfile/test-tuple pins.
- [x] Make-only workflow via `.tmp/packets/docker-slot.sh`, no direct Docker/npm/node commands.
- [x] Isolated worktree `tmp/worktrees/llm-mesh-carbon` on branch `feat/llm-mesh-gemini-4-carbon` from `origin/main` (`913e3bcbc`).
- [x] Dedicated test environment `ENV=test-llm-mesh-carbon` (last argument in every `make` command) with `API_PORT=9178`, `UI_PORT=5378`, `MAILDEV_UI_PORT=1278`; never `ENV=dev`, never `make clean-all`.
- [x] No serving-table default reassignment (`MUSE_ROUTE_MODEL`, `MUSE_ROUTE_EFFORT`, `GLM_ROUTE_EFFORT`, and `STANDARD_ROUTE_DEFINITIONS` stay unchanged).
- [x] All repository text in English; no merge (`main` frozen until T3 closes).

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `packages/llm-mesh/**`
  - [x] `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.github/workflows/**`
  - [x] `.cursor/rules/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `package-lock.json` (`BR40-EX1`)
  - [x] `packages/cluster-mesh/tests/fixtures/train.ts` (`BR40-EX2`)
  - [x] `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (`BR40-EX2`)
  - [x] `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (`BR40-EX2`)
  - [x] `packages/llm-gateway/tests/target.test.ts` (`BR40-EX3`)
- [x] **Exception process**:
  - [x] Declare `BR40-EX1`, `BR40-EX2`, and `BR40-EX3` in `## Feedback Loop` with reason, impact, and rollback before touching conditional paths.

## Feedback Loop
- [x] `acknowledge`: Baseline inspection on `origin/main` (`913e3bcbc`) confirms `c8146a504` already registered bare `gemini-4-carbon` in `catalog.ts`, `providers.ts`, `generated-model-council.ts`, `local-account-transport-service.ts`, and `DEFAULT_TARGET_MAPPINGS`, while `gemini-4-carbon-low|medium|high` canonical effort routing targets were absent; serving-table defaults require no change.
- [x] `acknowledge` (`BR40-EX1`): Touch `package-lock.json` (`packages/llm-mesh` workspace version `0.38.0` -> `0.38.1`). Reason: CI `changes` train lock-sync requires root lockfile workspace version parity with `packages/llm-mesh/package.json`. Impact: single version literal sync, no dependency graph change. Rollback: revert Lot 2 release commit.
- [x] `acknowledge` (`BR40-EX2`): Touch `packages/cluster-mesh/tests/fixtures/train.ts` and `packages/cluster-mesh/tests/packaging/fixtures/selected/{package.json,package-lock.json}` (`0.38.0` -> `0.38.1`). Reason: CI `validate-cluster-mesh` asserts workspace `installedVersion === TRAIN_LLM_MESH_VERSION` and packed sibling receipt integrity; runtime `<0.39.0` and gateway `^0.38.0` ranges already admit `0.38.1`. Impact: test/fixture tuple pins only, no `cluster-mesh` runtime change or version bump. Rollback: revert Lot 2 release commit.
- [x] `acknowledge` (`BR40-EX3`): Touch `packages/llm-gateway/tests/target.test.ts`. Reason: verify `createGatewayRouter` HTTP `x-sentropic-served` header (`provider=gemini; model=gemini-4-carbon; transport=cloud-code`) for `gemini-4-carbon` and `gemini-4-carbon-low|medium|high`. Impact: test-only coverage in `packages/llm-gateway/tests/`, no `packages/llm-gateway/src/**` edit or gateway version bump. Rollback: revert test hunk.

## AI Flaky tests
- [x] Accept only non-systematic provider/network/model nondeterminism with at least one pass on the same commit and command; never add timeouts; record any signature here if encountered.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single isolated worktree `tmp/worktrees/llm-mesh-carbon` for cohesive mesh target/version update)
- [ ] **Multi-branch**

## UAT Management (in orchestration context)
- [x] Library-only routing and test scope (no UI changes); conductor merges after T3 freeze lifts once PR CI is green on exact HEAD.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, and `.tmp/packets/COMMON-RULES.md`.
  - [x] Create and verify worktree `tmp/worktrees/llm-mesh-carbon` on `feat/llm-mesh-gemini-4-carbon` (`harness check branch` PASS).
  - [x] Audit npm registry versions (`@sentropic/llm-mesh` local=`0.38.0`, registry=`0.38.0`; `@sentropic/llm-gateway` local=`0.23.2`, registry=`0.23.2`).
  - [x] Configure `ENV=test-llm-mesh-carbon` with `API_PORT=9178`, `UI_PORT=5378`, `MAILDEV_UI_PORT=1278` and declare `BR40-EX1..EX3`.

- [ ] **Lot 1 — TDD effort target resolution & x-sentropic-served verification**
  - [ ] Write failing tests first (RED) in `packages/llm-mesh/tests/routing-targets.test.ts`, `packages/llm-mesh/tests/service/local-account-transport-service.test.ts`, and `packages/llm-gateway/tests/target.test.ts` (`gemini-4-carbon` and `gemini-4-carbon-low|medium|high` on `gemini`/`cloud-code` with reasoning effort and `x-sentropic-served` served model id).
  - [ ] Add `gemini-4-carbon-low`, `gemini-4-carbon-medium`, and `gemini-4-carbon-high` targets to `DEFAULT_TARGET_MAPPINGS` in `packages/llm-mesh/src/routing-targets.ts` without modifying serving-table defaults.
  - [ ] Verify council generation stays clean via `make check-llm-model-equivalences API_PORT=9178 UI_PORT=5378 MAILDEV_UI_PORT=1278 ENV=test-llm-mesh-carbon`.
  - [ ] Lot gate: `make typecheck-llm-mesh`, `make lint-llm-mesh`, `make test-llm-mesh`, and `make test-llm-gateway` green on `ENV=test-llm-mesh-carbon`.

- [ ] **Lot 2 — Package version bump (0.38.1), changelog & companion tuple pins**
  - [ ] Bump `packages/llm-mesh/package.json` to `0.38.1`, update `packages/llm-mesh/tests/decision-public-surface.test.ts`, and add `## 0.38.1` entry in `packages/llm-mesh/CHANGELOG.md`.
  - [ ] Sync `package-lock.json` (`BR40-EX1`) and refresh `packages/cluster-mesh/tests/fixtures/train.ts` + `packages/cluster-mesh/tests/packaging/fixtures/selected/{package.json,package-lock.json}` (`BR40-EX2`) via `pack-candidate-siblings` and `refresh-lazy-package-lock`.
  - [ ] Lot gate: `make test-llm-mesh`, `make test-llm-gateway`, `make cluster-mesh-workspace CM_ACTION=mesh-check`, and `make pack-publishable-manifest PACKAGE=llm-mesh` green on `ENV=test-llm-mesh-carbon`.

- [ ] **Lot N — Final validation & PR qualification (no merge)**
  - [ ] Verify `make scope-check` passes before every atomic commit (< 150 lines, no trailers).
  - [ ] Push `feat/llm-mesh-gemini-4-carbon` and open PR against `main` using `BRANCH.md` as PR body.
  - [ ] Wait for all GitHub Actions CI checks to complete green on the exact PR HEAD SHA (do not merge; keep `BRANCH.md` on PR branch for conductor merge).
  - [ ] Tear down isolated volumes (`make down-volumes ... ENV=test-llm-mesh-carbon`) and write `.tmp/rv/llm-mesh-carbon.md` + `.tmp/rv/llm-mesh-carbon.done`.
