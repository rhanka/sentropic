# Feature: Gmail OAuth Registered Callback Fix

## Objective
Restore Gmail OAuth in preproduction without changing the shared Google client's Console configuration by using its registered Google Drive callback URI and dispatching signed Gmail state there.

## Scope / Guardrails
- Scope is limited to Gmail/Google Drive OAuth state, callback routing, focused API tests, and this branch plan.
- Make-only workflow; automated tests use `ENV=test-gmailredir`, never `ENV=dev`.
- Preserve the existing OAUTH_SIGNING_KEK state sealer and secret-crypto implementation.
- All new code, comments, commits, and Markdown are in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/gmail-oauth.ts`
  - `api/src/services/google-drive-oauth.ts`
  - `api/src/routes/api/gmail.ts`
  - `api/src/routes/api/google-drive.ts`
  - `api/tests/unit/gmail-oauth.test.ts`
  - `api/tests/unit/google-drive-oauth.test.ts`
  - `api/tests/api/google-drive-oauth.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/**`
  - `ui/**`
  - `deploy/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `api/src/services/secret-crypto.ts`
  - `drizzle/**`
  - `api/drizzle/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare `BR-GMAIL-REDIRECT-EXn` with reason, impact, and rollback in `## Feedback Loop` before touching a conditional or forbidden path.

## Feedback Loop
- [x] `BR-GMAIL-REDIRECT-ROOT1` — Evidence confirms the shared Google client has only the Drive callback registered while Gmail emits its own callback URI; provider dispatch in sealed state is the smallest app-side fix.
- [x] `BR-GMAIL-REDIRECT-TEST1` — Local isolated API test commands cannot execute Vitest because `make up-api-test ENV=test-gmailredir` leaves no `api` service running; CI must run the focused API suites.

## AI Flaky tests
- [x] No AI-dependent tests are in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one coupled OAuth state-and-callback change requires a single integrated verification cycle.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Verify branch `fix/gmail-oauth-redirect-uri` with `harness check branch`.
  - [x] Read OAuth services, routes, existing tests, and project testing rules.
  - [x] Confirm `make test-api-unit` and `make test-api-endpoints` scoped-test targets with `ENV=test-gmailredir`.
  - [x] Confirm allowed and forbidden paths; no scope exception is needed.

- [ ] **Lot 1 — Registered callback and provider dispatch**
  - [x] Seal an optional OAuth-state provider, defaulting missing or unknown values to `google-drive` during verification.
  - [x] Seal `gmail` for Gmail starts and use `/api/v1/google-drive/oauth/callback` for Gmail authorization and token exchange.
  - [x] Extract Gmail callback completion and dispatch verified Gmail states from the Drive callback without changing Drive completion.
  - [x] Add Gmail authorization/config, legacy-state, and Drive-callback Gmail end-to-end API coverage.
  - [ ] Lot gate:
    - [x] `make typecheck-api ENV=test-gmailredir`
    - [x] `make lint-api ENV=test-gmailredir`
    - [ ] `make test-api-unit SCOPE=tests/unit/gmail-oauth.test.ts ENV=test-gmailredir`
    - [ ] `make test-api-unit SCOPE=tests/unit/google-drive-oauth.test.ts ENV=test-gmailredir`
    - [ ] `make test-api-endpoints SCOPE=tests/api/google-drive-oauth.test.ts ENV=test-gmailredir`

- [ ] **Lot 2 — Final validation and PR**
  - [ ] Run `make test-api SCOPE=tests/unit/gmail-oauth.test.ts ENV=test-gmailredir`.
  - [ ] Run `make test-api SCOPE=tests/unit/google-drive-oauth.test.ts ENV=test-gmailredir`.
  - [ ] Run `make test-api SCOPE=tests/api/google-drive-oauth.test.ts ENV=test-gmailredir`.
  - [ ] Run `make scope-check` before every commit.
  - [ ] Review the final diff for allowed-path and Google Drive regression safety.
  - [ ] Create and push a PR to `main` with this file as its body; do not merge.
