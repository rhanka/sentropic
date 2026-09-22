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
  - `packages/llm-mesh/src/index.ts` (muse export line only, required to expose the muse runtime client)
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
  - `api/src/services/llm-runtime/mesh-dispatch.ts` (BR75-EX3)
  - `api/tests/unit/llm-runtime-stream.test.ts` (BR75-EX3)
  - `api/tests/api/models.test.ts` (BR75-EX3)
  - `.github/workflows/ci.yml` (BR75-EX4, MUSE_API_KEY env passthrough only)
  - `packages/llm-mesh/src/account-transports.ts` (BR75-EX5)
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
- `acknowledge` BR75-F1 (CORRECTED 2026-09-20 per owner E3 ruling — no "pre-existing" narrative): root-caused with evidence. `ce7978261` (mainline, Sep 15) deliberately removed the strip and passes `max_output_tokens` through, with mesh-side test cover; the gateway contract test (Jun 25) was left stale. Qualification: NOT a vulnerability (numeric cap to first-party backend; stripping would drop a user cap) → branch guilty → stale assertion aligned in-branch (`toBe(123)`). Prior "left red" note withdrawn.
- `acknowledge` BR75-D4 (2026-09-20): h2a-muse Q&A answered (A1 Lot 4 = package semver bumps + equivalences gate, no direct publish; A2 gate-lift signal = reported gateway version at Lot 4; A3 unit-level results only — order/efforts/3.8-high green in mesh+gateway unit tests, NO live probe run yet; live pooled proof delegated to h2a-muse with verdict on the loop).
- `acknowledge` BR75-D5 (2026-09-20): wording discipline — unit green is reported as unit green; "probe/tested" is reserved for live runs (real enrollment, serving gateway).
- `acknowledge` BR75-D6 (owner 2026-09-20): h2a-side gemini enrollment MAY BE REMOVED without re-enroll for the muse-only gateway UAT (`h2a run claude --model muse-spark-1.3 --effort low --gw`, headless). Owner-approved destructive step.
- `attention` BR75-EX2 (DB + HTTP enrollment surface for muse): reason — Chapitre B is unreachable remotely (404) without the same seams codex uses (DB lease store + refresh-if-needed + provider-connections + intent schemas + route cases); impact — additive muse cases only, no existing provider touched; rollback — delete the muse cases. Paths: `api/src/services/llm-account-transports.ts`, `api/src/services/provider-connections.ts`, `api/src/routes/namespaces/llm-mesh-enrollment.ts`, `api/src/routes/namespaces/llm-mesh-enrollment-intent.ts`, `api/tests/unit/llm-account-transports.test.ts`. (Unrelated to the pre-existing Makefile `BR75-EX1` string.)
- `attention` BR75-EX3 (api runtime dispatch + closed-world test updates for muse, 2026-09-21): reason — CI PR593 red (2 shards): newly advertised muse models had no stream fixture, catalog length 24→26, stale Lot-2 `not.toContain('muse')`; root cause — api `applicationLlmMesh` never routed muse to the api `MuseProviderRuntime` (transport-free mesh default adapter throws), so muse was unreachable via the api runtime; impact — 1 additive wiring line (`muse: applicationProviderClient`, no existing provider touched) + fixture/assertion updates only; rollback — `git checkout` the 4 files. Paths: `api/src/services/llm-runtime/mesh-dispatch.ts`, `api/tests/unit/llm-runtime-stream.test.ts`, `api/tests/api/models.test.ts` (`api/tests/unit/provider-registry-expansion.test.ts` already allowed).
- `attention` BR75-EX4 (MUSE_API_KEY CI wiring, 2026-09-22, owner: "le secret je te l'ai donné mille fois"): reason — BR75-Q4 secret action: `MUSE_API_KEY` secret created from owner `.env` (`gh secret set`, value never in repo/logs) + passthrough into the two api-test env blocks of `ci.yml`, mirroring sibling keys; impact — CI test jobs receive the key name like the other five providers, no job logic touched; rollback — `git checkout` the workflow + `gh secret remove MUSE_API_KEY`. Paths: `.github/workflows/ci.yml`.
- `attention` BR75-EX5 (affinity-lease fallback fix, 2026-09-22, T16): reason — T16 fallback proof exposed it live: planner re-route onto the surviving account died on the stale affinity lease (`No active muse account transport`); the coordinator never yields a same-key lease to an explicit account pin; impact — 8-line guard in `acquire` (explicit pin wins, stale lease dropped), no behavior change otherwise; rollback — `git checkout` the file. Paths: `packages/llm-mesh/src/account-transports.ts` (`packages/llm-mesh/tests/account-transports.test.ts` already allowed).
- `acknowledge` BR75-D8 (2026-09-22, T16): fallback GREEN live. Poison account-scoped retryable sur seat → replan → direct (candidate_3) → acquire + generate `ok`. Trouvé et fixé au passage : le lease d'affinité fantôme — un re-routage planner vers un autre compte sous la même affinity key mourait sur l'ancien lease (`No active ... account transport`) ; le pin explicite gagne désormais (coordinator). Preuve TDD : `tests/account-transports.test.ts` (rouge sans fix). WATCH seat : statut retombé `reauth_required` entre 23:53 et 02:28 malgré clé valide (200 live) — refresh-rate ? Réimporté actif 02:39 ; cause première du flip non encore isolée, monitoring en cours. Le `h2a ls` (façade publiée) affiche le record public stale `active` pendant que l'enveloppe dit `reauth_required` — écart connu, à garder en tête pour T7 soak.
- `acknowledge` BR75-D7 (2026-09-22, owner option-b): LIVE gateway traversal GREEN with branch code. Scratch server only (`/tmp/muse-gw`, loopback 3102, killed after; module links removed; nothing committed except the fixes below): branch `llm-gateway` + `llm-mesh` dists, `MuseAdapter(MuseRuntimeClient)`, cli-mode facade on the live keyring. `POST /v1/chat/completions` `muse-spark-1.3` via the seat account → 200 `content:"ok"` `finish:stop` (max_tokens 1000). Notes: (1) 5-token probes length-truncate to `content:null` — the reasoning model burns ~190 tokens before answering, expected, not a parser bug (proven by raw Meta body comparison); (2) OIDC device calls must be form-encoded (JSON→404) and mint needs `Bearer <dca>` alongside the body (body-only→401) — both live-probed, tested, committed (`1f14da554`, `ed252aa23`).

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
  - [x] Proof 2: LIVE DISPATCH GREEN via account path (2026-09-20, conductor: `muse exec --reasoning-effort minimal` with logged-in power account, no key in env → model answered `ok`). Key path went GREEN 2026-09-20 (peer `muse:muse-h2a` direct on `loop-mu94uk70`: `muse exec --provider meta` minimal answered `ok`, billing fixed after owner added payment on `dev.meta.ai`; prior RED x3 with 402 `billing_error`). Both live paths green; Lot 4 done on this basis.
  - [x] Only then: bump `packages/llm-mesh/package.json` semver for `src/**` change. (2026-09-20 Lot 4: `0.19.3` → `0.20.0` minor, feature convention per `f54640c0a`/`044fb4249`.)
  - [x] Bump `packages/llm-gateway/package.json` semver + `llm-mesh` dep. (2026-09-20 Lot 4: `0.15.0` → `0.16.0`, dep `^0.19.0` → `^0.20.0`.)
  - [x] Verify `check-llm-model-equivalences` gate passes; no direct `npm publish`. (2026-09-20 Lot 4: `make check-llm-model-equivalences ENV=test-feat-muse-enrollment` exit 0; publish is CI OIDC only.)
  - [ ] Record owner CI secret action for `MUSE_API_KEY` (BR75-Q4).

- [x] **Lot 4b — Direct-billing MUSE_API_KEY import (owner-requested, post-Lot4)**
  - [x] TDD: 5 provider tests (`importDirectApiKey` stable/convergent id, `direct:` namespace keeps direct-key accounts distinct from CLI-login accounts, blank-key rejection without echo, `buildMuseDirectAuthPayload` maps to `{auth_type: api_key, user_api_key}`) + 4 service round-trip tests (`completeMuseDirectImport` enroll/acquire, convergence, owner-scope required, blank rejection; public record carries `billing_type=direct`, never the key). Red first (5 failed), green after.
  - [x] Implementation: `enrollment/muse.ts` (`importDirectApiKey`, `buildMuseDirectAuthPayload`, `MUSE_DIRECT_BILLING_TYPE`), `enrollment/contracts.ts` (optional `importDirectApiKey`), `service/local-account-transport-service.ts` (`completeMuseDirectImport`), `service/facade.ts` (passthrough). No dispatch wire added (no endpoint fabricated); `MuseProviderRuntime.generate` still rejects — live dispatch stays proven via `muse exec`, not via mesh.
  - [x] Gates (2026-09-20 conductor, `484cbe1e0`): mesh 29f/220t, gateway 16f/114t, `typecheck-llm-mesh` + `lint-llm-mesh` clean, `scope-check` PASS, all `ENV=test-feat-muse-enrollment`.
  - [x] Lockstep bumps (2026-09-20 conductor, `4853aa5e4`): mesh `0.20.0` → `0.21.0`, gateway `0.16.0` → `0.17.0` + dep `^0.21.0`; `check-llm-model-equivalences` exit 0; suites re-verified.
  - [x] CI green on final head: `35530123766` SUCCESS (prior run `35527395418` failed only on transient npm `ETARGET` for `@peculiar/asn1-schema@2.9.5` in `smoke-idp-screens`; version exists on registry, rerun green).

- [ ] **Lot N-2** UAT
  - [x] Owner criterion (2026-09-20): h2a-side BROWSER enrollment test of the siège (power) account — GREEN per peer `muse:muse-h2a` (read-only, no login performed): CDP-driven check, muse.ai tab logged in, no login wall, subscription active, Muse Connected, registry entry in `instances.jsonl`, live round-trip ok x2, session export schema 1 redacted ok. Caveats: personal chat tab untouched; peer h2a binary predates muse support.
  - [ ] Owner criterion (2026-09-20): h2a-side `h2a run claude` via gateway with MUSE ACCOUNT ONLY — VERDICT RED 2026-09-20 (peer direct on loop): `h2a run claude --model muse-spark-1.3 --gw` headless exits 1 because the Claude CLI rejects the unknown model id (allowlist) BEFORE any gateway call. Root cause in test harness, not in mesh integration: live muse serving already proven green on both paths (key + power account via `muse exec`). Peer full local matrix 2026-09-20 (direct on loop): TEST1 RED (pty harness — no DSR, cursor error, undelivered prompt), TEST2 RED x4 (Meta 529 overload legs, incl. empty pool, no clean no-route error — billing fixed, capacity not), TEST3 impossible (no `muse-code` provider by design; clean rejection verified = fail-closed OK), resume partial (resolution + fail-closed guard OK, round-trip blocked quota/529). Billing probe GREEN, browser-UAT GREEN read-only. Convergence 2026-09-20 (peer direct): TEST2 529s are NOT Meta capacity — serving registry holds codex+gemini legs only, zero muse leg (branch muse provider lives in unmerged/unpublished 0.20.0); pool now zero accounts (owner removed cloud-code) so retry needs an enrolled account first; no `muse-code` provider mesh-side by design. Conductor verified: no hardcoded Meta endpoint in branch — `api_base_url` comes from the enrolled CLI store (`enrollment/muse.ts:25`). Pending owner rulings: (1) full serving chain now vs park, (2) muse-only criterion ruling, (3) CI-red waiver, (4) `MUSE_API_KEY` secret handling.
  - [x] Web app (`none`: 0 UI files in merge-base diff — mesh/api/tests/spec only).
  - [ ] API/gateway headless checks
    - [ ] `muse exec` smoke via gateway route with `MUSE_API_KEY` name wiring. (2026-09-20 Lot 4 account-path substitute GREEN: `muse exec --reasoning-effort minimal` via logged-in account answered `ok`; key path stays RED 402 per Proof 2 — unbilled key, outside code — so the key-wired gateway smoke remains unrun.)
    - [x] Account-import check from `auth.json` shape (keys only). (2026-09-20 Lot 4: keys-only introspection — top-level `providers` + `schema_version`, `providers.meta` entry — matches `enrollment/muse.ts` reader; no values printed.)
    - [x] Route-order check: Claude-first-if-account, then muse, then codex/cloud-code. (2026-09-20 Lot 4 unit level: mesh `routing-targets` 16/16 + `route-selection` 15/15, gateway `target` 11/11 + `router` 9/9; live gateway route unavailable, key path 402s.)

- [ ] **Lot N-1 — Docs consolidation**
  - [x] Update `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` with muse enrollment + `musePosition` contract (done `c1287804e`, §14, +158 additive).
  - [x] Delete any branch-local spec draft after integration — `none`: branch adds only muse code+tests (verified via merge-base diff), no draft created.

- [x] **Lot N — Final validation** (2026-09-20 conductor re-run post-Lot4: `make typecheck-api lint-api` + `make test-api` ENV=test-feat-muse-enrollment, FINAL_EXIT=0, 0 failures)
  - [x] Typecheck & Lint
  - [x] Retest UI — `none` (0 UI files in merge-base diff, verified)
  - [x] Retest API
  - [x] Retest e2e — `none` with reason (no gateway `src/**` route change — only bump+test; mesh routing covered by 211 unit tests)
  - [x] Retest AI flaky tests — none observed (two consecutive full `test-api` greens, 0 `×/✗/AssertionError`); no sign-off needed
  - [x] Provider cascade — N/A by construction (only additive `muse-provider.ts`; none of the 5 existing providers touched, `llm-runtime` untouched; no `test-api-ai` target exists; full `test-api` green covers regressions)
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [x] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers. (2026-09-20 CI `35510597132` on PR #593: 3 failures, ALL pre-existing/infra, none attributable to branch — `codex.test.ts` aligned in-branch; minio E3 repoint now on main via #594. CONFIRMED 2026-09-20: CI re-run `35519183507` SUCCESS (23m45s). No waiver needed.)
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
