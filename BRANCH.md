# Feature: BR-39e Lot 2 — GitHub provider + manual-link + email-challenge infra

## Objective
Add the GitHub federation provider (OAuth2, no OIDC) behind the Lot 1 broker seam, plus the shared authenticated manual-link flow (D7) and the email-verification challenge flow (D9), so GitHub logins are safe: verified-email collisions require an authenticated link, and no-verified-email logins prove an email before any user is created.

## Scope / Guardrails
- Scope limited to `api/src/services/auth/federation/**`, `api/src/routes/auth/**`, `api/src/config/env.ts`, `api/tests/**`.
- No new migration (Lot 0 `identities` + `federation_flow_states` suffice).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/br39e-lot2`.
- Automated tests on `ENV=test-br39e-lot2` (API_PORT=9195 UI_PORT=5395 MAILDEV_UI_PORT=1295), never root `dev`.
- `ENV=<env>` last in every `make` command.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/auth/federation/**`
  - `api/src/routes/auth/**`
  - `api/src/config/env.ts`
  - `api/tests/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `apps/**`
  - `api/drizzle/*.sql` (NO new migration)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - none
- **Exception process**:
  - Declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## AI Flaky tests
- none (no AI tests in scope).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal lot; single final test cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal provider lot behind an existing seam; no independent sub-workstreams.

## UAT Management (in orchestration context)
- Mono-branch: UAT on the integrated branch (backend-only lot; provider buttons + link/unlink surface land in Lot 6, D17).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm isolated worktree `tmp/br39e-lot2` on `feat/br39e-lot2-github` off `origin/main`.
  - [x] Read spec `SPEC_EVOL_39E_SOCIAL_FEDERATION.md` (D6/D7/D8/D9, §3.3, per-provider matrix GitHub row, keystones).
  - [x] Ground on Lot 1 broker/types/registry/routes + Lot 0 `resolveOrCreateFederatedUser`.
  - [x] Confirm command style `make ... ENV=test-br39e-lot2` (ENV last).
  - [x] Confirm scope + no-new-migration guardrail.

- [x] **Lot 1 — GitHub provider + manual-link + email-challenge infra**
  - [x] `github-provider.ts` — arctic GitHub OAuth2 authorization URL + code→access-token; `fetchGithubIdentity` derives subject (numeric id) + primary email + `verified` from `/user` + `/user/emails`; access token used only here (D1 no-leak).
  - [x] Register `github` in `registry.ts` (feature-OFF when `GITHUB_OAUTH_CLIENT_ID/SECRET` absent).
  - [x] `env.ts` — `GITHUB_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` (optional).
  - [x] Broker: distinct `email-challenge` callback outcome (D9, no user created) carrying the pending identity + continuation.
  - [x] Broker: `linkCallback` (D7/§3.3 step 6) — authenticated manual-link; rejects unauthenticated; binds the re-proven identity to the session user; rejects an identity owned by another account; idempotent for the same user.
  - [x] Broker: `completeEmailChallenge` — re-runs the SAFE resolver with the proven email (create+link, or manual-link on collision — GitHub never auto-links, D8).
  - [x] `pending-store.ts` — in-memory single-use + TTL pending-federation store for the email-challenge handoff.
  - [x] Routes: email-challenge issuance on callback (stash pending + bound cookie + redirect to verify-email); `GET /:provider/link/{start,callback}` (authenticated); `POST /challenge/complete` (proven email → complete).
  - [x] Lot gate:
    - [x] `make typecheck-api` (0 errors)
    - [x] `make lint-api` (0 errors)
    - [x] **API tests**
      - [x] Add `api/tests/unit/auth/federation-lot2.test.ts` — K-GH-SUBJECT, K-GH-NOVERIFIED (no/unverified email), K-GH-MANUAL (credentialed + shell), K-MANUAL-LINK-AUTH (unauth reject / link to session user / other-account reject / idempotent), completeEmailChallenge (create+link / collision→manual-link).
      - [x] Add `api/tests/unit/auth/federation-github-provider.test.ts` — identity derivation with a fake `fetch` (never real GitHub).
      - [x] Add `api/tests/unit/auth/federation-pending-store.test.ts` — single-use + TTL.
      - [x] Scoped run: `make test-api-unit SCOPE="federation-lot2 federation-github-provider federation-pending-store" ENV=test-br39e-lot2`.
      - [x] Non-regression: `make test-api-unit SCOPE="federation-broker federation-adapter federation-route-cookies" ENV=test-br39e-lot2` (Lot 0/1 green).

- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint (api)
  - [x] API unit tests (scoped + federation non-reg)
  - [ ] PR created with `BRANCH.md` as body
  - [ ] Branch CI green
  - [ ] Remove `BRANCH.md`, push, merge (conductor/owner)

## Notes
- Manual-link design = spec §3.3 step 6 (authenticated FRESH link flow that re-proves provider ownership and binds to the session user). This is strictly safer than persisting the collision identity and needs no durable pending-identity store. The login-collision 409 `account_exists_sign_in_to_link` is the handoff signal.
- D9 email-challenge completion re-enters the SAFE resolver (`resolveOrCreateFederatedUser`) with the proven email → uniform create/collision handling; GitHub collisions route to manual-link (never auto-link, D8).
- Pending-federation store is in-memory (single-writer auth-idp process); a durable adapter can replace it behind the same interface. Follow-up if multi-replica auth-idp is deployed.
