# Feature: Opus 5 default + launch-alias target-map + route discovery

## Objective
Make **Opus 5** the default Opus across `@sentropic/llm-mesh` and `@sentropic/llm-gateway`, and fix the ROOT CAUSE of h2a's duplicated routing table: the gateway had no way to EXPOSE its alias→target mapping, so consumers copied it. Ship (1) `claude-opus-5` in the mesh catalog + a `max` reasoning-effort rung, (2) a DECLARATIVE launch-alias config + a `describeTargetRoutes()` discovery API in the gateway, (3) removal of the deprecated `resolveGeminiCodeAssistTarget` (the claude->gemini/Vertex cross-pool leak retired on the mesh side by the 0.10.0 cutover).

Owner-ratified mapping (2026-07-25): `claude-opus-5-high|-xhigh` -> `gpt-5.6-terra` (same effort); `claude-fable-5-high|-xhigh|-max` -> `gpt-5.6-sol` (same effort). SUFFIXED aliases only — bare ids stay provider-faithful.

## Scope / Guardrails
- Two published packages: `llm-mesh` (0.11.0 -> **0.12.0**; 0.11.0 is already ON npm, bumping to it would silently skip the publish) and `llm-gateway` (0.9.0 -> **0.10.0**).
- No silent cross-pool fallback: unknown id -> `undefined` -> router provider-shaped 400.
- The FROZEN v1 wire (ARCH-12, `/v1/messages`, `/v1/chat/completions`, `/v1/models`) is NOT touched; discovery is a programmatic package API, not a new route.
- Make-only; `ENV=test-*` last; `make commit` only; English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `packages/llm-gateway/src/**`, `packages/llm-gateway/tests/**`, `packages/llm-gateway/package.json`, `packages/llm-mesh/src/{providers,catalog,generation}.ts`, `packages/llm-mesh/package.json`, `package-lock.json`, `tmp/fix-gw-terra-alias/BRANCH.md`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, other `plan/NN-BRANCH_*.md`, `api/src/**` and `api/tests/**` beyond `BRGW-EX1`.
- **Conditional**: `.github/workflows/**` (untouched).
- **`BRGW-EX1`** (scope exception): the MECHANICAL api consequences of adding a catalog model, needed to keep CI green — `api/tests/api/models.test.ts` (anthropic model list + total count 19->20), `api/tests/unit/claude-provider.test.ts` (Claude model count 3->4 + Opus 5 assertions), `api/tests/unit/llm-runtime-stream.test.ts` (the repo invariant 'a stream fixture for EVERY advertised model' — a new catalog model without a fixture fails the suite by design), and `api/src/services/chat-service.ts` (`MODEL_CONTEXT_BUDGETS` for `claude-opus-5`, else it silently falls back to the default budget). Rationale: consequences of MY package change, not product decisions. Impact: 4 files. Rollback: revert the hunks. The PRODUCT default migration for client apps is explicitly NOT in scope (see Feedback Loop).

## Feedback Loop
- Owner decisions (2026-07-25, Q&A): (1) suffixed aliases only — bare `claude-opus-5` stays the real Anthropic model, so the gateway can still serve it under its own name; (2) add `max` to the mesh effort ladder (real rung, not a lie); (3) keep `claude-opus-4-8` selectable in the catalog, migrate only the DEFAULT for client apps; (4) ship mesh + gateway together in this PR.
- Owner steer: "il faut que llm-mesh et llm-gateway aient des méthodes d'exposition des catalogues et configurations de mapping pour permettre aux skills de s'y retrouver" -> hence `defineLaunchAliases()` (declare, don't hardcode) + `describeTargetRoutes()` (discover, don't duplicate). The mesh catalog was ALREADY exposed (`listModelProfiles`/`getModelProfile`); the gateway routing was NOT — that was the actual gap behind h2a's copy.
- **attendu (`claude:sentropic-app`)**: migrate the CLIENT-APP default Opus to `claude-opus-5` for sentropic.sent-tech.ca (product default / user choice simplification). Deliberately not done here — it is a product default, not a package concern.
- **attendu (`claude:a2a-cli`)**: the launch alias changed from `claude-opus-4-8[-xhigh]` to `claude-opus-5-{high,xhigh}` (+ fable/sol). h2a must consume `describeTargetRoutes()` and delete `model-catalog.ts`/`resolveModelRoute` rather than re-hardcode.
- Deferred: gateway dep pin `@sentropic/llm-mesh` `^0.8.0` -> `^0.12.0`. Not functionally required (the target-map routes by string id, not mesh catalog resolution) and forcing it triggers a repo-wide relock of main's pre-existing lockfile drift — belongs in a dedicated lockfile-hygiene branch.

## AI Flaky tests
- None in scope: pure routing/catalog unit tests, deterministic.

## Orchestration Mode
- [x] Mono-branch. Rationale: one coherent contract change across two packages; single test cycle.

## Plan / Todo
- [x] mesh: add `claude-opus-5` (`providers.ts` known ids + anthropic map, `catalog.ts` profile "Opus 5"); keep 4.8 selectable with a comment.
- [x] mesh: add `max` to the effort ladder (`ReasoningEffort` type + `ReasoningOptions.effort`); verified no exhaustive effort switch exists in adapters.
- [x] mesh: bump 0.11.0 -> 0.12.0 + align the lockfile entry (main's lockfile still said 0.10.0 — pre-existing drift).
- [x] gateway: `effort?` on `TargetMapping`/`ResolvedTarget`/`GatewayDispatchRequest`, threaded into both dispatch paths.
- [x] gateway: `defineLaunchAliases()` declarative builder + owner-ratified preset (opus-5 -> terra, fable-5 -> sol) + faithful DEFAULT map incl. `claude-opus-5`/`claude-fable-5`/`gpt-5.6-sol`.
- [x] gateway: `describeTargetRoutes()` discovery API (faithful vs alias, effort, no credential data).
- [x] gateway: DELETE `resolveGeminiCodeAssistTarget` + `GeminiCodeAssistTarget` + the unused test fixture remnant.
- [x] `BRGW-EX1`: api model-list assertion + `claude-opus-5` context budget.
- [x] Gates: `typecheck-llm-mesh`, `test-llm-mesh` (45), `typecheck-llm-gateway`, `test-llm-gateway` (83) — all green.
- [ ] CI green; double-review; owner confirm; publish `llm-mesh@0.12.0` + `llm-gateway@0.10.0`; hand versions + discovery contract to h2a; relay the client-app default to `claude:sentropic-app`.
