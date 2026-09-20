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
  - `BRANCH.md`
  - `scripts/llm-model-equivalences/*`
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
  - `packages/llm-mesh/tests/**`
  - `packages/llm-gateway/src/router*`
  - `packages/llm-gateway/tests/*`
  - `api/src/services/providers/muse-provider.ts`
  - `api/src/services/provider-registry.ts`
  - `api/src/services/provider-credentials.ts`
  - `api/src/config/env.ts`
  - `api/tests/unit/muse-provider.test.ts`
  - `api/tests/unit/provider-credentials.test.ts`
  - `api/tests/unit/provider-registry-expansion.test.ts`
  - `api/tests/unit/provider-mesh-contract-proof.test.ts`
  - `api/src/services/llm-account-transports.ts` (BR75-EX2)
  - `api/src/services/provider-connections.ts` (BR75-EX2)
  - `api/src/routes/namespaces/llm-mesh-enrollment.ts` (BR75-EX2)
  - `api/src/routes/namespaces/llm-mesh-enrollment-intent.ts` (BR75-EX2)
  - `api/tests/unit/llm-account-transports.test.ts` (BR75-EX2)
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
- `attention` BR75-Q1 (env key): root `.env` holds `MODEL_API_KEY`; CI secret will be named `MUSE_API_KEY`; code reads `MUSE_API_KEY` with fallback `MODEL_API_KEY`.
- `attention` BR75-Q2 (gemini-3.8/astra source-gap): absent from mesh/gateway/api code; PR oubliée suspected; needs confirm add-alongside-3.7 vs replace before Lot 3.
- `acknowledge` BR75-Q3 (tier): tier is an option, default `contributor` (remisé); both Chapitre A (API key) and Chapitre B (siège account) ship in this same branch; enrollment paths must be covered by tests.
- `attention` BR75-Q4 (MUSE_API_KEY CI secret): wiring by name only, no value in repo or env; owner action required before Lot 4.
- `acknowledge` BR75-N1: worktree based on `origin/main` `bbcb97e98` (local `main` was behind at `cb618e190`; worktree reset to `origin/main`).
- `acknowledge` BR75-N2: resuming Claude session `21fe3355-ad7d-4071-a387-d54f58576693` (cwd sentropic, ended 2026-09-20 00:32 UTC on 529 + weekly limit).
- `acknowledge` BR75-D1 (owner 2026-09-20): opus `*-max` aliases get muse candidate at effort `max`; opus base codex side unchanged (`sol`/`terra`).
- `acknowledge` BR75-D2 (owner 2026-09-20): proceed autonomously lot by lot until done (implementation loop).
- `acknowledge` BR75-D3 (2026-09-20): shared objective loop `loop-mu94uk70` (`muse-enrollment`); joined as `sentropic-muse`; h2a-side Muse invited via peer channel with join instructions.
- `acknowledge` BR75-F1 (pre-existing, out of scope): `packages/llm-gateway/tests/codex.test.ts` > max_output_tokens stripping fails identically on pristine `origin/main` (repro detached worktree, since removed); `prepareCodexResponsesRequest` is a pure spread, untouched by this branch. Left red, not loosened.
- `acknowledge` BR75-D4 (2026-09-20): h2a-muse Q&A answered (A1 Lot 4 = package semver bumps + equivalences gate, no direct publish; A2 gate-lift signal = reported gateway version at Lot 4; A3 unit-level results only — order/efforts/3.8-high green in mesh+gateway unit tests, NO live probe run yet; live pooled proof delegated to h2a-muse with verdict on the loop).
- `acknowledge` BR75-D5 (2026-09-20): wording discipline — unit green is reported as unit green; "probe/tested" is reserved for live runs (real enrollment, serving gateway).
- `attention` BR75-EX2 (DB + HTTP enrollment surface for muse): reason — Chapitre B is unreachable remotely (404) without the same seams codex uses (DB lease store + refresh-if-needed + provider-connections + intent schemas + route cases); impact — additive muse cases only, no existing provider touched; rollback — delete the muse cases. Paths: `api/src/services/llm-account-transports.ts`, `api/src/services/provider-connections.ts`, `api/src/routes/namespaces/llm-mesh-enrollment.ts`, `api/src/routes/namespaces/llm-mesh-enrollment-intent.ts`, `api/tests/unit/llm-account-transports.test.ts`. (Unrelated to the pre-existing Makefile `BR75-EX1` string.)

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
  - [ ] Resolve BR75-Q1, BR75-Q2, BR75-Q4 or defer with owner/date (BR75-Q3 decided: tier option, default contributor).

- [x] **Lot 1 — API-key path (Chapitre A)**
  - [x] Add muse provider surface in `packages/llm-mesh/src/providers.ts` + `catalog.ts` (`muse-spark-1.3` + `muse-spark-1.3-contributor`; tier exposed as option, default contributor per BR75-Q3).
  - [x] Add `MuseAdapter` in `packages/llm-mesh/src/adapters.ts` + default adapters.
  - [x] Add `api/src/services/providers/muse-provider.ts`, register in `provider-registry.ts` (runtime `listModels()` returns `[]` until a dispatch path exists — advertising unservable models would route traffic into a throw and force speculative stream fixtures; flips in Lot 2 with real wire evidence).
  - [x] Wire `MUSE_API_KEY` (CI) with fallback `MODEL_API_KEY` (root `.env`) in `provider-credentials.ts` + `api/src/config/env.ts`.
  - [x] Classify new models in equivalence council (excluded, no benchmark evidence) via `make refresh-llm-model-equivalences`.
  - [x] Evolve `gcp.test.ts` counts 7→8 (provider addition, evolution not regression).
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

- [x] **Lot 2 — Account transport path (Chapitre B)**
  - [x] Write the muse tests FIRST (TDD, mirrored on cloud-code): `packages/llm-mesh/tests/enrollment/muse.test.ts` mirrors `enrollment/cloud-code.test.ts` (start session shape, complete maps `meta.*` to `PreparedCredential`, secret redaction in errors like the `[redacted]` case, cancel path).
  - [x] Add `muse` to `accountTransportProviderIds` + executable list in `packages/llm-mesh/src/auth.ts`.
  - [x] Extend `packages/llm-mesh/src/enrollment/contracts.ts` provider union + `local-import` session kind + add `enrollment/muse.ts` (import `~/.config/muse/auth.json` `meta.*`, no browser OAuth; stable account id per login; refresh re-reads CLI store).
  - [x] Register muse enrollment in `packages/llm-mesh/src/service/facade.ts`; add `completeMuseImport` (explicit owner binding) in `local-account-transport-service.ts` (`targetProviderId`/`transportProviderId: muse`).
  - [x] Keyring: verify generic envelope path needs no change; gateway pool: verify no change (ownerUserId + kill-switch already generic).
  - [x] Cover the full enrollment round-trip by tests (import from `auth.json` shape, credential envelope, refresh dispatch, pooled owner-scoped completion).
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

- [x] **Lot 3 — Routing candidates + council (unit level; live probe pending)**
  - [ ] Audit existing default mapping and propose the muse-insertion alternative (least-change) for owner sign-off before editing.
  - [ ] Reprise point (verified 2026-09-20 on `origin/main`): `STANDARD_ROUTE_DEFINITIONS` is the mapping; GA switch already applied for fable (`claude-fable-5*` + `claude-fable-5-1*` → codex `gpt-6-astra` + cloud `gemini-3.8-flash`); opus + sonnet still on cloud `gemini-3.7-flash` (codex `gpt-5.6-sol`/`terra`/`luna`).
  - [ ] Insert muse candidate after faithful claude and before codex (`transportProviderId: muse`, `muse-spark-1.3[-contributor]`, fable-5 + fable-5-1→`max`, opus high/xhigh→`xhigh`), gated by `musePosition` config (`off | after-claude | first`, default `after-claude`).
  - [ ] Switch remaining cloud fallback `gemini-3.7-flash` → `gemini-3.8-flash` (existing catalog model, forced `high` effort); keep `3.7` selectable unless owner says remove; leave codex side untouched.
  - [ ] Write routing tests FIRST (TDD): extend `routing-targets.test.ts` (candidate order claude→muse→codex→cloud, `musePosition` variants, `fable-5.1`, 3.8 fallback) + `route-selection.test.ts` before touching `routing-targets.ts`.
  - [ ] Set efforts: `sonnet5`/`sonnet-5.1` → `max`; `opus high`/`xhigh` → `xhigh`; keep Claude faithful first when account exists, then muse, then existing codex/cloud-code.
  - [ ] Regenerate equivalence council via `make llm-mesh-add-model` (`generated-model-council.ts`, `equivalence-council.ts`).
  - [ ] Handle `gemini-3.8-flash` per BR75-Q2 (`BR75-EXn` if catalog touched).
  - [ ] UAT: route-order check (Claude-first-if-account, then muse, then existing); no auto-fallback beyond account switch on muse credit exhaustion.
  - [x] Lot gate (verified 2026-09-20 conductor: typecheck-api + lint-api 0 errors; mesh 29f/211t; gateway 15/16 — only pre-existing codex BR75-F1 red; `make test-api` MAKE_EXIT=0):
    - [x] `make typecheck-api` + `make lint-api` ENV=test-feat-muse-enrollment
    - [x] **API tests**
      - [x] Update `packages/llm-mesh/tests/routing-targets.test.ts`.
      - [x] Update `packages/llm-mesh/tests/route-selection.test.ts`.
      - [x] Update `packages/llm-mesh/tests/equivalence-council.test.ts`.
      - [x] Update `packages/llm-gateway/tests/target.test.ts`.
      - [x] Update `packages/llm-gateway/tests/router.test.ts`.
      - [x] Sub-lot gate: `make test-api ENV=test-feat-muse-enrollment`
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI change expected; record `none`.
    - [ ] **E2E tests**
      - [ ] Run only if gateway route behavior changed; otherwise record `none` with reason.

- [ ] **Lot 4 — Versions + publication gates (BLOCKED until enrollment proofs)**
  - [x] Proof 1 (2026-09-20, owner-authorized real smoke): `local-import` session → account `acct_muse_…` enrolled → acquire OK with real token (never printed) → removed, keyring verified empty. Ephemeral in-memory service, `/tmp` script only, nothing committed, no secret in logs.
  - [ ] Proof 2: h2a pooled live verdict posted on `loop-mu94uk70` — RED x3 (latest 2026-09-20, peer `muse:muse-h2a` direct on loop: `muse exec --provider meta` minimal → API 402 `billing_error`, `request_id=a0cfc7ef`; prior `a2e90e33`, `7568fbdf`). Cause outside code: no valid Meta payment method. Lot 4 stays gated until owner fixes billing.
  - [ ] Only then: bump `packages/llm-mesh/package.json` semver for `src/**` change.
  - [ ] Bump `packages/llm-gateway/package.json` semver + `llm-mesh` dep.
  - [ ] Verify `check-llm-model-equivalences` gate passes; no direct `npm publish`.
  - [ ] Record owner CI secret action for `MUSE_API_KEY` (BR75-Q4).

- [ ] **Lot N-2** UAT
  - [ ] Web app (no UI change; record `none` with reason)
  - [ ] API/gateway headless checks
    - [ ] `muse exec` smoke via gateway route with `MUSE_API_KEY` name wiring.
    - [ ] Account-import check from `auth.json` shape (keys only).
    - [ ] Route-order check: Claude-first-if-account, then muse, then codex/cloud-code.

- [ ] **Lot N-1 — Docs consolidation**
  - [x] Update `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` with muse enrollment + `musePosition` contract (done `c1287804e`, §14, +158 additive).
  - [x] Delete any branch-local spec draft after integration — `none`: branch adds only muse code+tests (verified via merge-base diff), no draft created.

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
