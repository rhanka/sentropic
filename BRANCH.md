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
- `FL-1` `acknowledge`: llm-mesh public selection surface is `AccountTransportCoordinator.acquire()` (+ `InMemoryAccountTransportCoordinator`), NOT an exported `selectAccount` (that name is a private method on the in-memory coordinator). The gateway consumes `acquire()` as "personal-pool selection over llm-mesh". No code change needed; recorded so Lot 2 wires the correct symbol.
- `FL-2` `acknowledge`: root workspace `node_modules/@sentropic/llm-mesh` resolves to root's STALE `packages/llm-mesh@0.2.0` (missing `ClaudeCodeAccountAuthMaterial` / `AccountTransportCoordinator`). Typecheck/test in this lot were run against the worktree's freshly-built llm-mesh `0.5.0` dist (isolated, then removed). Lot 2 CI runs on the branch where the workspace resolves the correct version.
- `FL-3` `deferred`: F2/F3 (Layer-A follow-ups) touch `api/**` (Forbidden here) → a SEPARATE branch/lot. Scoped below, NOT implemented this branch.
- `FL-4` `attention`: the wire contract is NOT frozen-final until the contract double-review gate (Opus 4.8max + Codex 5.5xhigh + BR-46 contract-snapshot + architect sign) AND owner re-confirm (new package). Until then `/v1/*` stays a v0 scaffold.

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

- [ ] **Lot 2 — Real personal-passthrough flow (v0)**
  - [ ] Caller-auth: concrete `CallerAuthPort` via `auth-hono` service-auth-middleware (Bearer OIDC/session + DPoP S2S); resolve `CostContext` from the VERIFIED identity (never the body).
  - [ ] Pool: concrete `PoolStatePort` over a real personal pool (1 caller = own enrolled accounts) using llm-mesh `AccountTransportCoordinator.acquire()` + sticky binding (NO silent rebind; short tx; no lock during streams).
  - [ ] Secret resolve: concrete `AuthResolver` (refresh-under-lock, gateway-owned); hooks/logs receive REDACTED descriptors only.
  - [ ] Dispatch: concrete `GatewayDispatchPort` over llm-mesh; FAITHFUL provider-compat passthrough (request body verbatim, response JSON verbatim, SSE framing).
  - [ ] SSE fixtures: Anthropic SSE (`event:`/`data:` → `message_stop`) vs OpenAI (`data:` → `[DONE]`).
  - [ ] Error mapping (spec §3b): 401 caller-auth, 429 over-budget + `Retry-After`, 429/503 no-eligible-account, 502/503 pooled-account-unavailable, 400 bad-request — provider-shaped, never leak pool internals.
  - [ ] Bump `packages/llm-gateway/package.json` version (src changed → enforce-package-bump).
  - [ ] Lot gate:
    - [ ] Package typecheck + unit tests (`make test-packages` / `test-pkg-llm-gateway` once a target exists; target add = a Makefile change → own conductor-approved step).
    - [ ] Fixture-based contract tests for both wires.

- [ ] **Lot 3 — Contract double-review GATE (before any publish)**
  - [ ] Double adversarial review of the frozen wire: Opus 4.8max + Codex 5.5xhigh.
  - [ ] BR-46 contract-snapshot of `/v1/{messages,chat/completions,models}` + health.
  - [ ] Architect sign-off on the frozen wire (`claude:architect:29d97a48f361` reviews spec §7 line-by-line + the surface).
  - [ ] Owner re-confirm (new package publish authorization).
  - [ ] On GO only: bootstrap publish (`workflow_dispatch` `bootstrap_publish_target=llm-gateway`) + attach OIDC trusted publisher on npmjs.com.

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
