# Feature: Antigravity Cutover — cloudcode-pa runtime + enrollment + native-first routing

## Objective
Complete the Antigravity cutover: build the NEW `cloudcode-pa` provider runtime (distinct 3rd Google endpoint), wire Antigravity account enrollment + own transport pool, implement native-family-first / explicit-grant-override routing with Antigravity as multi-family fallback, and DELETE the dead `gemini-code-assist` path (zero dual path).

## Scope / Guardrails
- Scope limited to the LLM provider runtime + account-transport + routing surface (api + `@sentropic/llm-mesh`).
- No `api/drizzle/*.sql` migration (Antigravity reuses `llm_provider_accounts` with `target='cloudcode-pa'`, `transport='antigravity'`).
- Make-only workflow, `ENV` last argument, `make commit` only.
- Root workspace reserved for user dev/UAT (`ENV=dev`); branch work in `tmp/feat-antigravity-cutover`.
- Test campaigns on `ENV=test-antigravity-cutover` (API 9210 / UI 5410 / MAILDEV 1210), never on root `dev`.
- All new text in English. Personal-passthrough invariant: the enrolled account EXECUTES the request; never relay the account token as a generic bearer. Cross-user pooling stays behind ToS-D0 kill-switch (NOT enabled).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/provider-connections.ts`
  - `api/src/routes/api/settings.ts`
  - `api/src/services/llm-account-transports.ts`
  - `api/src/services/llm-runtime/index.ts`
  - `api/src/services/llm-runtime/mesh-dispatch.ts`
  - `api/src/services/provider-registry.ts`
  - `api/src/services/providers/*` (NEW `cloudcode-pa-provider.ts`)
  - `api/src/services/antigravity-provider-auth.ts`
  - `packages/llm-mesh/src/{auth.ts,providers.ts,catalog.ts,adapter-auth.ts,account-transports.ts}`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
  - `api/tests/**`
  - root `package-lock.json`
  - `tmp/feat-antigravity-cutover/BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql` (NOT used — no migration)
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `BRAG-EX1` (`attention`): the cutover crosses the Antigravity FOUNDATION's Allowed Paths (`packages/llm-mesh/src/{auth.ts,providers.ts}`, `api/src/services/antigravity-provider-auth.ts`, `packages/llm-mesh/tests/**`). Rationale: the cutover MUST remove `gemini-code-assist` from `auth.ts` and build the runtime/pool on the foundation's OAuth module — same lane, sequential to the merged foundation. Impact: mesh minor bump 0.9.0→0.10.0. Rollback: revert branch; foundation stays intact on main.
- `BRAG-Q1` (`attention`): Antigravity OAuth placeholders (`ANTIGRAVITY_CLIENT_ID`, `ANTIGRAVITY_DEFAULT_REDIRECT_PORT=8790`, `ANTIGRAVITY_CLIENT_VERSION=0.1.0`) are NAMED CONSTANTS to confirm at owner live-login UAT.
- `BRAG-Q2` (`attention`): D3 explicit-grant binding storage. Implemented as a documented SEAM (`resolveExplicitAccountGrant` returns null → pure native-first/antigravity-fallback). A persistent grant table (composite key userId[,workspaceId][,agentId]) is deferred pending owner decision on storage shape (settings-kv vs new table+migration).

## AI Flaky tests
- No AI-generation tests in scope (provider-runtime + routing are deterministic unit-tested). AI flaky allowlist not exercised.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal cutover; single final test cycle)
- [ ] **Multi-branch**
- Rationale: one coherent cutover across api + one package; no independent CI needed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules (MASTER/workflow/subagents/testing) + BRANCH_TEMPLATE.
  - [x] Read foundation (antigravity-provider-auth, mesh auth/providers, pool test), templates (claude-code/codex), runtime pattern (gemini/gcp provider), dead path (gemini-code-assist).
  - [x] Worktree `tmp/feat-antigravity-cutover` on `feat/antigravity-cutover` from `origin/main`; branch verified.
  - [x] Env mapping: `ENV=test-antigravity-cutover` API 9210 / UI 5410 / MAILDEV 1210.
  - [x] Design decision: `cloudcode-pa` runtime is an api-local registry provider (NOT a mesh ProviderId) → zero mesh catalog ripple, honors foundation's no-fleet-catalog-keys; Antigravity dispatch is DIRECT (bypasses mesh `selectModel`, which rejects non-catalog fleet ids).

- [x] **Lot 1 — mesh cutover (delete gemini-code-assist id + bump)**
  - [ ] `packages/llm-mesh/src/auth.ts`: remove `'gemini-code-assist'` from `accountTransportProviderIds`; delete `futureAccountTransportProviderIds` (empty after cutover).
  - [ ] `packages/llm-mesh/tests/auth.test.ts`: retarget the planned/not-executable test to `antigravity`.
  - [ ] `packages/llm-mesh/tests/antigravity-account-pool.test.ts`: keep disjointness proof; add `cloudcode-pa` target-id variant.
  - [ ] `packages/llm-mesh/package.json`: `0.9.0` → `0.10.0`; `make lock-root`.
  - [ ] Lot gate: `make typecheck-llm-mesh` + `make test-llm-mesh`.

- [ ] **Lot 2 — cloudcode-pa runtime + registry (api)**
  - [ ] `api/src/services/providers/cloudcode-pa-provider.ts`: NEW `CloudCodePaProviderRuntime` (v1internal generate/stream, project injection, Antigravity headers, bearer, SSE unwrap).
  - [ ] `api/src/services/provider-registry.ts`: register runtime + `RuntimeProviderId` (`ProviderId | 'cloudcode-pa'`); NOT surfaced in listProviders/listModels.
  - [ ] `api/tests/unit/cloudcode-pa-provider.test.ts`: isolation test (URL, headers, project wrapper, SSE unwrap).
  - [ ] Lot gate: `make typecheck-api`; scoped `test-api-unit SCOPE=cloudcode-pa`.

- [ ] **Lot 3 — Antigravity transport pool + enrollment (api); delete gemini-code-assist transport**
  - [ ] `api/src/services/llm-account-transports.ts`: add Antigravity store/getPrimary/disconnect/acquire/refresh (real refresh via `refreshAntigravityAccessToken`; project in metadata); DELETE all `GeminiCodeAssist*`.
  - [ ] `api/src/services/provider-connections.ts`: add Antigravity enrollment (start/complete/disconnect/import) + `resolveConnectedAntigravityTransport` + `resolveAntigravityFallbackTransport` + `resolveExplicitAccountGrant` seam; DELETE `resolveConnectedGeminiCodeAssistTransport` + `gemini-code-assist` transport mode.
  - [ ] `api/src/routes/api/settings.ts`: add `/provider-connections/antigravity/enrollment/{start,complete,disconnect,import}`.
  - [ ] `api/src/services/llm-runtime/mesh-dispatch.ts`: DELETE `createGeminiCodeAssistAccountAuthInput`.
  - [ ] Lot gate: `make typecheck-api`.

- [ ] **Lot 4 — routing integration (native-first + antigravity fallback)**
  - [ ] `api/src/services/llm-runtime/index.ts`: replace both `geminiCodeAssistTransport*` blocks (non-stream + stream) with Antigravity fallback dispatch to `cloudcode-pa`; remove dead import.
  - [ ] Lot gate: `make typecheck-api`.

- [ ] **Lot 5 — tests + final validation**
  - [ ] `api/tests/**`: Antigravity enrollment + routing precedence tests; verify provider-count assertions unchanged (api-local approach keeps listProviders=7).
  - [ ] Proof: `grep -rn gemini-code-assist` = 0 refs in scope.
  - [ ] Full gates: `make typecheck-api` + `make typecheck-llm-mesh` + `make test-llm-mesh` + scoped api-unit on `ENV=test-antigravity-cutover`.
  - [ ] Bump confirmed (`packages/llm-mesh` 0.10.0) + `make lock-root`.
  - [ ] PR from BRANCH.md; CI green; remove BRANCH.md; push.
