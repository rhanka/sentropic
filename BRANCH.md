# Feature: llm-gateway muse+vibe wires

## Objective
- Serve muse and vibe CLIs through llm-gateway with enrolled accounts, fix 5 operational gaps, ship CI integration tests, merge, publish npm bumps.

## Scope / Guardrails
- Scope limited to `packages/llm-gateway/src/**`, `packages/llm-gateway/tests/**`, `packages/llm-mesh/src/**`, `packages/llm-mesh/tests/**`, `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`.
- One migration max in `api/drizzle/*.sql` (not expected; none planned).
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` reserved for user dev/UAT (`ENV=dev`) and stays stable.
- Branch development happens in isolated worktree `tmp/llm-gateway-muse-vibe-wires`.
- Automated test campaigns run on dedicated environments (`ENV=test-gw-wires` / `ENV=e2e-gw-wires`), never on root `dev`.
- UAT qualification worktree stays commit-identical to branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` passed as last argument.
- All new text in English.
- h2a `--gw` guard relaxation + dep bump owned by h2a lane (external dependency, not this branch).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`
  - `packages/llm-gateway/package.json`
  - `packages/llm-mesh/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `package-lock.json`
- **Exception process**:
  - Declare exception ID `GWV-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- `attention`: owner brief received via `agent:conductor:38f44695f2ad` (`env:send:a7b2be1d`), targeted at `muse:sentropic:369322cd9b39`, deposited on live lane `muse:sentropic:1ced6e4393e1`.
- `attention`: h2a `--gw` claude-only guard relaxation + dep bump owned by h2a lane; this branch delivers gateway+mesh only.
- `attention`: local `main` was stale at `cb618e190`; worktree based on `origin/main` `dc95f7e4f` (train mesh 0.25.0 + gateway 0.19.5 + cluster-mesh 0.13.3).
- `acknowledge`: Lot 0 evidence (live gateway `127.0.0.1:3002`, h2a 0.98.3, personal-passthrough, ready): bad JSON -> OpenAI 400 `invalid request`; valid muse body no-auth -> 401 `authentication failed` (wire parses, auth gates pre-pool); `GET /muse-code/models` -> plain 404 (route missing); `POST /v1/messages/count_tokens` -> plain 404 (route missing).
- `acknowledge`: vibe default model alias `mistral-medium-3.5` absent from `routing-targets.ts` static routes, catalog, council (only `mistral-large-4` + `zai-glm-5-3` ride `mistral-vibe`).
- `acknowledge`: sticky fail-closed confirmed in code (`route-planner.ts` affinity block empties candidates when affinity account missing/not-ready); negative-cache default TTL 300s confirmed (`routing-policy.ts`); sticky file purged to `{}`.
- `attention`: evening muse-400 exact trigger bytes unconfirmed (parse-then-auth order proves body-level failure); vibe-503 exact trigger unconfirmed (unknown-model vs no-eligible-account); owner captures requested if repro diverges.
- `attention`: native provider token counting (Anthropic count endpoint via pooled credential) is host-transport follow-up for the h2a lane: needs a `count` seam on the production `ProviderTransport` + mesh attempt; this branch reserves the route, the error mapping, and the no-lease/no-metering contract.
- `GWV-EX1`: `scripts/llm-model-equivalences/council.source.json` (council exclusion for `mistral:mistral-medium-3.5`, same no-benchmark rationale as its mistral siblings). Reason: equivalence gate requires every catalog model classified or excluded. Impact: generated council digest only. Rollback: drop the entry + refresh.
- `attention`: cloud-code (agy) added to this branch scope on owner request (avoid a repeat request later): verify the agy CLI path through the gateway, fix gaps, cover with tests.
- `attention`: auto-mode free classifier billing (forward `anthropic-beta` + `safeguards` verbatim, return `safeguard_results` untouched, keep tool-use IDs, forward error bodies unmodified) is EXCLUDED from this branch on owner request — separate later PR, gateway must keep managing (metering/leases/auth + opt-out). Findings so far: request bodies already relayed verbatim; client headers rebuilt at dispatch (beta headers dropped); upstream errors wrapped in gateway envelope (breaks client retry matching).
- `attention`: URGENT owner brief via `agent:conductor:38f44695f2ad` (`env:send:0fd2a7cf`, 02:44 UTC) — codex device-flow poll loop has zero network tolerance: 1 ETIMEDOUT aborts enrollment (owner failed 4x in a row, ~10% flaky network). Fixed as Lot 9 (retry 3 + backoff on poll and token exchange, cause+URL on exhaustion). Equal priority to mute-503 Lot 7.
- `acknowledge`: provider-cascade checked for Lot 9 — codex runs its own inline poll loop (does not use shared `runDeviceFlowUntilComplete`); sibling enrollment providers untouched, fix is codex-scoped per brief.
- `acknowledge`: Lot 7 covers owner brief `env:send:03c22edf` points 1 (per-candidate diagnostic in no-route body via `diagnostics` + `describeAvailability` + enriched account messages) and 2 (subsystem-naming messages on the three sanitized 503s) plus the integration test (real planner + expired credential). Suppression-TTL / refresh-failure diagnostic entries and the zero-account bare-message case are documented follow-ups, not silent drops.
- `attention`: Lot 7 DELIBERATELY deviates from `spec/SPEC_EVOL_LLM_GATEWAY_LOT2.md:196` (`caller-auth-unavailable` fixed message) and the main B3b pin (budget reuses pooled body): status/type/code/headers stay frozen, only the human-readable message names the subsystem. Trace-impact swept: no remaining pooled/budget equality assertion, no other package references, B3b flow test follows the mapper golden automatically. Normative spec consolidation owned by Lot N-1.

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
- Rationale: gateway+mesh wires and gaps share one contract surface and one CI gate; single test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on integrated branch only (after Lot 5, real muse + vibe CLIs pointed at local gateway).
- UAT checkpoints listed as checkboxes inside Lot 6.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/llm-gateway-muse-vibe-wires`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/llm-gateway-muse-vibe-wires` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & repro**
  - [x] Read `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` wire surface sections (2-wire surface, §3b shapes, §14 muse enrollment).
  - [x] Read `packages/llm-gateway/src/router/index.ts`, `src/wire.ts`, `src/flow.ts`, `src/router/errors.ts` (base `origin/main`).
  - [x] Read `packages/llm-mesh/src/route-planner.ts` affinity block, `src/route-health.ts`, `src/routing-targets.ts`, `src/routing-policy.ts`.
  - [x] Baselines green: mesh typecheck + 593 tests (37 files); gateway typecheck + 390 tests (28 files).
  - [x] Repro muse: bad JSON 400 live, valid muse body 401 live (wire parses, auth gates pre-pool), `GET /muse-code/models` 404 live.
  - [x] Repro vibe: default alias `mistral-medium-3.5` absent from static routes/catalog/council (code); evening 503 trigger unconfirmed.
  - [x] Measured wire facts recorded in `## Feedback Loop` (muse ELF paths, vibe Python backend, live probe statuses).
  - [x] Scope confirmed; no exception needed; worktree verified on `origin/main` `dc95f7e4f`.
- [x] **Lot 1 — Muse ingress adapter**
  - [x] `GET /muse-code/models` shares the caller-filtered catalog handler with `GET /v1/models` (legacy pool + route-planner modes, 401 pre-pool).
  - [x] Chat passthrough unchanged: `POST /v1/chat/completions` parses muse OpenAI bodies; muse models already map to the `muse` transport in mesh `routing-targets.ts`; SSE relayed verbatim (B3); no ingress header change needed.
  - [x] Unit tests: `packages/llm-gateway/tests/muse.test.ts` (new, 2 tests).
  - [x] Updated `packages/llm-gateway/tests/contract-snapshot.test.ts` (frozen inventory 5 -> 6, deliberate golden edit).
  - [x] No mesh source change required for muse dispatch (verified existing mappings).
  - [x] Lot gate green: typecheck + lint + full suite 392 passed (29 files).
- [x] **Lot 2 — Vibe routing**
  - [x] Vibe speaks OpenAI-compat `POST /v1/chat/completions` (no new ingress route needed; verified against installed CLI 2.26.1: `api_base` + `/v1`, endpoint `/chat/completions`, Bearer auth).
  - [x] Root cause of vibe failure: CLI default alias `mistral-medium-3.5` absent from mesh static routes (only `mistral-large-4` + `zai-glm-5-3` rode `mistral-vibe`).
  - [x] Added `mistral-medium-3.5` -> `{mistral, mistral-vibe}` faithful mapping in `packages/llm-mesh/src/routing-targets.ts` (propagates to canonical + candidates resolvers; no catalog profile required by `firstTargetThatResolvesProfile` fallback).
  - [x] Regression test in `packages/llm-mesh/tests/routing-targets.test.ts` (resolve + candidates), plus combined CLI-default lock (muse/vibe/cloud-code, no-repeat-request).
  - [x] Equivalence council check green (`make check-llm-model-equivalences`).
  - [x] Lot gate green: typecheck + lint + full suite 594 passed (37 files).
- [x] **Lot 3 — count_tokens on anthropic wire**
  - [x] `POST /v1/messages/count_tokens` mapped properly (no provider count seam exists; an estimator would corrupt Anthropic cache breakpoints, so no estimate is returned): parse 400, model 400, caller-auth 401 pre-pool, unknown-model frozen 404, known model provider-shaped 400 (client falls back to local counting). No lease, no metering.
  - [x] Works in legacy (`resolveTarget`) and route (`listModels` inventory) modes; scaffold mode keeps provider-shaped 501.
  - [x] Unit tests: `packages/llm-gateway/tests/count-tokens.test.ts` (new, 5 tests).
  - [x] Updated `packages/llm-gateway/tests/contract-snapshot.test.ts` (freeze 6 -> 7, wired entry; fixed mount-guard miss on POST-without-wire).
  - [x] Native provider counting left as host-transport follow-up (see Feedback Loop).
  - [x] Lot gate green: typecheck + lint + full suite 397 passed (30 files).
- [x] **Lot 4 — Mesh operational gaps**
  - [x] Gap 1: expired credential surfaces `reauth-required` (readiness + diagnostics) even before status flips; planner excludes it and the gateway answers 503 + `X-Sentropic-Route-Action` instead of silent no-route (`local-account-transport-service.ts`).
  - [x] Gap 2: lone route suppressed only by uncommitted failures degrades instead of starving 300s (`committed` stamp on `RouteFailureClassification` via attempt wrapper; `suppressedDegradable` on health; single-candidate fallback in planner). Committed failures stay strict (duplicate-dispatch risk); multi-route suppression unchanged. Deliberate contract change: `route-planner.test.ts` TTL test evolved (see Feedback Loop).
  - [x] Gap 3: affinity whose account is gone auto-drops at resolve (deleted from map) and resolves normally instead of failing closed; not-ready accounts keep fail-closed.
  - [x] Gap 4: cross-process enroll hot-reload verified pre-existing (`restorePersistedAccounts` on every serving read path + cross-instance tests); per-account model inventory fixed via catalog profile (`mistral-medium-3.5` 256K per Vibe CLI model card) so `supportedModelIds` + `/v1/models` include it (scaffold `llm-mesh-add-model` + `GWV-EX1` council exclusion + refresh).
  - [x] Cloud-code no-repeat coverage: combined CLI-default lock test (muse/vibe/cloud-code) in `routing-targets.test.ts`; agy binary absent here — real-agy UAT added to Lot 6.
  - [x] Lot gate green: typecheck + lint + full suite 598 passed (37 files) + council check green.
- [x] **Lot 5 — CI integration tests (real HTTP loopback)**
  - [x] Boot serves health + caller-filtered catalog over real `node:http` loopback (no `app.request` shortcut).
  - [x] Restart keeps serving with fresh state, no metering leak.
  - [x] Newly enrolled account served with no code change (`/muse-code/models` lists it).
  - [x] Rotated-out caller token rejected (401) while fresh token serves.
  - [x] New: `packages/llm-gateway/tests/gateway-lifecycle.test.ts` (4 tests); `verifyToken` harness override.
  - [x] CI wiring automatic (full `tests/` dir job, no workflow change).
  - [x] Lot gate: typecheck + lint clean; scoped 4/4 green (one transient SIGKILL on first scoped run, green before/after).
- [x] **Lot 9 — codex enroll device-flow network retry (URGENT owner, blocks prod enrollment)**
  - [x] `pollForCompletion` poll fetch wrapped in retry (3 retries, linear backoff on `pollIntervalMs`): transient network errors follow the 403-pending sleep-then-continue path, never abort the device flow.
  - [x] Same retry around the OAuth token-exchange POST.
  - [x] Exhaustion error carries cause (`e.cause.code`: ETIMEDOUT, ECONNRESET...) + URL, never bare `fetch failed` (`enrollment/codex.ts`).
  - [x] New: 3 tests in `tests/enrollment/codex.test.ts` (transient poll error completes; exhaustion aborts after 1+3 fetches with cause+URL; transient exchange error completes).
  - [x] Lot gate: typecheck + lint clean; scoped 5/5 green (3 new tests failed authentically pre-fix); full mesh suite 601 passed (37 files).
- [x] **Lot 7 — 503 diagnostics in body (PRIORITÉ 1 owner)**
  - [x] Mesh `RoutePlanError` carries all transport-matching diagnostics (`diagnostics`, singular `diagnostic` kept first for back-compat); planner + new read-only `describeAvailability` share one transport-resolution helper.
  - [x] Budget admission attaches availability to empty-quote no-route (new required `subject` on `admitRoute`, wired in `route-flow-core`).
  - [x] Gateway enrollment-action 503 body surfaces the mesh message (cause, expiry timestamp, repair action); messageless errors keep the old template + `X-Sentropic-Route-Action`.
  - [x] Gateway no-route 503 body appends joined per-transport causes; status/type/code/`x-should-retry: false` frozen.
  - [x] `caller-auth-unavailable` / `pooled-account-unavailable` / `budget-unavailable` bodies name their subsystem (`authentication` / `account` / `budget service temporarily unavailable`); status/type/code/headers frozen, zero account/lease/credential/pricing detail. Deliberate deviation from LOT2 spec + main B3b pin (see Feedback Loop).
  - [x] Account/auth layer messages enriched: expiry timestamp + repair action on `reauth-required` / `reenrollment-required`.
  - [x] Out of Lot 7 scope (documented, not silently dropped): negative-suppression remaining-TTL entries and refresh-failure entries are not emitted as diagnostics (no `listDiagnostics` source for them yet); a pool with zero enrolled accounts still yields the bare base message (no candidate to diagnose). Follow-up candidates for a later lot.
  - [x] Integration test: real planner + expired credential => 503 body holds account, cause, timestamp, action; new unit tests for message preference + joined no-route on both wires; mesh tests for multi-diagnostic + `describeAvailability`.
  - [x] Lot gate: typecheck + lint clean (both packages); mesh 603/603 (37 files); gateway 404/404 (31 files).
- [ ] **Lot 8 — enroll-remplace + éligibilité dégradée live**
  - [ ] Enroll A then enroll B => BOTH stay visible and serve in parallel (scope/ownership claim must ADD, not reset).
  - [ ] Investigate `atomically claim account ownership` (recent main) for the reset.
  - [ ] Live-eligibility decay (200 for 45-90 min then silent no-route, restart fixes): root-cause against Gap 1 (silent expiry at token lifetime) + Lot 7 diagnostics; host-side periodic/event reload if the mesh seam allows, else explicit error.
  - [ ] Integration tests: enroll A + enroll B parallel; boot -> serve -> invalidate live auth / advance time -> serve or explicit error.
  - [ ] Lot gate: typecheck + lint + full suites.
- [ ] **Lot 6 — UAT (real CLIs)**
  - [ ] UAT muse CLI via gateway with enrolled muse account (chat + stream; `/muse-code/models` list).
  - [ ] UAT vibe CLI via gateway with enrolled mistral-vibe account (chat + stream; default `mistral-medium-3.5`).
  - [ ] UAT agy CLI via gateway with enrolled cloud-code account (no-repeat-request proof).
  - [ ] UAT Claude Code count_tokens path (expect graceful fallback to local counting, not bare 404).
  - [ ] Record results in `## Feedback Loop`.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` (muse/vibe wires, count_tokens, gap fixes).
  - [ ] No `spec/BRANCH_SPEC_EVOL.md` needed (single-spec update).
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint for impacted packages.
  - [ ] Retest: `make test-llm-mesh ENV=test-gw-wires`, `make test-llm-gateway ENV=test-gw-wires`.
  - [ ] Pre-bump check: `npm view @sentropic/llm-mesh version`, `npm view @sentropic/llm-gateway version`; bump `packages/llm-mesh/package.json` + `packages/llm-gateway/package.json` semver (patch or minor per change).
  - [ ] Equivalence council check: `make check-llm-model-equivalences` (or CI equivalent) green.
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve blockers.
  - [ ] Final gate step 3: once UAT + CI `OK`, commit removal of `BRANCH.md`, push, merge.
  - [ ] Publish via CI OIDC (`publish-llm-mesh`, `publish-llm-gateway`); verify npm versions.
  - [ ] Mark loop `gw-muse-vibe-wires` done; reply to `agent:conductor:38f44695f2ad`.
