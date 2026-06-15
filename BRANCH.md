# Feature: OAuth consent persistence (skip re-consent for already-granted scopes)

## Objective
The IdP `auth.sent-tech.ca` re-shows the "Autoriser l'application" consent screen on EVERY `/authorize` (verified: `authorize-handler.ts` redirects to the consent URL unconditionally; no stored consent). Add **consent persistence**: record the user's grant per `(user, client, scopes)` on approve, and on subsequent `/authorize` issue the code DIRECTLY (skip the consent screen) when a stored grant covers the requested scopes. Re-show only on a new/uncovered scope, `prompt=consent`, or (future) revocation. Fixes the immo + monitor "re-asks every time" UX.

## Scope / Guardrails
- One migration max: `api/drizzle/0034_oauth_consents.sql`.
- Make-only, Docker-first. `ENV=<env>` last.
- Branch in worktree `tmp/auth-consent-persistence`.
- NOT a published-claims-contract change (D2 autonomous; no token claim added/changed).
- All text English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/auth-hono/**`
  - `api/src/routes/auth/**`, `api/src/services/auth/**`, `api/src/db/schema.ts`
  - `api/drizzle/0034_oauth_consents.sql` + `api/drizzle/meta/_journal.json`
  - `api/tests/api/auth/**`, `packages/auth-hono/tests/**`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `ui/**`, `apps/**`, any other `api/drizzle/*.sql`
- **Conditional**: `.github/workflows/**` (only with `BRxx-EXn`)

## Design (DECIDED — standard OIDC consent persistence)
- **New OPTIONAL port** `AuthHonoPorts.consentStore?` (mirror the 39e optional `tenantContext` pattern — absent ⇒ current behavior = always consent, so backward-compatible for external consumers):
  - `getGrant(userId, clientId): Promise<{ scopes: string[] } | null>`
  - `saveGrant(userId, clientId, scopes: string[]): Promise<void>` (upsert; union with any prior scopes)
- **authorize-handler**: after the session is established, BEFORE the consent redirect:
  - if `consentStore` present AND `prompt !== 'consent'` AND `getGrant(user,client).scopes ⊇ requestedScopes` ⇒ **issue the auth code directly** (reuse the SAME issuance path as consent-approve — factor it out, do not duplicate seal/redirect logic) → redirect to `redirect_uri?code=…&state=…`.
  - else ⇒ redirect to consent screen (unchanged).
  - `prompt=none`: covered ⇒ issue code (silent success); not covered ⇒ `consent_required` (unchanged).
- **consent-decision-handler**: on APPROVE, if `consentStore` present ⇒ `saveGrant(user, client, grantedScopes)`. DENY ⇒ no save (unchanged).
- **api adapter**: implement `consentStore` over a new table `oauth_consents` (`user_id`, `client_id`, `scopes text[]`, `created_at`, `updated_at`; UNIQUE `(user_id, client_id)`, upsert). Wire it into the api's auth-hono `ports` object.
- **Security invariant (MUST test)**: NEVER skip consent for any scope not in the stored grant (scope escalation must re-consent). Grant is per exact `(user, client)`; scopes compared as a set-superset.
- **Revocation**: deferred (no revoke endpoint this WP). Note in spec.
- auth-hono bump **0.6.0 → 0.7.0** (minor, additive optional port + behavior).

## Orchestration Mode
- [x] Mono-branch + cherry-pick — cohesive auth-core change; impl delegated to 1 sub-agent, conductor integrates + gates + PR + merge.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline** (worktree off origin/main `974bd1dfc`; branch verified; migration n+1 = 0034; auth-hono 0.6.0).
- [x] **Lot 1 — auth-hono core**
  - [x] Add optional `consentStore` port (ports.ts) + types (`AuthHonoConsentStorePort`/`AuthHonoConsentGrant` in ports.ts, mirror optional `tenant` idiom).
  - [x] Factor out "issue authorized code" from consent-decision-handler into a shared helper (`oauth/issue-authorized-code.ts`); call it from the authorize skip-path.
  - [x] authorize-handler: stored-grant skip logic (cover + `prompt!=='consent'`); prompt=none covered ⇒ success.
  - [x] consent-decision-handler: saveGrant on approve.
  - [x] Unit tests (`packages/auth-hono/tests/oauth-consent-persistence.test.ts`): (a) covered ⇒ skip→code; (b) requested superset of stored ⇒ NO skip (consent shown); (c) `prompt=consent` ⇒ always consent; (d) no consentStore ⇒ always consent (compat); (e) deny ⇒ no save; (f) prompt=none covered ⇒ code, uncovered ⇒ consent_required; (+ different-client binding).
  - [x] Gate: `make typecheck-auth-hono` (exit 0) + `make test-auth-hono` (29 files, 120 tests pass).
- [x] **Lot 2 — api wiring + persistence** (code complete; gate BLOCKED by pre-existing dep audit — see FL-3)
  - [x] `api/drizzle/0034_oauth_consents.sql` (hand-written + `_journal.json` idx 34; NO db-generate, like 0031/0033) + `api/src/db/schema.ts` `oauthConsents` table (UNIQUE(user_id,client_id), FKs cascade).
  - [x] consentStore adapter (`api/src/services/auth/consent-store-adapter.ts`, upsert + scope union) wired into api auth-hono ports (`api/src/routes/auth/oauth.ts`).
  - [x] Integration test (`api/tests/api/auth/oauth-consent-persistence.test.ts`): authorize→consent approve→grant row; 2nd authorize same scopes ⇒ 302 to redirect_uri with code (NO consent); 2nd authorize NEW scope ⇒ consent screen; deny ⇒ no row.
  - [ ] Gate: `make typecheck-api` + scoped `make test-api-unit SCOPE=...` + `make test-auth-hono` — BLOCKED: `make typecheck-api`/`test-api-unit` rebuild the api image, which fails at `api/Dockerfile:67` `npm audit --audit-level=high` on a pre-existing transitive `ws` HIGH advisory (lockfile byte-identical to origin/main; this branch touches no deps). Needs the standing `fix/sec-*` dep-bump branch. `make test-auth-hono` passes (re-run below).
- [x] **Lot 3 — bump + docs**
  - [x] auth-hono `0.6.0 → 0.7.0`; README "Consent persistence — `consentStore`" section + 0.7.0 versioning entry (no RECIPES.md in this package).
- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-auth-hono` + `make typecheck-api` + `make test-auth-hono` + `make test-api` (+ `make clean test-e2e` if auth e2e touched).
  - [ ] `enforce-package-bump` (auth-hono 0.7.0).
  - [ ] PR (this BRANCH.md as body) → CI green → remove BRANCH.md → merge.
  - [ ] Post-merge: bootstrap-publish auth-hono 0.7.0 (no trusted-publisher, per [[project_br39_full_roadmap]]); verify npm.

## Feedback Loop
- FL-1 `risk`: the skip-path must reuse the EXACT code-issuance (seal + single-use auth code + redirect) used by consent-approve — duplication risks divergent security behavior. Mitigation: shared helper, both call it. RESOLVED 2026-06-15: extracted `oauth/issue-authorized-code.ts`; both consent-approve and the authorize skip-path call `issueAuthorizedCode`.
- FL-2 `note`: migration-amend on a persisted test volume needs `make clean` (down -v) not `make down` (drizzle won't re-apply a recorded tag) — per 39e lesson.
- FL-3 `resolved-as-local-only` (conductor, 2026-06-15): the sub-agent's LOCAL `make typecheck-api`/`test-api-unit` failed at `api/Dockerfile:67` `npm audit --audit-level=high` on a transitive `ws` HIGH advisory (GHSA-58qx-3vcg-4xpx). VERIFIED NOT a CI blocker: main `build-api-image` is GREEN on today's runs (27540781514 @10:42, 27538357527 @09:55) — `npm audit` hits the live advisory DB so a FRESH local build trips a newly-surfaced advisory that CI's cached layer/timing does not. Branch touches no deps (`git diff origin/main..HEAD -- package-lock.json` empty). So the api gate (typecheck-api, test-api, build-api-image incl. the consent integration test) is validated by CI, the authority. The `ws` bump is the standing `fix/security-*` workstream's scope, NOT this feature.

## Deferred
- Consent revocation endpoint + admin "connected apps" UI (future WP).
- Per-scope consent UI (granular toggle) — v1 is all-requested-or-deny.
