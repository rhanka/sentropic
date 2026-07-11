# Feature: BR-39e Lot 1 — OAuth federation broker core + Google provider

## Objective
Add upstream RP federation to the Sentropic IdP: `/auth/federation/:provider/{start,callback}` broker routes plus a Google OIDC provider, minting the IdP's own session (broker model, D1) with SAFE linking (D6/D7/D8) and full CSRF/nonce/PKCE/session-rotation hardening (D5/D10/D11).

## Scope / Guardrails
- Scope limited to `api/src/routes/auth/**`, `api/src/services/auth/**`, `api/src/config/env.ts`, `api/package.json`, api tests.
- No new migration (Lot 0 tables `identities` + `federation_flow_states` suffice).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/br39e-lot1`.
- Automated test campaigns on `ENV=feat-br39e-lot1`, never on root `dev`.
- `ENV=<env>` passed last in every `make` command.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/routes/auth/federation.ts`
  - `api/src/routes/auth/index.ts`
  - `api/src/services/auth/federation/**`
  - `api/src/config/env.ts`
  - `api/package.json`
  - `package-lock.json`
  - `api/package-lock.json`
  - `api/tests/unit/auth/federation-broker.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/drizzle/**` (no new migration)
  - `apps/**`, `packages/auth-ui/**`, `packages/design-system*/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `packages/auth-hono/src/**` (only if a broker helper genuinely belongs in the lib — not used; kept api-side)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## AI Flaky tests
- none (no AI paths in scope)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single orthogonal lot on the api federation surface; one test cycle.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `spec/SPEC_EVOL_39E_SOCIAL_FEDERATION.md` (D1..D18) + Lot 0 code (ports, resolver, adapter, oauth seam, session).
  - [x] Confirm isolated worktree `tmp/br39e-lot1` on `feat/br39e-lot1-broker-google`.
  - [x] Env mapping: `ENV=feat-br39e-lot1`, `API_PORT=9330`, `REGISTRY=local`.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Broker core + Google**
  - [x] Add `arctic` to api (`make install-api NPM_LIB=arctic`); use `jose` for id_token verification (no `oslo`).
  - [x] `federation/types.ts`: `FederationProvider` interface + broker request/result types.
  - [x] `federation/broker.ts`: `createFederationBroker` — start (state+nonce+PKCE, server-side flow-state, continuation pointer, redirect) + callback (consume flow-state, verify state/nonce/PKCE, resolve+link, session rotation, resume/landing).
  - [x] `federation/google-provider.ts`: Google OIDC via arctic (auth URL + code exchange) + jose (id_token sig/iss/aud/nonce).
  - [x] `federation/registry.ts`: provider registry (google only) + env config (feature-off when unconfigured).
  - [x] `routes/auth/federation.ts`: Hono router wiring broker to host ports; GET start/callback; mount in `routes/auth/index.ts`.
  - [x] `config/env.ts`: `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI`.
  - [x] Lot gate:
    - [x] `make typecheck-api` (0 errors) + `make lint-api` (0 errors, pre-existing no-console warnings only)
    - [x] **API tests**
      - [x] Add `api/tests/unit/auth/federation-broker.test.ts` (K-STATE, K-FLOW, K-NONCE, K-SEALED, K-NOLEAK, K-AUTOLINK, K-NOMERGE-CRED, K-ROTATE) — 10 tests green.
      - [x] Scoped run: `make test-api-unit SCOPE=tests/unit/auth/federation-broker.test.ts ENV=test-br39e-lot1`

- [x] **Lot N — Final validation**
  - [x] Typecheck & Lint (api) — 0 errors
  - [x] Scoped keystone tests green (10/10)
  - [ ] PR created with `BRANCH.md` as body
  - [ ] Remove `BRANCH.md` before push (main has a stale copy — avoid add/add conflict)
