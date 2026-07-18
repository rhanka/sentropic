# Feature: Antigravity account transport (foundation)

## Objective
Migrate the mesh Google/Code-Assist account transport off the dead classic gemini-cli Code Assist path toward the Antigravity multi-model transport: deliver the Antigravity OAuth PKCE + refresh + project-discovery foundation, the mesh transport-id + model-fleet + pool-disjointness proof, and correctness fixes. Corrects PR #420. Owner already chose Antigravity.

## Scope / Guardrails
- Scope limited to the Antigravity OAuth/credential foundation, the mesh account-transport contract (transport id + model fleet), and the pool-disjointness regression.
- Make-only workflow, no direct Docker commands. `ENV=<env>` last argument.
- Root workspace reserved for user dev/UAT (`ENV=dev`); branch work stays in `tmp/feat-antigravity-transport`.
- Automated tests on dedicated envs (`ENV=test` / branch env), never root `dev`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/{auth.ts,catalog.ts,providers.ts,account-transports.ts,adapter-auth.ts}`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/tests/**`
  - `api/src/services/llm-account-transports.ts`
  - `api/src/services/providers/gemini-provider.ts`
  - `api/src/services/antigravity-provider-auth.ts` (NEW)
  - `api/src/routes/api/settings.ts`
  - `api/tests/unit/**`
  - root `package-lock.json`
  - `tmp/feat-antigravity-transport/BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - other `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
  - consumer test fixtures forced by the change (BR-EX with rationale)
- **Exception process**: declare `BRAG-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Environment mapping
- No service stack required for the required gates (`typecheck-llm-mesh`, `test-llm-mesh` run in standalone Node containers; `typecheck-api` runs `compose run --rm --no-deps api`).
- If api unit tests are exercised locally: `ENV=feat-antigravity`, `API_PORT=9200 UI_PORT=5400 MAILDEV_UI_PORT=1200`.

## Feedback Loop
- `attention` BRAG-EX1: The described end-to-end Antigravity migration (transport-id rename with no dual path, enrollment, runtime routing) forces edits OUTSIDE Allowed Paths — `api/src/services/provider-connections.ts` (enrollment orchestration + `resolveConnectedGeminiCodeAssistTransport` + transport-mode literals), `api/src/services/llm-runtime/index.ts` (routing + literal comparisons), `api/src/services/llm-runtime/mesh-dispatch.ts` (`createGeminiCodeAssistAccountAuthInput`) — plus a NEW `cloudcode-pa` provider runtime (`provider-registry.ts`/`provider-runtime.ts`/new provider file). A mechanical rename would also MISLABEL a still-dead runtime path (the current gemini-code-assist path routes to the `gcp` aiplatform runtime, not the Antigravity `cloudcode-pa` endpoint). Also: there is NO `startGeminiCodeAssistEnrollment` today — nothing stores such an account, so the transport is unreachable scaffolding. Decision needed: scope expansion + architecture sign-off for the runtime cutover lot. Foundation delivered without breaking `typecheck-api`; cutover escalated. No forbidden/out-of-scope files edited.
- `attention` BRAG-Q1: Confirm Antigravity OAuth `client_id`, `redirect_uri` (`http://localhost:<port>/oauth-callback`), and scopes at owner UAT (live login) — set as named constants.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal foundation lot; final gate cycle)
- Rationale: one orthogonal deliverable (Antigravity credential foundation + mesh contract); the runtime cutover is a separate escalated lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Read target + template files (claude-code / codex transports, PR #420 gemini-code-assist surface, mesh auth/catalog/providers/account-transports/adapter-auth).
  - [x] Confirm coupling of `gemini-code-assist` to out-of-scope consumers; record BRAG-EX1.
  - [x] Isolated worktree `tmp/feat-antigravity-transport` off `origin/main` (mesh 0.8.1); branch verified.

- [x] **Lot 1 — Antigravity OAuth/credential foundation (api, in-scope)**
  - [x] `api/src/services/antigravity-provider-auth.ts` (NEW): named constants (authorize/token endpoints, client_id, redirect, scopes, cloudcode-pa API base + endpoints, headers, model fleet); PKCE pair; authorize URL; code exchange; `grant_type=refresh_token` refresh (fix 2b mechanism); `loadCodeAssist` project discovery (2c); `onboardUser`; header builder; userinfo lookup.
  - [x] `api/tests/unit/antigravity-provider-auth.test.ts` (NEW, mocked fetch): PKCE/S256, authorize URL params, code exchange, refresh (reuses stored refresh token), loadCodeAssist project parse, header builder.
  - [x] Lot gate: `make typecheck-api`.

- [x] **Lot 2 — mesh contract: transport id + model fleet + disjointness (in-scope)**
  - [x] `packages/llm-mesh/src/auth.ts`: add `antigravity` to `accountTransportProviderIds` + `executableAccountTransportProviderIds` (additive; safe — `(string & {})` escape means api consumers of `gemini-code-assist` are not broken).
  - [x] `packages/llm-mesh/src/providers.ts`: export `antigravityModelFleet` (fleet ids modelled as the transport model-allowlist — NOT new mesh ProviderIds, to avoid mis-routing/invasive `satisfies Record<ProviderId>` ripple; justified in brief).
  - [x] `packages/llm-mesh/tests/antigravity-account-pool.test.ts` (NEW): pool-disjointness regression via `InMemoryAccountTransportCoordinator` — a `codex` acquire never selects an `antigravity` account and vice-versa, even when `targetProviderId` collides.
  - [x] Lot gate: `make typecheck-llm-mesh` + `make test-llm-mesh`.

- [x] **Lot 3 — Version bump + lock**
  - [x] `packages/llm-mesh/package.json` 0.8.1 -> 0.9.0.
  - [x] `make lock-root`.

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-llm-mesh`
  - [ ] `make test-llm-mesh`
  - [ ] `make typecheck-api`
  - [ ] Decision brief with BRAG-EX1 (runtime cutover scope + architecture) and BRAG-Q1 (UAT constants).

## Deferred to runtime-cutover lot (escalated — BRAG-EX1)
- Transport-id rename `gemini-code-assist` -> `antigravity` across `llm-account-transports.ts` + out-of-scope consumers (no dual path).
- Antigravity enrollment (`provider-connections.ts` start/complete/disconnect + `settings.ts` routes) — mirror claude-code.
- Wire real refresh into `refresh...TokenIfNeeded`, own-pool keying, project metadata at first-use.
- New `cloudcode-pa` provider runtime + `index.ts` routing (replaces the dead gcp-aiplatform piggyback).
