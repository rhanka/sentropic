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
  - `plan/done/HOTFIX-BRANCH_fix-llm-mesh-standard-routes.md` (`BRCLOSE-EX1`, archive-only)
  - `packages/llm-mesh/**`
  - `packages/llm-gateway/tests/target.test.ts` (`BRPATCH-EX1`, test-only)
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
- `acknowledge`: a read-only GPT-5.6 Sol xhigh minimization review removed global catalog/council fallout and preserved faithful Claude Code routes.
- `decision`: owner explicitly accepted the Cloud Code Opus mapping and authorized fast-track merge without H2A UAT on 2026-08-11.
- `delivery`: candidate `1bed4e52e41db573024498a9d62e36cd14e5bb3b` was deposited for dormant peer `codex:h2a:515c3f177b0b`; merged SHA and published version remain the final follow-up.
- `BRPATCH-EX1`: update the gateway's read-only canonical-route expectation after CI exposed the intentionally removed Flash Lite alias; test-only impact, rollback with the route-table change.
- `BRCLOSE-EX1`: archive this completed plan under the exact `plan/done` path before deleting root `BRANCH.md`; documentation-only impact, rollback by restoring root `BRANCH.md`.

## AI Flaky tests
- PR run `31550107657` first attempt: `api/tests/ai/initiative-generation-async.test.ts` timed out at 120 seconds after an aborted provider request; targeted rerun job `93973279499` passed without code changes.

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
  - [x] Allow H2A to replace the standard target candidates through `RoutePlanInput` without owning a default table.
  - [x] Preserve effort and explicit policy override precedence.
  - [x] Extend focused routing and account inventory tests.
  - [x] Lot gate: focused `routing-targets`, `route-selection`, and local account transport tests.
- [x] **Lot 2 — Final validation and delivery**
  - [x] Complete a minimum-change review; no specification edit is required for this data-only correction.
  - [x] Run `make check-llm-model-equivalences ENV=test-llm-standard-routes`.
  - [x] Run `make typecheck-llm-mesh ENV=test-llm-standard-routes`.
  - [x] Run full `make test-llm-mesh ENV=test-llm-standard-routes` (144 tests).
  - [x] Run `make build-llm-mesh ENV=test-llm-standard-routes` via the pack gate.
  - [x] Run `make pack-llm-mesh ENV=test-llm-standard-routes`.
  - [x] Verify npm registry `0.15.0` and bump `@sentropic/llm-mesh` to `0.15.1`.
  - [x] Run `make scope-check ENV=test-llm-standard-routes` before each commit.
  - [x] Open mini-PR #534 and verify CI, including the targeted AI rerun.
  - [x] Send the exact candidate SHA to H2A; owner waived the dormant peer's local UAT for this fast-track patch.
  - [x] Archive the branch plan, remove `BRANCH.md`, and merge after the closure commit passes CI.
