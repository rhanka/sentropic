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
- [ ] **Lot 0 — Baseline** (worktree off origin/main `974bd1dfc`; branch verified; migration n+1 = 0034; auth-hono 0.6.0).
- [ ] **Lot 1 — auth-hono core**
  - [ ] Add optional `consentStore` port (ports.ts) + types (state-store-types.ts or a new consent-types).
  - [ ] Factor out "issue authorized code" from consent-decision-handler into a shared helper; call it from the authorize skip-path.
  - [ ] authorize-handler: stored-grant skip logic (cover + `prompt!=='consent'`); prompt=none covered ⇒ success.
  - [ ] consent-decision-handler: saveGrant on approve.
  - [ ] Unit tests (`packages/auth-hono/tests/**`): (a) covered ⇒ skip→code; (b) requested superset of stored ⇒ NO skip (consent shown); (c) `prompt=consent` ⇒ always consent; (d) no consentStore ⇒ always consent (compat); (e) deny ⇒ no save; (f) prompt=none covered ⇒ code, uncovered ⇒ consent_required.
  - [ ] Gate: `make typecheck-auth-hono` + `make test-auth-hono`.
- [ ] **Lot 2 — api wiring + persistence**
  - [ ] `api/drizzle/0034_oauth_consents.sql` (hand-written + `_journal.json` entry; NO db-generate, like 0031/0033) + `api/src/db/schema.ts` table.
  - [ ] consentStore adapter (upsert) + wire into api auth-hono ports (`api/src/routes/auth/oauth.ts` or wherever ports are built).
  - [ ] Integration test (`api/tests/api/auth/**`): authorize→consent approve→grant row; 2nd authorize same scopes ⇒ 302 to redirect_uri with code (NO consent); 2nd authorize NEW scope ⇒ consent screen.
  - [ ] Gate: `make typecheck-api` + scoped `make test-api-unit SCOPE=...` + `make test-auth-hono`.
- [ ] **Lot 3 — bump + docs**
  - [ ] auth-hono `0.6.0 → 0.7.0`; README/RECIPES note the optional consentStore + skip behavior.
- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-auth-hono` + `make typecheck-api` + `make test-auth-hono` + `make test-api` (+ `make clean test-e2e` if auth e2e touched).
  - [ ] `enforce-package-bump` (auth-hono 0.7.0).
  - [ ] PR (this BRANCH.md as body) → CI green → remove BRANCH.md → merge.
  - [ ] Post-merge: bootstrap-publish auth-hono 0.7.0 (no trusted-publisher, per [[project_br39_full_roadmap]]); verify npm.

## Feedback Loop
- FL-1 `risk`: the skip-path must reuse the EXACT code-issuance (seal + single-use auth code + redirect) used by consent-approve — duplication risks divergent security behavior. Mitigation: shared helper, both call it.
- FL-2 `note`: migration-amend on a persisted test volume needs `make clean` (down -v) not `make down` (drizzle won't re-apply a recorded tag) — per 39e lesson.

## Deferred
- Consent revocation endpoint + admin "connected apps" UI (future WP).
- Per-scope consent UI (granular toggle) — v1 is all-requested-or-deny.
