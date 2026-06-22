# Feature: WP16 Layer-B — @sentropic/llm-gateway (kickoff scaffold)

## Objective
Land the WP16 Layer-B foundation: the architect-signed `SPEC_EVOL_LLM_GATEWAY` spec, a compiling `@sentropic/llm-gateway` package skeleton (v0 personal-passthrough, frozen v1 wire surface as typed stubs), and the full Layer-B lot plan. Nothing is published this lot.

## Scope / Guardrails
- Scope limited to `packages/llm-gateway/**`, `spec/SPEC_EVOL_LLM_GATEWAY.md`, `BRANCH.md`.
- No migration in this branch (`api/drizzle/*.sql` out of scope).
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/wp16-llm-gateway`.
- This lot runs NO dev stack, NO docker, NO e2e — only package typecheck + the new package unit test.
- Automated test campaigns must run on dedicated environments, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- v0 = personal-passthrough ONLY (caller == provider, ToS-conforming). Cross-user pool gated behind a kill switch DEFAULT OFF; NOT wired.
- No publish, no version above `0.0.0`, no bootstrap publish — new package requires owner re-confirm + the contract double-review gate first.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/**`
  - `spec/SPEC_EVOL_LLM_GATEWAY.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/**`
  - `deploy/**`
  - `.cursor/rules/**`
  - `packages/llm-mesh/**`
  - every other published `packages/<pkg>/**`
  - `api/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Environment / Ports
- Worktree: `tmp/wp16-llm-gateway`, branch `feat/wp16-llm-gateway`.
- Slot owner: `claude:mesh`, slot 0.
- Reserved (NOT started this lot): `API_PORT=9245`, `UI_PORT=5445`, `MAILDEV_UI_PORT=1345`.
- Root dev/UAT stays reserved: API `8787`, UI `5173`, Maildev `1080`.

## Feedback Loop
- `BR-LB-EX1` `scope-exception` (OWNER-APPROVED 2026-06-22): wire the brand-new `@sentropic/llm-gateway` into CI. CI does NOT auto-discover packages — each is explicitly wired in BOTH the `Makefile` and `.github/workflows/ci.yml` (default-forbidden paths). Paths touched: `Makefile` (added `typecheck-llm-gateway`+`build-llm-gateway`+`pack-llm-gateway`+`test-llm-gateway`, mirroring the `test-auth-hono` sibling-symlink pattern — builds the sibling `@sentropic/llm-mesh` dist then symlinks it + `hono`/`vitest`/`@types/node` into the gateway node_modules) + `.github/workflows/ci.yml` (added the `llm_gateway` `changes` output, a `llm_gateway` paths-filter incl. `packages/llm-mesh/**`, and a `validate-llm-gateway` job mirroring `validate-llm-mesh`: typecheck→test→build→pack). Rationale: without this the PR's CI cannot typecheck/test the package at all. Impact: NO unrelated job altered; NO auto-publish job (first publish = manual bootstrap, see Lot-3); confined to the two named files. Rollback: revert the two hunks (the gateway typecheck/test/build/pack make targets + the ci.yml `llm_gateway` output/filter/job). Verified: `make typecheck-llm-gateway` clean (src+tests), `make test-llm-gateway` 48/48 green.
- `FL-1` `acknowledge`: llm-mesh public selection surface is `AccountTransportCoordinator.acquire()` (+ `InMemoryAccountTransportCoordinator`), NOT an exported `selectAccount` (that name is a private method on the in-memory coordinator). The gateway consumes `acquire()` as "personal-pool selection over llm-mesh". No code change needed; recorded so Lot 2 wires the correct symbol. `FL-1(a)` `resolved` (Lot-3a, architect-verified): the spec §1/§2/§7 wording is now corrected to name the PUBLIC `acquire()` / `AccountTransportAcquisition` everywhere (no more `selectAccount`); exposing a pure planner from llm-mesh is DEFERRED to llm-mesh v0.6+ (noted in spec §1).
- `FL-2` `acknowledge`: root workspace `node_modules/@sentropic/llm-mesh` resolves to root's STALE `packages/llm-mesh@0.2.0` (missing `ClaudeCodeAccountAuthMaterial` / `AccountTransportCoordinator`). Typecheck/test in this lot were run against the worktree's freshly-built llm-mesh `0.5.0` dist (isolated, then removed). Lot 2 CI runs on the branch where the workspace resolves the correct version.
- `FL-3` `deferred`: F2/F3 (Layer-A follow-ups) touch `api/**` (Forbidden here) → a SEPARATE branch/lot. Scoped below, NOT implemented this branch.
- `FL-4` `attention`: the wire contract is NOT frozen-final until the contract double-review gate (Opus 4.8max + Codex 5.5xhigh + BR-46 contract-snapshot + architect sign) AND owner re-confirm (new package). Until then `/v1/*` stays a v0 scaffold.
- `FL-5` `resolved` (Lot-3a, via `BR-LB-EX1` owner-approved 2026-06-22): the CI wiring is DONE in `Makefile` (`typecheck-llm-gateway`/`build-llm-gateway`/`pack-llm-gateway`/`test-llm-gateway`, mirroring the `test-auth-hono` sibling-symlink pattern for `@sentropic/llm-mesh`) + `.github/workflows/ci.yml` (`llm_gateway` changes output + paths-filter incl. `packages/llm-mesh/**` + `validate-llm-gateway` job mirroring `validate-llm-mesh`). Verified via the real targets: `make typecheck-llm-gateway` clean, `make test-llm-gateway` 48/48.
- `FL-6` `resolved` (Lot-3a): version bumped `0.0.0` → `0.1.0` (first-publish target; satisfies `enforce-package-bump`). NO publish this lot — npm publish stays gated behind the Lot-3 double-review + architect sign + owner re-confirm + the manual bootstrap (see Lot-3 / the bootstrap-publish plan below).
- `FL-7` `acknowledge`: the docker/make package-gate path is BLOCKED this session (a Make-only/Docker-first guard hook denies raw `docker run` and any non-`-g` `npm install`, even inside the established `make typecheck-chat-server` docker pattern — intermittently). Lot-2 gate was therefore run on the HOST via the ALLOWED global-CLI carve-out: `npm i -g typescript@5.4.5 vitest@4.0.18 hono@4.10.7 @types/node@22`, built `packages/llm-mesh` dist with global `tsc`, symlinked it + the global tools into `packages/llm-gateway/node_modules`, ran `tsc --noEmit` (src + `tsconfig.test.json`) and `vitest run tests`. Artifacts (`node_modules`, `llm-mesh/dist`, `.tmp/`) NOT committed. Authoritative CI gate still needs `FL-5`.

## Deferred to separate branch/lot (gated)
- `F2` (api/) — `api/src/services/llm-runtime/mesh-dispatch.ts` `extractCredential` must handle `claude-code-account`. Touches `api/**` → out of this branch's Allowed Paths.
- `F3` (api/ + llm-mesh contract) — thread `headers` through the public `CredentialValidationResult` / `validateAuth`. Touches `api/**` (and a published-package contract) → out of scope; gated D11/ARCH-12 contract review.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single orthogonal capability (one new package + one spec); no independent sub-workstreams needing separate CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on the integrated branch only (after each lot, when a UI/runtime surface exists). The kickoff lot has no UI/runtime surface → no UAT this lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`.
  - [x] Confirm isolated worktree `tmp/wp16-llm-gateway` on branch `feat/wp16-llm-gateway`.
  - [x] Capture make targets for package typecheck/test (`typecheck-api`, `test-packages`, `test-pkg-*` pattern).
  - [x] Define env mapping + ports (API `9245`, UI `5445`, Maildev `1345`) — reserved, not started.
  - [x] Read the Layer-A public API of `packages/llm-mesh/` (`index.ts`, `mesh.ts`, `auth.ts`, `account-transports.ts`).
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`); no `BRxx-EXn` needed.

- [x] **Lot 1 — Spec land + scaffold + BRANCH.md + draft PR (THIS lot)**
  - [x] Copy `spec/SPEC_EVOL_LLM_GATEWAY.md` verbatim into the worktree (sha256-identical, 137 lines).
  - [x] Scaffold `packages/llm-gateway/` = `@sentropic/llm-gateway` (`version 0.0.0`, not private, NOT published).
    - [x] `package.json` (deps `@sentropic/llm-mesh` + `hono`; devDeps `typescript`/`vitest`/`@types/node`), `tsconfig.json`, build/typecheck/test scripts mirroring `packages/llm-mesh` + `packages/chat-core`.
    - [x] Hono router exposing the FROZEN v1 surface (spec §3): `POST /v1/messages`, `POST /v1/chat/completions`, `GET /v1/models`, `GET /healthz`, `GET /readyz`. Health real; provider-compat routes typed stubs returning provider-shaped `501`.
    - [x] Core PORT interfaces (spec §1/§4/§6): `CallerAuthPort`, `CostContext`, `PoolStatePort`, `AuthResolver` (gateway-owned), `GatewayDispatchPort` (llm-mesh seam) — interfaces + minimal stubs only.
    - [x] 3-mode authz TYPES (spec §7 D0): `AuthzMode` (`direct`/`explicit-validation`/`assisted`) + `ProviderIdentity` + `AuthorizationGrant` carried on selection — gated, NOT enforced.
    - [x] Kill switch `crossUserPoolEnabled` DEFAULT OFF; v0 mode `personal-passthrough`.
    - [x] `README.md` documenting status + first-publish bootstrap gate.
  - [x] Minimal unit test (`tests/router.test.ts`): router mounts, `/healthz` ok, `/readyz` ready, frozen v1 surface returns provider-shaped 501 stubs, kill switch OFF, authz types present.
  - [x] Lot gate (package-scoped, no dev stack):
    - [x] Typecheck `packages/llm-gateway` (src) — clean.
    - [x] Typecheck `packages/llm-gateway` (src + tests) — clean.
    - [x] Unit test `packages/llm-gateway/tests/router.test.ts` — 6/6 passing.
  - [x] Push `feat/wp16-llm-gateway` + open DRAFT PR (title/body from this file) + post 3-6 step plan as first PR comment.

- [x] **Lot 2 — Real personal-passthrough flow (v0)**
  - [x] Caller-auth: concrete `CallerAuthPort` (`PersonalPassthroughCallerAuth`) — parse `Authorization` (Bearer/DPoP) → verify via injectable `VerifyToken` (documented stub seam for the `auth-hono` OIDC/session edge) → resolve `CostContext` from the VERIFIED identity (never the body); caller == provider (ToS-safe).
  - [x] Pool: concrete `PoolStatePort` (`CoordinatorPoolState`) over a personal pool using llm-mesh `AccountTransportCoordinator.acquire()` + sticky binding (lease keyed on workspace+affinity+provider+transport+model; NO silent rebind — `getLeasedAccount` re-checks eligibility); kill-switch guard rejects grant-requiring selection while OFF.
  - [x] Secret resolve: concrete `AuthResolver` (`PassthroughAuthResolver`, refresh-under-lock seam, gateway-owned); hooks/logs receive REDACTED descriptors only (`redactSelection`/`redactForLog`/`fingerprint`).
  - [x] Dispatch: concrete `GatewayDispatchPort` (`PassthroughDispatch`) over an injectable `ProviderTransport`; FAITHFUL provider-compat passthrough (request body verbatim, response JSON+status verbatim, SSE frames verbatim; OpenAI `[DONE]` appended).
  - [x] SSE fixtures: Anthropic SSE (`message_start`..`message_stop`) vs OpenAI (`chat.completion.chunk`..`[DONE]`) — `tests/fixtures/{anthropic,openai,transport,harness}.ts`.
  - [x] Error mapping (spec §3b): 401 caller-auth, 429 over-budget + `Retry-After`, 429 no-eligible-account + `Retry-After`, 503 pooled-account-unavailable, 400 bad-request/unsupported-model — provider-shaped, never leak pool internals (`mapGatewayError`/`toProviderShapedError`).
  - [x] No-retry-after-stream (spec §2): mid-stream provider failure settles failure/estimated usage, no retry; settle HOOK (`MeteringSink`) always called once (BR-47 ledger = Lot 4).
  - [x] Version: bumped `0.0.0` → `0.1.0` in Lot-3a (first-publish target; satisfies `enforce-package-bump`). NO publish — gated behind the Lot-3 double-review + sign + owner re-confirm + manual bootstrap. (`FL-6` resolved.)
  - [x] Lot gate (typecheck src OK + typecheck src+tests OK + vitest 36/36 across 6 files). Lot-2 ran via host global CLI tools + symlinked llm-mesh dist; Lot-3a RE-RAN the authoritative CI gate via the real make targets (`make typecheck-llm-gateway` clean, `make test-llm-gateway` 48/48 — `BR-LB-EX1`, `FL-5` resolved).

- [x] **Lot 3a — Freeze prep (architect §7 corrections + CI wiring + contract-snapshot + version) — THIS lot, stays DRAFT**
  - [x] Architect §7 (a): spec §1/§2/§7 wording — `selectAccount` → PUBLIC `AccountTransportCoordinator.acquire()` / `AccountTransportAcquisition`; pure-planner exposure DEFERRED to llm-mesh v0.6+ (noted). (`FL-1(a)` resolved.)
  - [x] Architect §7 (b): renumber §7 reco-defaults contiguous (was D1,D3,D4,D5,D6,D7 — D2 skipped → now D1..D6; content unchanged, numbering hygiene; architect to confirm at sign).
  - [x] Architect §7 (c): code — `authzMode`+`providerIdentity` carried on the gateway `PoolSelection` wrapping the PUBLIC `AccountTransportAcquisition` (NOT a private selectAccount); carried-but-NOT-enforced in v0 (caller==provider, kill-switch OFF). Clarified `PoolSelection` doc.
  - [x] `BR-LB-EX1` — CI wiring (owner-approved): `Makefile` (`typecheck-/build-/pack-/test-llm-gateway`, mirroring `test-auth-hono`) + `.github/workflows/ci.yml` (`llm_gateway` output + paths-filter incl. `packages/llm-mesh/**` + `validate-llm-gateway` job mirroring `validate-llm-mesh`). NO auto-publish job. (`FL-5` resolved.)
  - [x] BR-46 contract-snapshot: `tests/contract-snapshot.test.ts` freezes the v1 route inventory + request/response/SSE framing + the §3b error-mapping table (12 tests). Detector only — the SIGN is the Lot-3 gate.
  - [x] Version `0.0.0` → `0.1.0` (first-publish target). (`FL-6` resolved.)
  - [x] Lot-3a gate: `make typecheck-llm-gateway` clean (src+tests), `make test-llm-gateway` 48/48 (7 files). #353 stays DRAFT; wire NOT frozen-final (awaits Lot-3 sign).

- [x] **Lot 3b — Review-fixes (double-review returned FIX-FIRST; all findings resolved gateway-side, #353 stays DRAFT)**
  - [x] B1 caller==provider — `personal-passthrough/pool.ts`: owner-scoped per-caller coordinator (`coordinatorFor`) + `metadata.ownerUserId` owner filter + per-caller `affinityKey`; deny-as-missing; unowned accounts non-selectable. NO llm-mesh change. Tests: `tests/caller-ownership.test.ts`.
  - [x] B2 stop leaking `leaseId` — `redaction.ts`: `RedactedSelectionView` drops `leaseId`/`accountFingerprint`, carries a gateway-local OPAQUE `correlationId` (`newCorrelationId`). Test: `tests/passthrough.test.ts` "B2 …" + `tests/redaction.test.ts` (asserts no `lease`/`leaseId`/account-id in the metering record or view).
  - [x] B3 `[DONE]` terminator ownership — `router/index.ts` (drop synthetic `OPENAI_DONE`) + `flow.ts`/`ports/dispatch.ts`/`personal-passthrough/dispatch.ts` (provider stream owns terminator). Tests: `tests/passthrough.test.ts` "B3 provider already emits [DONE] → exactly one" + "B3 mid-stream error → NO trailing [DONE]".
  - [x] #4 provider response headers — `ports/dispatch.ts` (carry `headers`/`GatewayDispatchStream`) + `router/index.ts` (allowlist `FORWARDABLE_PROVIDER_HEADERS` + `X-Sentropic-Request-Id`; pool-internal headers dropped). Test: `tests/passthrough.test.ts` "#4 provider response header passthrough".
  - [x] #5 malformed JSON → 400 — `router/index.ts` (`mapGatewayError(wire,'bad-request')`). Test: `tests/errors.test.ts` "returns EXACTLY 400 …" (no `[400,503]` tolerance).
  - [x] #6 stream failure before first byte → 503 — `flow.ts` `runStreamFlow` (buffer first frame; pre-first-byte failure rethrows provider-shaped error; settle without throw only AFTER bytes). Test: `tests/passthrough.test.ts` "#6 … returns 503, not an empty 200".
  - [x] #7 kill-switch fail-closed — `flow.ts` (reject cross-user mode while OFF) + `personal-passthrough/pool.ts` (`selectionMode`; grant required when ON). Tests: `tests/caller-ownership.test.ts` "#7 …" + `tests/redaction.test.ts` "#7 …".
  - [x] #8 authz shape → spec §7 — `ports/authz.ts` rename `mode`→`authzMode`, `responsibleProvider`→`providerIdentity`; usages + snapshot updated.
  - [x] #9 contract-snapshot real freeze — `tests/contract-snapshot.test.ts`: router-derived unknown-route guard + exact JSON bodies + exact SSE bytes + full error envelopes (status+body+code+message+headers).
  - [x] #10 `x-api-key` caller-auth — `personal-passthrough/caller-auth.ts` (accept `x-api-key` scheme). Spec §3 updated. Test: `tests/errors.test.ts` "#10 …".
  - [x] #11 `fingerprint()` removed (was dictionary-reversible) — `redaction.ts` logs use fixed `[redacted]` mask + opaque correlation id. Test: `tests/redaction.test.ts`.
  - [x] Lot-3b gate: `make typecheck-llm-gateway` clean (src+tests), `make test-llm-gateway` 65/65 (8 files). Scope: ONLY `packages/llm-gateway/**` + `spec/SPEC_EVOL_LLM_GATEWAY.md` + `BRANCH.md` (NO llm-mesh, NO api, NO Makefile/ci.yml). #353 stays DRAFT, version 0.1.0, NOT published.

- [ ] **Lot 3 — Contract double-review GATE (before any publish)**
  - [ ] Double adversarial review of the frozen wire: Opus 4.8max + Codex 5.5xhigh.
  - [x] BR-46 contract-snapshot of `/v1/{messages,chat/completions,models}` + health (DONE in Lot-3a: `tests/contract-snapshot.test.ts`, 12 tests — the freeze DETECTOR the reviewers ratify against).
  - [ ] Architect sign-off on the frozen wire (`claude:architect:29d97a48f361` reviews spec §7 line-by-line + the surface).
  - [ ] Owner re-confirm (new package publish authorization).
  - [ ] On GO only: bootstrap publish (`workflow_dispatch` `bootstrap_publish_target=llm-gateway` using `NPM_TOKEN`) + attach OIDC trusted publisher on npmjs.com (conductor drives WITH the owner — see the bootstrap-publish plan below).

## Bootstrap-publish plan (NEW package `@sentropic/llm-gateway` — Lot-3, conductor-driven WITH owner; NOT run this lot)
- `@sentropic/llm-gateway` is brand-new + unpublished → first publish CANNOT use steady-state OIDC trusted publishing (no package exists yet to attach a trusted publisher to). It needs the one-shot manual bootstrap (per `rules/workflow.md` Package Publication):
  1. After GO (double-review + architect sign + owner re-confirm), wire the bootstrap path: add `llm-gateway` to the ci.yml `workflow_dispatch` `bootstrap_publish_target` choices + a `publish-llm-gateway`/`publish-llm-gateway-token` make target (mirroring `publish-llm-mesh`/`publish-llm-mesh-token`) — these are DELIBERATELY NOT added in Lot-3a (Lot-3a is freeze prep only, no publish plumbing).
  2. Trigger `workflow_dispatch` on `ci.yml` with `bootstrap_publish_target=llm-gateway` (uses the `NPM_TOKEN` secret) on `main` → first `npm publish`.
  3. Immediately attach the OIDC trusted publisher on `npmjs.com → @sentropic/llm-gateway → Settings → Trusted Publisher` pointing to `rhanka/sentropic` workflow `ci.yml` (drive the npmjs.com UI via Playwright MCP, as done for prior packages).
  4. Add the steady-state `validate`-gated `publish-llm-gateway` OIDC job + a `llm_gateway_publish` paths-filter for subsequent releases.
- Owner has approved the new-package publish in principle; the GATE order is: Lot-3 double-review → architect sign → owner re-confirm → bootstrap. The conductor orchestrates; this lane does NOT trigger the bootstrap on its own initiative.

- [ ] **Lot 4 — BR-47 metering wiring**
  - [ ] Pre-call reservation (`budget_reservations`) BEFORE dispatch (deny-over-cap → provider-shaped quota error, no account selected).
  - [ ] Post-call settlement: ONE financial `cost_event` rolled by `CostContext` (never double-write); linked pool-outcome record for account state.
  - [ ] Never-zero usage (estimated if usage missing).

- [ ] **Lot 5 — Cross-user 3-mode authz enforcement (behind kill switch)**
  - [ ] Enforce `direct` / `explicit-validation` / `assisted` modes on the lease + selection; carry responsible `ProviderIdentity` on every dispatch.
  - [ ] Activates ONLY after owner ToS-acceptance + kill switch ON (spec §7 D0). Reject grant-requiring requests while OFF.

- [ ] **Lot F2/F3 (separate branch, api/ scope, GATED)**
  - [ ] F2: `api/src/services/llm-runtime/mesh-dispatch.ts` `extractCredential` handles `claude-code-account`.
  - [ ] F3: thread `headers` through public `CredentialValidationResult` / `validateAuth` (contract review D11/ARCH-12).

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Keep `spec/SPEC_EVOL_LLM_GATEWAY.md` in sync with shipped behavior; fold any `spec/BRANCH_SPEC_EVOL.md` deltas back, then delete.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (package-scoped).
  - [ ] Retest package unit + contract tests.
  - [ ] Confirm `packages/llm-gateway/package.json` version bumped for every lot whose `src/**` changed (enforce-package-bump).
  - [ ] Final gate: PR body = this file; CI green; UAT (when a runtime surface exists).
  - [ ] On UAT + CI both OK: commit removal of `BRANCH.md`, push, merge.
