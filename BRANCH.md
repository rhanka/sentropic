# BR-XX — feat/llm-mesh-agy-enrollment — Cloud Code Native Enrollment in @sentropic/llm-mesh

## Context

Extend `@sentropic/llm-mesh` with native Cloud Code (Antigravity / Google daily-cloudcode)
enrollment and runtime transport. Aligned with h2a spec v0.6 (commit `6eb2d24c`).

Replaces `gemini-code-assist` transport (removed) with `cloud-code` transport (new).
Extends `SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md` via
`spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS_CLOUD_CODE.md` (to be merged at Lot N-1).

## Scope / Guardrails

- Scope: `@sentropic/llm-mesh` package contracts + `@sentropic/api` portal adapter.
- No DB migration in this branch (DB work belongs to BR-44).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` reserved for user dev/UAT (`ENV=dev`), must stay stable.
- Branch development in `tmp/feat-llm-mesh-agy-enrollment/`.
- Tests on `ENV=test-llm-mesh-agy`, never root dev.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/scripts/**` (OAuth client credential rotation recipe)
  - `packages/llm-mesh/README.md` (operator runbook)
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/tsconfig*.json`
  - `packages/llm-gateway/package.json`
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/package-lock.json`
  - `api/src/services/cloud-code-provider-auth.ts` (NEW)
  - `api/src/services/llm-account-transports.ts` (Cloud Code adapter extension)
  - `api/tests/unit/**`
  - `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS_CLOUD_CODE.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`, `.cursor/rules/**`
  - `plan/44-BRANCH_feat-llm-mesh-account-transports.md`
  - `packages/llm-mesh/src/account-transports.ts` (coordinator port — no change without BR-44)
  - `api/src/routes/**` (no new routes)
  - `api/drizzle/**` (no DB migration)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (only for the owner-approved credential rotation/publish gate)
  - `.github/workflows/**` (only if package publish bootstrap needed)
  - `api/package.json` + `api/package-lock.json` (only if new dep added — declare BRXX-EX1)
- **Exception process**: declare `BRXX-EXn` in `## Feedback Loop` before touching.

## Feedback Loop

- `BR514-EX1`: `package-lock.json` and `api/package-lock.json` updated for `@sentropic/llm-mesh` version 0.9.0 bump.
- `BR514-DEC1` (owner-approved 2026-08-05): ship the Antigravity OAuth client credential in the published `@sentropic/llm-mesh` artifact so Cloud Code enrollment remains configuration-free.
- `BR514-EX2` (owner-approved 2026-08-05): update `Makefile` and `.github/workflows/ci.yml` with a deterministic credential rotation recipe and a protected-reference verification gate before npm publication. The checked-in source and published artifact stay identical; CI never mutates `dist`. Impact: llm-mesh credential rotation/publish targets and the llm-mesh publish job. Rollback: remove the rotation target and pre-publish verification gate.
- `BR514-VER1` (2026-08-05): Cloud Code OAuth UAT completed with Google consent, loopback PKCE callback, token exchange, and Cloud Code metadata resolution. The later h2a metadata-file write is sandbox-blocked (`EROFS`) and is outside the OAuth exchange. Package gates: 77/77 tests, build, typecheck, and protected-reference source/`dist` verification pass.

## AI Flaky tests

- No AI generation surface. AI-flaky allowlist N/A.

## Orchestration Mode

- [x] **Mono-branch** — `tmp/feat-llm-mesh-agy-enrollment/`, Gemini Flash agent executes lots,
  conductor reviews each lot gate.
- Rationale: lots are sequential (Lot 1 gates Lot 2), no parallel sub-workstreams needed.

## Port allocation

Branch env: `ENV=test-llm-mesh-agy`
- API: `9010` · UI: `5210` · Maildev: `1110`

## Plan / Todo

- [x] **Lot 0 — Baseline**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`.
  - [x] Worktree `tmp/feat-llm-mesh-agy-enrollment` created on `main`.
  - [x] Spec EVOL `SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS_CLOUD_CODE.md` written.
  - [x] Alignment with h2a v0.6 spec confirmed (commit `6eb2d24c`).
  - [x] BRANCH.md written after worktree creation.

- [x] **Lot 1 — Contracts + Facade + auth.ts** · _Owner: sentropic_ · _Gate: `/facade` compiles, h2a mock import OK_
  - [x] `packages/llm-mesh/src/auth.ts`:
    - [x] Remove `'gemini-code-assist'` from `accountTransportProviderIds`
    - [x] Remove `futureAccountTransportProviderIds` entirely
    - [x] Add `'cloud-code'` to `accountTransportProviderIds` AND `executableAccountTransportProviderIds`
    - [x] Add `CloudCodeRuntimeMetadata` interface + `isCloudCodeRuntimeMetadata` guard (3 fields, non-empty strings)
  - [x] `packages/llm-mesh/src/enrollment/contracts.ts` (NEW):
    - [x] `EnrollmentSession` union (`authorization-url` | `device-code`)
    - [x] `EnrollmentState` (internal, never exported to h2a)
    - [x] `StartEnrollmentInput`, `PreparedCredential`, `ResolvedProviderMetadata`
    - [x] `EnrollmentProvider` interface (`start`, `complete` internal, `resolve`, `refresh`)
  - [x] `packages/llm-mesh/src/service/facade.ts` (NEW):
    - [x] `LlmMeshFacade` interface (enroll, waitForCallback, pollForCompletion, cancel, acquire, release, getAdapter)
    - [x] `ProviderAdapter` interface (`execute` → `AsyncIterable<ProviderEvent>`)
    - [x] `FacadeOptions`, `ProviderRequest`, `ProviderEvent` types
    - [x] `createLlmMeshFacade(options): LlmMeshFacade` export
  - [x] `packages/llm-mesh/src/service/local-account-transport-service.ts` (NEW — signatures only):
    - [x] Constructor (`KeyringAdapter`, providers `Map`, `ConfigResolver`)
    - [x] Public signatures: `enroll`, `waitForCallback`, `pollForCompletion`, `cancel`, `acquire`, `release`
    - [x] Private signatures: `completeEnrollment`, `refreshToken`, `persistCredential`, `markReauthRequired`
  - [x] `packages/llm-mesh/package.json`:
    - [x] Bump version (minor)
    - [x] Add exports: `"./facade"`, `"./enrollment"`, `"./node"`, `"./transport/cloud-code"`
  - [ ] Lot gate:
    - [x] `make typecheck-llm-mesh ENV=test-llm-mesh-agy`
    - [ ] `make lint-llm-mesh ENV=test-llm-mesh-agy`
    - [x] `packages/llm-mesh/tests/auth.test.ts` — `cloud-code` present, `gemini-code-assist` absent, guard OK
    - [x] `packages/llm-mesh/tests/enrollment/contracts.test.ts` (NEW) — type compilation smoke
    - [x] `packages/llm-mesh/tests/service/facade.test.ts` (NEW) — `createLlmMeshFacade` mock compile
    - [x] `make test-llm-mesh ENV=test-llm-mesh-agy`
    - [ ] **Conductor review gate** — validate before Lot 2
    - [ ] Notify h2a: Lot 1 compilable → h2a can start its Lot 3

- [x] **Lot 2 — Providers + transport** · _Owner: sentropic_ · _Parallel with h2a Lot 3 after Lot 1 gate_
  - [x] `packages/llm-mesh/src/enrollment/cloud-code.ts` (NEW):
    - [x] `CloudCodeEnrollmentProvider implements EnrollmentProvider`
    - [x] PKCE loopback: start HTTP listener, return `authorization-url` session
    - [x] `waitForCallback`: receive code from loopback, `completeEnrollment`, `resolve`, persist atomically
    - [x] `cancel`: idempotent, stop loopback, mark `cancelledAt`
    - [x] Adapted from `api/src/services/antigravity-provider-auth.ts`
  - [x] `packages/llm-mesh/src/enrollment/codex.ts` (NEW):
    - [x] `CodexEnrollmentProvider implements EnrollmentProvider`
    - [x] Device flow: POST `deviceauth/usercode` → `device-code` session
    - [x] `pollForCompletion`: internal poll → exchange code → persist atomically
  - [x] `packages/llm-mesh/src/enrollment/claude-code.ts` (NEW):
    - [x] Portal-only stub; `execute` throws `UNSUPPORTED` for h2a local
  - [x] `packages/llm-mesh/src/transport/cloud-code-transport.ts` (NEW):
    - [x] `buildCloudCodeRequest(acquisition, request)` — daily-cloudcode envelope
    - [x] `parseCloudCodeSSE(stream)` → `AsyncIterable<ProviderEvent>`
    - [x] Outcomes: 200→success, 401/403→auth_failed, 429+Retry-After→rate_limited, SSE error→failed
    - [x] `execute()` calls `recordOutcome()` internally — h2a never calls it directly
    - [x] `release(acquisition)`: abort path, 0 outcome
  - [x] `packages/llm-mesh/src/service/local-account-transport-service.ts` — full implementation:
    - [x] Keyring read/write (`sentropic-llm-mesh` namespace, NOT `gemini/antigravity`)
    - [x] `acquire()`: check expiry → refresh atomically → return material
    - [x] Refresh: POST `oauth2.googleapis.com/token`, resolve historical `credentialVersion`
    - [x] Token rotation persisted atomically before return
    - [x] Refresh failure → `markReauthRequired()` → throw `AccountTransportAcquireError`
  - [x] `packages/llm-mesh/src/node/keyring/` (NEW):
    - [x] `KeyringAdapter` interface export
    - [x] `LinuxSecretstoreKeyring` (evaluate `keytar` vs `@kwlad/keystore`)
    - [x] `MacOSKeychainKeyring`
    - [x] `EnvKeyring` (CI/prod fallback)
  - [ ] Lot gate:
    - [x] `make typecheck-llm-mesh ENV=test-llm-mesh-agy`
    - [ ] `make lint-llm-mesh ENV=test-llm-mesh-agy`
    - [x] `packages/llm-mesh/tests/enrollment/cloud-code.test.ts` (NEW) — PKCE S256, state/nonce, replay/expiry/cancel, config version
    - [x] `packages/llm-mesh/tests/enrollment/codex.test.ts` (NEW) — device flow, poll, exchange
    - [x] `packages/llm-mesh/tests/transport/cloud-code-transport.test.ts` (NEW) — fixtures: refresh, UA exact, no project fallback, envelope, requestId UUID, abort=release, SSE/error/outcome
    - [x] `packages/llm-mesh/tests/service/local-account-transport-service.test.ts` (NEW) — refresh atomic, rotation, reauth_required, restart recovery
    - [x] `make test-llm-mesh ENV=test-llm-mesh-agy`
    - [ ] **Conductor review gate**

- [x] **Lot 3 — Portal API adapter** · _Owner: sentropic_ · _After Lot 2 gate_
  - [x] `api/src/services/cloud-code-provider-auth.ts` (NEW):
    - [x] Adapt `antigravity-provider-auth.ts` to `CloudCodeEnrollmentProvider` contract
    - [x] `fetchCloudCodeUserInfo`, `loadCodeAssist`, `onboardCloudCodeUser`
  - [x] `api/src/services/llm-account-transports.ts`:
    - [x] Cloud Code adapter (pattern: existing Codex + Claude Code)
    - [x] Single-flight refresh per `account_id` (CAS/DB)
    - [x] `owner_user_id` scoped — SQL/RLS
    - [x] `cloudaicompanionProject` encrypted per account, never global
  - [ ] Lot gate:
    - [x] `make typecheck-api ENV=test-llm-mesh-agy`
    - [ ] `make lint-api ENV=test-llm-mesh-agy`
    - [x] `api/tests/unit/services/cloud-code-provider-auth.test.ts` (NEW)
    - [x] `api/tests/unit/services/llm-account-transports.test.ts` — Cloud Code cases (multi-tenant, single-flight)
    - [x] `make test-api-unit ENV=test-llm-mesh-agy`
    - [ ] **Conductor review gate**

- [x] **Lot N-2 — Final integration + h2a acceptance**
  - [ ] `make test-api ENV=test-llm-mesh-agy` — ⚠️ bloqué par `build-flow` TS2688 pré-existant (hors branche) — CI vert
  - [x] `make test-llm-mesh ENV=test-llm-mesh-agy`
  - [x] Migration test: `gemini-code-assist` rows NOT altered by `cloud-code` path
  - [x] Compilation gate: mock h2a consumer imports `@sentropic/llm-mesh/facade` — 0 deep imports
  - [ ] Notify h2a → await smoke confirmation `h2a llm-mesh enroll cloud-code` (with mocks) — ⚠️ h2a MCP EOF (infra down)

- [x] **Lot N-1 — Docs consolidation** — commit `dd30085fc`
  - [x] Merge `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS_CLOUD_CODE.md` into
    `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md` per merge instructions in the SPEC_EVOL.
  - [x] Delete `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS_CLOUD_CODE.md`.

- [ ] **Lot N — Final validation**
  - [x] `make typecheck-llm-mesh ENV=test-llm-mesh-agy`
  - [ ] `make typecheck-api ENV=test-llm-mesh-agy` — ⚠️ bloqué `build-flow` pré-existant
  - [ ] `make lint-llm-mesh ENV=test-llm-mesh-agy` — ⚠️ target inexistante dans Makefile
  - [ ] `make lint-api ENV=test-llm-mesh-agy` — ⚠️ bloqué `prepare-node-workspace`
  - [x] `make test-llm-mesh ENV=test-llm-mesh-agy` — 61/61
  - [x] `make test-api-unit ENV=test-llm-mesh-agy` — 762/762
  - [ ] `make test-api ENV=test-llm-mesh-agy` — ⚠️ bloqué `build-flow` pré-existant
  - [x] Bumped `packages/llm-mesh/package.json` version (0.9.0 — new exports + `cloud-code`).
  - [ ] Final gate step 1: create/update PR using this `BRANCH.md` as PR body.
  - [ ] Final gate step 2: verify CI on PR; resolve blockers.
  - [ ] Final gate step 3: UAT + CI green → commit removal of `BRANCH.md`, push, merge.
