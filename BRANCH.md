# Feature: Muse enrollment (llm-mesh + llm-gateway)

## Objective
- Enroll Meta Muse Code 1.3 (`muse-spark-1.3`) in llm-mesh + llm-gateway, additive only, with integrator-configurable route position (default after Claude).

## Scope / Guardrails
- Scope limited to muse API-key path, muse account-transport path, routing candidates + equivalence council, version bumps.
- One migration max in `api/drizzle/*.sql` (not expected).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/muse-enrollment` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/adapters.ts`
  - `packages/llm-mesh/src/auth.ts`
  - `packages/llm-mesh/src/enrollment/*`
  - `packages/llm-mesh/src/routing-targets.ts`
  - `packages/llm-mesh/src/equivalence-council.ts`
  - `packages/llm-mesh/src/generated-model-council.ts`
  - `packages/llm-mesh/src/service/facade.ts`
  - `packages/llm-mesh/src/service/local-account-transport-service.ts`
  - `packages/llm-mesh/src/transport/muse*`
  - `packages/llm-mesh/tests/*`
  - `packages/llm-gateway/src/router*`
  - `packages/llm-gateway/tests/*`
  - `api/src/services/providers/muse-provider.ts`
  - `api/src/services/provider-registry.ts`
  - `api/src/services/provider-credentials.ts`
  - `api/src/config/env.ts`
  - `api/tests/unit/muse-provider.test.ts`
  - `api/tests/unit/provider-credentials.test.ts`
  - `api/tests/unit/provider-registry-expansion.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-gateway/package.json`
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/llm-mesh/src/transport/codex*`
  - `packages/llm-mesh/src/transport/cloud-code*`
  - `packages/llm-mesh/src/enrollment/claude-code.ts`
  - `packages/llm-mesh/src/enrollment/codex.ts`
  - `packages/llm-mesh/src/enrollment/cloud-code.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `packages/llm-gateway/src/personal-passthrough/pool.ts`
  - `packages/llm-mesh/src/catalog.ts` (`gemini-3.8-flash` addition)
- **Exception process**:
  - Declare exception ID `BR75-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `attention` BR75-Q1 (contributor vs non-contributor): owner said contributor remisé for gateway; brief said non-contributor default for privacy; needs explicit default decision before Lot 1.
- `attention` BR75-Q2 (gemini-3.8/astra source-gap): absent from mesh/gateway/api code; PR oubliée suspected; needs confirm add-alongside-3.7 vs replace before Lot 3.
- `attention` BR75-Q3 (MUSE_API_KEY CI secret): wiring by name only, no value in repo or env; owner action required before Lot 4.
- `acknowledge` BR75-N1: worktree based on `origin/main` `bbcb97e98` (local `main` was behind at `cb618e190`; worktree reset to `origin/main`).
- `acknowledge` BR75-N2: resuming Claude session `21fe3355-ad7d-4071-a387-d54f58576693` (cwd sentropic, ended 2026-09-20 00:32 UTC on 529 + weekly limit).

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
- Rationale: single provider enrollment with additive routing change; one test cycle suffices.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/muse-enrollment`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/muse-enrollment` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `README.md`, `TODO.md`.
  - [ ] Read `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` and `.tmp/engage/muse-enrollment-brief.md`.
  - [ ] Confirm isolated worktree `tmp/muse-enrollment` on branch `feat/muse-enrollment` at `bbcb97e98`.
  - [ ] Capture Makefile targets needed for debug/testing.
  - [ ] Define environment mapping and ports for this branch.
    - [ ] `ENV=test-feat-muse-enrollment`, slot 0, `API_PORT=9375`, `UI_PORT=5575`, `MAILDEV_UI_PORT=1475`.
    - [ ] `ENV=e2e-feat-muse-enrollment` only if gateway behavior change requires E2E.
  - [ ] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [ ] Confirm scope and guardrails.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BR75-EXn` exceptions if needed.
  - [ ] Resolve BR75-Q1, BR75-Q2, BR75-Q3 or defer with owner/date.

- [ ] **Lot 1 — API-key path (Chapitre A)**
  - [ ] Add muse provider surface in `packages/llm-mesh/src/providers.ts` + `catalog.ts` (`muse-spark-1.3`, contributor variant per BR75-Q1).
  - [ ] Add `MuseAdapter` in `packages/llm-mesh/src/adapters.ts` + default adapters.
  - [ ] Add `api/src/services/providers/muse-provider.ts`, register in `provider-registry.ts`.
  - [ ] Wire `MUSE_API_KEY` in `provider-credentials.ts` + `api/src/config/env.ts` (fallback `MODEL_API_KEY` only if owner confirms).
  - [ ] UAT: `muse exec` headless smoke against configured base URL; API-key wiring by name only, no secret value in repo.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api` ENV=test-feat-muse-enrollment
    - [ ] **API tests**
      - [ ] Add `api/tests/unit/muse-provider.test.ts` (pattern: `api/tests/unit/claude-provider.test.ts`).
      - [ ] Update `api/tests/unit/provider-credentials.test.ts`.
      - [ ] Update `api/tests/unit/provider-registry-expansion.test.ts`.
      - [ ] Sub-lot gate: scoped mesh/api runs then `make test-api ENV=test-feat-muse-enrollment`
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI change expected; record `none`.
    - [ ] **E2E tests**
      - [ ] No E2E change expected; record `none`.

- [ ] **Lot 2 — Account transport path (Chapitre B)**
  - [ ] Add `muse` to `accountTransportProviderIds` + executable list in `packages/llm-mesh/src/auth.ts`.
  - [ ] Extend `packages/llm-mesh/src/enrollment/contracts.ts` provider union + add `enrollment/muse.ts` (import `~/.config/muse/auth.json` `meta.*`, no browser OAuth).
  - [ ] Register muse enrollment in `packages/llm-mesh/src/service/facade.ts`; add completion branch in `local-account-transport-service.ts`.
  - [ ] Keyring: verify generic envelope path needs no change; gateway pool: verify no change (ownerUserId + kill-switch already generic).
  - [ ] UAT: import personal muse account file-shape only (keys, no values); pooled `ownerUserId`-scoped check.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api` ENV=test-feat-muse-enrollment
    - [ ] **API tests**
      - [ ] Add `packages/llm-mesh/tests/enrollment/muse.test.ts` (pattern: `codex.test.ts`).
      - [ ] Update `packages/llm-mesh/tests/auth.test.ts`.
      - [ ] Update `packages/llm-mesh/tests/service/local-account-transport-service.test.ts`.
      - [ ] Update `packages/llm-mesh/tests/service/facade.test.ts` or `packages/llm-mesh/tests/facade.test.ts`.
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-muse-enrollment`
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI change expected; record `none`.
    - [ ] **E2E tests**
      - [ ] No E2E change expected; record `none`.

- [ ] **Lot 3 — Routing candidates + council**
  - [ ] Add `muse-spark-1.3` target + `fable-5.1` id + `musePosition` config (`off | after-claude | first`, default `after-claude`) in `routing-targets.ts`.
  - [ ] Set efforts: `sonnet5`/`sonnet-5.1` → `max`; `opus high`/`xhigh` → `xhigh`; keep Claude faithful first when account exists, then muse, then existing codex/cloud-code.
  - [ ] Regenerate equivalence council via `make llm-mesh-add-model` (`generated-model-council.ts`, `equivalence-council.ts`).
  - [ ] Handle `gemini-3.8-flash` per BR75-Q2 (`BR75-EXn` if catalog touched).
  - [ ] UAT: route-order check (Claude-first-if-account, then muse, then existing); no auto-fallback beyond account switch on muse credit exhaustion.
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api` ENV=test-feat-muse-enrollment
    - [ ] **API tests**
      - [ ] Update `packages/llm-mesh/tests/routing-targets.test.ts`.
      - [ ] Update `packages/llm-mesh/tests/route-selection.test.ts`.
      - [ ] Update `packages/llm-mesh/tests/equivalence-council.test.ts`.
      - [ ] Update `packages/llm-gateway/tests/target.test.ts`.
      - [ ] Update `packages/llm-gateway/tests/router.test.ts`.
      - [ ] Sub-lot gate: `make test-api ENV=test-feat-muse-enrollment`
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI change expected; record `none`.
    - [ ] **E2E tests**
      - [ ] Run only if gateway route behavior changed; otherwise record `none` with reason.

- [ ] **Lot 4 — Versions + publication gates**
  - [ ] Bump `packages/llm-mesh/package.json` semver for `src/**` change.
  - [ ] Bump `packages/llm-gateway/package.json` semver + `llm-mesh` dep.
  - [ ] Verify `check-llm-model-equivalences` gate passes; no direct `npm publish`.
  - [ ] Record owner CI secret action for `MUSE_API_KEY` (BR75-Q3).

- [ ] **Lot N-2** UAT
  - [ ] Web app (no UI change; record `none` with reason)
  - [ ] API/gateway headless checks
    - [ ] `muse exec` smoke via gateway route with `MUSE_API_KEY` name wiring.
    - [ ] Account-import check from `auth.json` shape (keys only).
    - [ ] Route-order check: Claude-first-if-account, then muse, then codex/cloud-code.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` with muse enrollment + `musePosition` contract.
  - [ ] Delete any branch-local spec draft after integration (if created).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
