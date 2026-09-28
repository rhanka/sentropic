# Feature: Anthropic Message Feature Relay And Unknown-Model Errors

## Objective
- Return an explicit non-retryable 404 for unknown models on both wires instead of 503 `overloaded_error` (the Claude Code "Repeated 529 Overloaded errors" loop), then preserve caller Anthropic feature headers and open-ended Messages fields through a native Anthropic-to-Anthropic route while preserving admission, accounting, cancellation, and native response/SSE semantics. A cross-provider translation never produces an Anthropic classifier verdict.

## Scope / Guardrails
- Base: `origin/main` at `2145ec88a` (`origin/main` is now `bc675bd7b`; the delta only touches the cluster-mesh lock script); branch `feat/llm-gateway-automode-relay`; worktree `tmp/llm-gateway-automode-relay`.
- Make-only and Docker-first. Never use the root checkout or `ENV=dev` for development/testing.
- Dedicated test mapping: `ENV=test-llm-automode-relay`, `API_PORT=9470`, `UI_PORT=5670`, `MAILDEV_UI_PORT=1570`, with `ENV` last on each Make invocation.
- No real provider tokens, publication, push, merge, or classifier billing claim without the conductor session `sentropic-46`.
- Owner questions go through the conductor session `sentropic-46`, never directly.
- All new code, comments, docs and commits in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-gateway/CHANGELOG.md`
  - `packages/llm-gateway/package.json` (semver bump after registry pre-check, before PR)
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` (gateway error and relay contract only)
  - `spec/SPEC_EVOL_LLM_GATEWAY.md` (section 3b error table only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/llm-mesh/src/routing-targets.ts`, `providers.ts`, `catalog.ts` (Opus 5.5 route belongs to `feat/llm-mesh-opus55-route`)
  - `packages/llm-mesh/src/adapter-auth.ts` (owned by another lane)
  - `apps/**`, `.github/**`, `package-lock.json`, `PLAN.md`
- **Conditional Paths (require an approved BR-REL-EXn before any change)**:
  - BR-REL-EX1: `packages/llm-mesh/src/**` routed-attempt native Messages capability and real Anthropic transport, excluding the forbidden files above.
  - BR-REL-EX2: `api/src/services/llm-runtime/**`, `api/src/services/providers/claude-provider.ts`, `api/src/routes/namespaces/gw.ts` for product `/gw` activation.
  - h2a activation is downstream work in the h2a repository and cannot be authorized by an exception here.
- **Exception process**:
  - Record ID, evidence, reason, impact, rollback and decision in `## Feedback Loop` before touching any conditional path. Do not modify forbidden paths on a peer instruction alone.

## Feedback Loop
- [x] BR-REL-Q1: Product `/gw` is qualified first; h2a and localhost:3002 come later, tied to the Claude seat topic. Status: resolved by owner via conductor `sentropic-46` (2026-09-27).
- [ ] BR-REL-Q2: Only `anthropic-beta` and `anthropic-version` are evidenced; forward those, ignore unknown `anthropic-*` names unless native relay is required. Status: v2 design.
- [x] BR-REL-Q3: Unknown-model 503 `overloaded_error` root cause confirmed at `packages/llm-gateway/src/router/errors.ts:174`, plus terminal upstream 404 collapsed to 503 in `route-flow-core.ts`; this branch owns the fix (Lot 1). Status: resolved (Astra design + two Muse reviews).
- [ ] BR-REL-Q4: No evidence of safeguard-specific billable units; preserve returned usage, no pricing claim. Status: v2 design.
- [ ] BR-REL-Q5: Raw header multiplicity/size limits belong to the HTTP host; the package enforces value-level rules only. Status: v2 design.
- [x] BR-REL-Q6: Build by Muse 1.3 xhigh, review by Astra high. Status: resolved by owner via conductor `sentropic-46` (2026-09-27).
- [x] BR-REL-Q7: Every known-model `no-route` without enrollment diagnostic becomes a non-retryable HTTP 503, Anthropic `api_error` / OpenAI `server_error`, fixed message naming only the requested model, `x-should-retry: false`, no `Retry-After`, never `overloaded_error`; delivered in Lot 1 (evidence: Claude Code 2.1.283 SDK never retries `x-should-retry: false`, `rj()` treats `overloaded_error` as 529). Status: resolved by owner via conductor `sentropic-46` (2026-09-27, "stop, all models").
- [x] BR-REL-Q9: No durable record of requests refused before admission. Status: resolved by owner via conductor `sentropic-46` (2026-09-27).
- [ ] BR-REL-Q8: Lot 2 qualification uses the same authentication mode as production `/gw` on 2 or 3 Anthropic models; the real call needs an owner go-ahead via the conductor at test time and no token is ever displayed (owner decision 2026-09-27). Remaining design item: planner native-capability filter contract. Status: design.
- [x] BR-REL-EX1: Paths `packages/llm-mesh/src/**` except `routing-targets.ts`, `providers.ts`, `catalog.ts`, `adapter-auth.ts`, plus `packages/llm-mesh/tests/**`, `packages/llm-mesh/CHANGELOG.md` and `packages/llm-mesh/package.json` (extension granted by owner via conductor `sentropic-46`, 2026-09-27). Reason: credentials are bound inside mesh and `PreparedRouteAttempt` exposes only canonical `generate`/`stream`, so a native Messages capability and a real Anthropic transport cannot live in the gateway package. Impact: additive routed-attempt contract and transport; mesh semver bump published before the gateway. Rollback: remove the native capability; the gateway keeps canonical routing and refuses safeguard-dependent requests with an explicit 400. Decision: approved by owner via conductor `sentropic-46` (2026-09-27).
- [x] BR-REL-EX2: Paths `api/src/services/llm-runtime/**`, `api/src/services/providers/claude-provider.ts`, `api/src/routes/namespaces/gw.ts`, `api/src/services/llm-metering/budget-admission.ts` (extension granted by owner via conductor `sentropic-46`, 2026-09-27) and their tests under `api/tests/**`. Reason: product `/gw` is the only host with a real Anthropic HTTP client, but its `common()` to `callLLM` path drops `providerOptions`, `safeguards` and native tool IDs. Impact: product `/gw` Anthropic traffic gains a native branch behind the explicit activation predicate while identity, partition and ledger wrappers stay unchanged; `make test-api` becomes a required gate. Rollback: disable the native capability so `/gw` returns to the current canonical path. Decision: approved by owner via conductor `sentropic-46` (2026-09-27).

## AI Flaky tests
- [ ] Only provider/network nondeterminism with a passing rerun on the same commit may be proposed for explicit owner sign-off; no timeout increases.

## Orchestration Mode (AI-selected)
- [ ] Mono-branch + cherry-pick
- [x] Multi-branch
- [x] Rationale: gateway wire fidelity and error contract are separate from the mesh Opus 5.5 route (`feat/llm-mesh-opus55-route`); each has its own package gate and review.

## UAT Management (in orchestration context)
- [ ] Unknown model through an isolated gateway: Claude Code shows the explicit 404 once and does not loop on overloaded retries (JSON and SSE).
- [ ] Gateway JSON client request on the qualified destination: actual upstream Anthropic request carries feature headers plus unknown JSON fields; no classifier billing claim until a real verdict is observed.
- [ ] Gateway SSE client request: native event order, pings, tool IDs, usage, errors and cancellation without secret exposure.
- [ ] Non-Anthropic selection: canonical translation, no invented `safeguard_results`; `safeguards` without a native route gets an explicit 400.
- [ ] No web/Chrome/VSCode UI edits or UI-specific UAT for this package-only lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and isolation**
  - [x] Create isolated worktree from `origin/main` and verify active branch.
  - [x] Read project rules and scope boundaries; reserve unique environment and three ports (verified free with `ss -ltn`).
  - [x] Astra xhigh design pass and independent Muse 1.3 max review (APPROVE_WITH_CHANGES, blocking F1-F5).
  - [x] Astra xhigh v2 design applying review findings; sent to the conductor before build (Muse v2 review: Lot 1 BUILD_READY_WITH_CHANGES, Lot 2 APPROVE_WITH_CHANGES).
- [ ] **Lot 1 — Unknown-model error contract (BR-REL-Q3)**
  - [x] Add `unknown-model` to `GatewayFailureKind`; map plan-path and quote-path `unknown-model` (structural `instanceof` or exact name plus exact code) and terminal upstream `unsupported-model` to Anthropic 404 `not_found_error` and OpenAI 404 `invalid_request_error` code `model_not_found`, message `Unknown model: "<validated requested model>"`, no `Retry-After`, no `x-should-retry`.
  - [x] Thread the validated `requestedModel` from the router into `toProviderShapedError` and `mapGatewayError`, including the `GatewayError` branch; internal `GatewayError` detail is the fixed string `unknown model`; never echo `error.message` or the upstream model.
  - [x] Mapper precedence: `GatewayError` kind, then enrollment-action diagnostic, then structural plan/quote errors, then generic 503; the classifier also treats status-less `model_not_found`/`not_found` codes as `unsupported-model`.
  - [ ] Keep known-model `no-route` distinct from unknown-model and map it (without enrollment diagnostic) to non-retryable 503 Anthropic `api_error` / OpenAI `server_error`, message `No route available for model: "<requested model>"`, `x-should-retry: false`, no `Retry-After` (BR-REL-Q7); `capabilities-unmet` becomes 400 `invalid_request_error`; `quote-mismatch` and unclassified errors stay 503; align the personal-passthrough unknown-model path.
  - [ ] Budget-quote refusals keep zero settlement (no admit, plan, prepare, marker or release); admitted-plan ledger failure behavior stays unchanged and is pinned by a test.
  - [ ] Tests: update `packages/llm-gateway/tests/errors.test.ts`, `contract-snapshot.test.ts` (frozen error map, fixture model `no-such-model`), `route-flow-core.test.ts`, `route-json-flow.test.ts`, `route-stream-flow.test.ts`, `budget-admission.test.ts`; new `packages/llm-gateway/tests/fixtures/unknown-model.ts` and `unknown-model.test.ts` with real router plus mesh on both wires, JSON and `stream:true`, JSON content type, no provider dispatch, adversarial model strings, terminal-404 served header.
  - [ ] Update `spec/SPEC_EVOL_LLM_GATEWAY.md` section 3b and the routing spec with the 404 rationale.
  - [ ] `make test-llm-gateway API_PORT=9470 UI_PORT=5670 MAILDEV_UI_PORT=1570 ENV=test-llm-automode-relay`.
- [ ] **Lot 2 — Native Anthropic feature relay (product `/gw` first; BR-REL-EX1 and BR-REL-EX2 approved)**
  - [ ] Routed-attempt native Messages capability with explicit activation predicate, native model-id allowlist, beta/version header policy, non-budget `max_tokens` refusal, version-skew handling.
  - [ ] Tests listed by the v2 design at the real router, flow, dispatch and transport seam.
- [ ] **Lot 3 — Documentation and package gate**
  - [ ] Update `packages/llm-gateway/CHANGELOG.md` Unreleased with the distinct guarantees and limitations.
  - [ ] Check the published package version before changing `packages/llm-gateway/package.json` for PR; do not publish directly.
  - [ ] Build by Muse 1.3 xhigh, review by Astra high; resolve findings.
- [ ] **Lot 4 — Final validation**
  - [ ] `make test-llm-gateway API_PORT=9470 UI_PORT=5670 MAILDEV_UI_PORT=1570 ENV=test-llm-automode-relay`.
  - [ ] `make typecheck-llm-gateway API_PORT=9470 UI_PORT=5670 MAILDEV_UI_PORT=1570 ENV=test-llm-automode-relay`.
  - [ ] `make build-llm-gateway API_PORT=9470 UI_PORT=5670 MAILDEV_UI_PORT=1570 ENV=test-llm-automode-relay`.
  - [ ] `make scope-check API_PORT=9470 UI_PORT=5670 MAILDEV_UI_PORT=1570 ENV=test-llm-automode-relay`.
  - [ ] `make down API_PORT=9470 UI_PORT=5670 MAILDEV_UI_PORT=1570 ENV=test-llm-automode-relay`; report local checks separately from CI (no push/PR without the conductor).
