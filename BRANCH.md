# Feature: llm-gateway Terra launch-alias target-map + drop gemini-code-assist

## Objective
Make `@sentropic/llm-gateway` the single source of truth for the Claude-compat launch-alias routing (`claude-opus-4-8` and `claude-opus-4-8-xhigh` -> `openai:gpt-5.6-terra`, effort `xhigh`), remove the deprecated `resolveGeminiCodeAssistTarget` (the claude->gemini/Vertex cross-pool leak the mesh 0.10.0 cutover retired on the mesh side), and bump the package — so h2a becomes a thin consumer and deletes its duplicated `model-catalog.ts`/`resolveModelRoute`. The `@sentropic/llm-mesh` dep pin bump `^0.8.0` -> `^0.10.0` is DEFERRED (not functionally required: the target-map routes by string model id, not mesh catalog resolution; forcing it triggers a repo-wide lockfile relock of main's pre-existing drift, which belongs in a dedicated lockfile-hygiene branch, not this routing PR).

## Scope / Guardrails
- `@sentropic/llm-gateway` package only (routing target-map + dispatch effort contract + version/pin). No mesh catalog change (mesh stays provider-faithful).
- No silent cross-pool fallback: unknown alias -> `undefined` -> router provider-shaped 400 (already the `createStaticTargetResolver` behavior).
- Make-only; branch in `tmp/fix-gw-terra-alias`; `ENV=test-*` last argument; `make commit` only; English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `packages/llm-gateway/src/personal-passthrough/target.ts`, `packages/llm-gateway/src/flow.ts`, `packages/llm-gateway/src/ports/dispatch.ts`, `packages/llm-gateway/tests/**`, `packages/llm-gateway/package.json`, `package-lock.json`, `tmp/fix-gw-terra-alias/BRANCH.md`.
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `packages/llm-mesh/**`, any `api/**`, other `plan/NN-BRANCH_*.md`.
- **Conditional**: `.github/workflows/**` (not expected).

## Feedback Loop
- Cross-owner coordination with h2a conductor `claude:a2a-cli:5236a0213b83`: split CONFIRMED (alias routing lives in the gateway target-map, NOT the mesh catalog). h2a deletes `model-catalog.ts`/`resolveModelRoute` in the same PR that consumes the published gateway version.
- Consumer entry point: `createStaticTargetResolver({ mappings: { ...DEFAULT_TARGET_MAPPINGS, ...LAUNCH_ALIAS_TARGET_MAPPINGS } })` returning `ResolvedTarget { providerId, transportProviderId, model, effort? }`.

## AI Flaky tests
- No AI-generation tests in scope (pure routing/contract unit tests; deterministic).

## Orchestration Mode
- [x] Mono-branch. Rationale: single package routing change, one test cycle.

## Plan / Todo
- [x] Add `effort?` to `ResolvedTarget` (flow) + `GatewayDispatchRequest` (dispatch port); thread `target.effort` into both dispatch requests.
- [x] `target.ts`: add `effort?` to `TargetMapping`; expose it in `createStaticTargetResolver`; refresh `DEFAULT_TARGET_MAPPINGS` to cutover ids (faithful); add `LAUNCH_ALIAS_TARGET_MAPPINGS` (terra launch aliases); DELETE `resolveGeminiCodeAssistTarget` + `GeminiCodeAssistTarget`.
- [x] Remove the unused `createGeminiCodeAssistFixture` test remnant.
- [x] `tests/target.test.ts`: alias -> terra xhigh, unknown -> undefined, faithful DEFAULT preserved.
- [x] `package.json`: `0.9.0` -> `0.10.0` (minimal 1-line lockfile version bump; pin stays `^0.8.0`, see Objective).
- [x] Gates: `typecheck-llm-gateway` + `test-llm-gateway` (79 tests green).
- [ ] Double-review + PR; owner confirm; publish `@sentropic/llm-gateway@0.10.0`; hand version to h2a conductor.
