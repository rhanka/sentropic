# Feature: LLM models gemini-4-carbon and claude-fable-5-2

## Objective
- Add `gemini-4-carbon` and `claude-fable-5-2` to llm-mesh and llm-gateway, mirroring `gemini-4-argon` and `claude-fable-5-1`.
- Map Fable 5.2 requests to Gemini Carbon in the gateway alias map.

## Scope / Guardrails
- Scope limited to model declarations, routing, tests, versions, locks, fixtures.
- No migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/models-carbon-fable52`.
- Automated test campaigns must run on dedicated environments (`ENV=test-models-carbon`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=test-models-carbon` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/src/routing-targets.ts`
  - `packages/llm-mesh/src/generated-model-council.ts`
  - `packages/llm-mesh/src/service/local-account-transport-service.ts`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/llm-gateway/src/native-usage.ts`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-gateway/package.json`
  - `packages/llm-gateway/CHANGELOG.md`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/speech-peer.spec.ts`
  - `api/src/services/llm-runtime/gw-native-qualification-plan.ts`
  - `api/tests/api/models.test.ts`
  - `api/tests/unit/gateway-package-version.test.ts`
  - `api/tests/unit/llm-runtime-stream.test.ts`
  - `scripts/llm-model-equivalences/council.source.json`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single model-addition change, one test cycle, no orthogonal sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Mono-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/models-carbon-fable52`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/worktrees/models-carbon-fable52` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant `.mdc` files and `README.md`.
  - [x] Create/confirm isolated worktree `tmp/worktrees/models-carbon-fable52` and run development there.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Define environment mapping (`dev`, `test`, `e2e`) and ports for this branch.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [x] Record slot owner and exact ports: ENV=test-models-carbon, API_PORT=8939, UI_PORT=5339, MAILDEV_UI_PORT=1239.
- [x] **Lot 1 — Model declarations (mesh)**
  - [x] catalog.ts: `gemini-4-carbon` after `gemini-4-argon`, `claude-fable-5-2` after `claude-fable-5-1`
  - [x] providers.ts: id lists and per-provider lists
  - [x] routing-targets.ts: faithful targets for both models
  - [x] local-account-transport-service.ts: verified Cloud Code list gains carbon
  - [x] council.source.json: exclusions gain both keys, regen via make
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh ENV=test-models-carbon`
    - [ ] **API tests**
      - [ ] Scoped runs while evolving tests: N/A (api runs in CI)
      - [ ] Sub-lot gate: CI green on PR
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI changes
      - [ ] Sub-lot gate: N/A
    - [ ] **E2E tests**
      - [ ] No E2E changes
      - [ ] Sub-lot gate: CI green on PR
- [ ] **Lot 2 — Gateway mapping + serving rows**
  - [ ] MUSE_ROUTE_MODEL: `claude-fable-5-2`, `-high`, `-xhigh` to `gemini-4-carbon`
  - [ ] MUSE_ROUTE_EFFORT + GLM_ROUTE_EFFORT rows for fable-5-2 mirroring fable-5-1
  - [ ] STANDARD_ROUTE_DEFINITIONS fable-5-2 rows with cloud slot `gemini-4-carbon`
  - [ ] native-usage.ts weight + fixtures + gw-native-qualification-plan.ts
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh typecheck-llm-gateway ENV=test-models-carbon`
    - [ ] **API tests**
      - [ ] Sub-lot gate: CI green on PR
- [ ] **Lot 3 — Tests**
  - [ ] Mesh routing/catalog/providers/count assertions updated
  - [ ] Gateway resolution test: fable-5-2 variants resolve to gemini-4-carbon
  - [ ] Selectability tests for both models
  - [ ] Lot gate:
    - [ ] `make test-llm-mesh ENV=test-models-carbon`
    - [ ] `make test-llm-gateway ENV=test-models-carbon`
- [ ] **Lot 4 — Versions, locks, fixtures**
  - [ ] Bump llm-mesh to 0.36.0 and llm-gateway to 0.23.0 with CHANGELOG entries
  - [ ] Admit ranges in gateway and cluster-mesh manifests plus specs
  - [ ] Regenerate root lock via make, council via make, packaging fixtures via make
  - [ ] Lot gate:
    - [ ] `make audit-llm-routing-package-versions ENV=test-models-carbon`
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest mesh and gateway suites
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md` to Package Publication.
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, merge.
