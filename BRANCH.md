# Fix: Transport-aware standard model routes

## Objective
Provide owner-ratified default Codex and Cloud Code targets for Claude launch models in `@sentropic/llm-mesh`, while keeping target mappings configurable by consumers.

## Scope / Guardrails
- Patch-only change in `llm-mesh`; no `llm-gateway` or H2A implementation changes.
- Preserve requested effort and existing explicit user policy overrides.
- Make-only validation in the isolated `tmp/fix-llm-mesh-standard-routes` worktree.
- Tests run with `ENV=test-llm-standard-routes` last when the target accepts an environment.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/**`
  - `scripts/llm-model-equivalences/**`
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/llm-gateway/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None.
- **Exception process**:
  - Declare an exception in `## Feedback Loop` before touching any forbidden path.

## Feedback Loop
- `attention`: H2A integration #215 is blocked until this package exposes the standard routes; candidate SHA must be sent before merge.

## AI Flaky tests
- No AI or live-provider test is part of this patch. Any nondeterministic failure remains blocking unless explicitly accepted by the owner.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one focused package patch with one downstream local integration checkpoint.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read repository, workflow, testing, H2A, and harness rules.
  - [x] Create the isolated worktree and pass `harness check branch`.
  - [x] Record Track item `01KZSK7XKFRKS8R406K4WSBT1K`.
- [x] **Lot 1 — Standard transport routes**
  - [x] Add Codex and Cloud Code standard targets for Opus, Sonnet, and Fable launch models.
  - [x] Keep consumer selection configurable through existing route policy overrides.
  - [x] Preserve effort and explicit policy override precedence.
  - [x] Extend focused routing and account inventory tests.
  - [x] Lot gate: focused `routing-targets`, `route-selection`, and local account transport tests.
- [ ] **Lot 2 — Final validation and delivery**
  - [x] Complete a minimum-change review; no specification edit is required for this data-only correction.
  - [x] Run `make check-llm-model-equivalences ENV=test-llm-standard-routes`.
  - [x] Run `make typecheck-llm-mesh ENV=test-llm-standard-routes`.
  - [x] Run full `make test-llm-mesh ENV=test-llm-standard-routes` (142 tests).
  - [x] Run `make build-llm-mesh ENV=test-llm-standard-routes` via the pack gate.
  - [x] Run `make pack-llm-mesh ENV=test-llm-standard-routes`.
  - [x] Verify npm registry `0.15.0` and bump `@sentropic/llm-mesh` to `0.15.1`.
  - [x] Run `make scope-check ENV=test-llm-standard-routes` before each commit.
  - [ ] Open a mini-PR and verify CI.
  - [ ] Send the exact candidate SHA to H2A for local integration UAT before merge.
  - [ ] After CI and UAT pass, archive the branch plan, remove `BRANCH.md`, and merge.
