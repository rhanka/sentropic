# Feature: BR-39c OAuth2 / OIDC Identity Provider

## Objective
Turn `@sentropic/auth-hono` into a standard OAuth2 + OpenID Connect Identity Provider (IdP) so external apps (immo, diag, paas tenant apps, and the example mock RP shipped with the package) can federate users via "Login with Sentropic". Adds `<OAuthConsent />` to `@sentropic/auth-ui` and wires the Sentropic API/UI as the first live consumer pair.

## Scope / Guardrails
- Scope limited to OAuth2/OIDC IdP surface: `authorize`, `token`, `userinfo`, `revoke`, `introspect` endpoints, `.well-known/openid-configuration` + `.well-known/jwks.json` discovery, Ed25519 JWT signing with JWKS rotation, PKCE-only auth-code flow, DPoP opt-in per client (RFC 9449), oauth state-store port abstraction, `<OAuthConsent />` Svelte component, RP-side helper `oauth-client.ts`, Sentropic API host adapter + UI thin wrappers, one Drizzle migration (`oauth_clients` + `authorization_codes` + `oauth_tokens` + `oauth_dpop_proofs` + `revoked_tokens` + `id_token_signing_keys`), seeded mock RP for integration tests.
- Out of scope (pushed to BR-39d/e/h/i/j/k/l per `project_br39_full_roadmap`): `client_credentials` grant (39d), multi-tenant (39e), unified `identities` table (39h), Token Exchange RFC 8693 + chained `act` claims (39i), step-up MFA enforcement / `<AuthStepUp />` middleware (39j), MFA delegation policies (39k), MCP Dynamic Client Registration RFC 7591 (39l), per-tenant branding (39f), admin UI (39g).
- The IdP must remain host-adapter driven: no direct app-store / SvelteKit-nav / Sentropic-DB imports from `packages/**` source.
- One migration max in `api/drizzle/*.sql`: a single consolidated file `0027_oauth_clients.sql` containing all 6 new tables.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-auth-oidc`.
- Automated test campaigns run on dedicated environments (`ENV=test-feat-auth-oidc` for unit/integration, `ENV=e2e-feat-auth-oidc` for E2E), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA before sign-off).
- In every `make` command, the concrete branch environment value must be passed as the last argument.
- All new text, comments, errors, OpenAPI schemas, claim names, and code in English.
- Package version bumps mandatory for `packages/auth-hono` (0.2.1 → 0.3.0, minor for new OAuth2/OIDC surface) and `packages/auth-ui` (0.2.0 → 0.3.0, minor for new `<OAuthConsent />` + `oauth-client.ts`).
- No bootstrap publish needed (both packages already published with OIDC trusted publisher attached).
- No new external runtime dep beyond `jose` (already peer dep of `auth-hono`) for JWT signing. DPoP proof verification reuses `jose`. Postgres `pgcrypto` extension used for at-rest encryption of signing private keys; dev/test may resolve a deterministic fallback KEK, while production must provide `OAUTH_SIGNING_KEK`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `packages/auth-hono/package.json`
  - `packages/auth-hono/src/oauth/**` (new)
  - `packages/auth-hono/src/ports.ts` (extend with `oauthStateStore`)
  - `packages/auth-hono/src/contracts.ts` (extend with OAuth route map entries)
  - `packages/auth-hono/src/index.ts` (re-export oauth subtree)
  - `packages/auth-hono/src/router.ts` (extend router options to mount oauth optionally)
  - `packages/auth-hono/tests/__fixtures__/**` (OAuth in-memory stores + minimal RP)
  - `packages/auth-hono/tests/oauth-*.test.ts` (new — see test list below)
  - `packages/auth-hono/tests/example-oauth-rp.test.ts` (new)
  - `packages/auth-hono/README.md`
  - `packages/auth-ui/package.json`
  - `packages/auth-ui/src/oauth-client.ts` (new)
  - `packages/auth-ui/src/oauth-consent.ts` (new OAuth consent transport contract)
  - `packages/auth-ui/src/components/OAuthConsent.svelte` (new)
  - `packages/auth-ui/src/components/OAuthConsent.svelte.d.ts` (new)
  - `packages/auth-ui/src/labels.ts` (extend OAuth consent labels)
  - `packages/auth-ui/src/index.ts` (re-export)
  - `packages/auth-ui/tests/oauth-client.test.ts` (new)
  - `packages/auth-ui/tests/oauth-consent.test.ts` (new)
  - `packages/auth-ui/README.md`
  - `package-lock.json` (workspace lockfile only, no new top-level deps expected)
  - `api/package.json` (workspace ref bump only if needed)
  - `api/drizzle/0027_oauth_clients.sql` (the single new migration)
  - `api/src/config/env.ts` (add OAuth env schema / production requirements)
  - `api/src/db/schema.ts` (add new tables matching the migration)
  - `api/src/services/auth/oauth-state-adapter.ts` (new — Postgres impl of `oauthStateStore` port)
  - `api/src/services/auth/jwks-adapter.ts` (new — Postgres-backed Ed25519 key store)
  - `api/src/services/auth/oauth-client-seed.ts` (new — deterministic dev/test client seed)
  - `api/src/services/auth/oauth-token-purge.ts` (new — scheduled expired-token cleanup hook)
  - `api/src/scripts/oauth-init-keys.ts` (new — first-key bootstrap invoked through `make exec-api`)
  - `api/src/scripts/oauth-seed-clients.ts` (new — dev/UAT OAuth client seed invoked through `make exec-api`)
  - `api/src/routes/auth/oauth.ts` (new — mounts oauth router with Sentropic adapters)
  - `api/src/routes/auth/index.ts` (extend to mount `oauth` subrouter)
  - `api/src/routes/well-known.ts` (new — root-mounted `/.well-known/openid-configuration` + `/.well-known/jwks.json`)
  - `api/src/app.ts` (mount `well-knownRouter` at root path)
  - `api/tests/utils/seed-test-data.ts` (seed OAuth mock clients for E2E only)
  - `api/tests/api/auth/oauth-authorize.test.ts` (new)
  - `api/tests/api/auth/oauth-token.test.ts` (new)
  - `api/tests/api/auth/oauth-userinfo.test.ts` (new)
  - `api/tests/api/auth/oauth-revoke-introspect.test.ts` (new)
  - `api/tests/api/auth/oauth-wellknown.test.ts` (new)
  - `api/tests/unit/auth/jwks-adapter.test.ts` (new)
  - `api/tests/unit/auth/oauth-state-adapter.test.ts` (new)
  - `ui/package.json`
  - `ui/src/routes/auth/oauth/consent/+page.svelte` (new thin wrapper)
  - `ui/src/routes/auth/oauth/callback/+page.svelte` (new thin wrapper)
  - `ui/src/lib/services/oauth-transport.ts` (new — Sentropic host adapter to call its own `/api/v1/auth/oauth/*` via `api.ts`)
  - `ui/tests/utils/oauth-transport.test.ts` (new)
  - `e2e/tests/02-auth-oauth-authorization-code.spec.ts` (new)
  - `e2e/tests/02-auth-oauth-revoke.spec.ts` (new)
  - `e2e/tests/02-auth-oauth-wellknown.spec.ts` (new)
  - `spec/SPEC_BR39c_OAUTH_OIDC_IDP.md` (new — consolidated before tests, deleted at Lot N-1)
  - `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` (row 24 update at Lot N-1)
  - `spec/WORKFLOW_AUTH.md` (append OAuth2/OIDC flow diagram at Lot N-1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (no other branch files)
  - `plan/done/39a-BRANCH_feat-auth-ui-sdk.md`, `plan/done/39b-BRANCH_feat-auth-hono-kit.md`
  - `packages/chat-core/**`, `packages/chat-ui/**`, `packages/llm-mesh/**`, `packages/skills/**`, `packages/flow/**`, `packages/events/**`, `packages/contracts/**`, `packages/cowork-*/**`
  - `api/src/routes/auth/{register,login,session,credentials,magic-link,email,device}.ts` (BR-39b territory)
  - `api/src/services/{session-manager,challenge-manager,email-verification,magic-link,webauthn-*,workspace-service}.ts`
  - `api/src/middleware/auth.ts`
  - `ui/src/lib/services/webauthn-client.ts`, `ui/src/lib/stores/session.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml` only if new `oauth-*` test suites need a new CI lane and cannot be picked up by existing `test-packages` / `test-api-*` matrix expansions — `BR39c-EX1`.

- **Exception process**:
  - Declare exception ID `BR39c-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop

- `BR39c-D1` `decided`: Identities split. `oauth_clients` table created here in 39c. `service_clients` separate, lands in 39d. Fusion to unified `identities` table deferred to 39h. No `identities` table introduced in 39c.
- `BR39c-D2` `decided`: DPoP (RFC 9449) is opt-in per client via `dpop_bound_access_tokens` boolean column on `oauth_clients`. Support implemented and tested in 39c, but no client class enforces it yet (will be mandatory for `type ∈ {agent, nhi, mcp_connector}` from 39h+). Ed25519 keypair on RP side, stored client-side only (in `oauth-client.ts` helper). Cited as RFC 9449.
- `BR39c-D3` `decided`: Delegation TTL hard cap 24h, default 1h. Delegation flow lands in 39i; in 39c the `access_tokens.expires_at` / `revoked_tokens.expires_at` column policy accommodates this — no DB-level CHECK constraint that forbids > 24h.
- `BR39c-D4` `decided`: Step-up freshness enforcement lands in 39j, but `id_token` MUST emit `acr` + `auth_time` claims from 39c so 39j consumers can read them. ACR levels: `urn:sentropic:loa:bearer | urn:sentropic:loa:passkey-1d | urn:sentropic:loa:passkey-fresh`. In 39c, successful passkey sessions emit `acr=urn:sentropic:loa:passkey-fresh` + `auth_time=session.createdAt`; 39j will add real strong-auth freshness tracking.
- `BR39c-D5` `decided`: JWT signing algorithm is Ed25519 only. No RS256 fallback. JWKS includes ONE `active=true` key + N `active=false` rotated keys. Key generation uses `crypto.generateKeyPairSync('ed25519')`. Storage: Postgres with `pgcrypto` `pgp_sym_encrypt` keyed by `OAUTH_SIGNING_KEK` env var (operator-rotated).
- `BR39c-D6` `decided`: Auth-code / token storage abstracted from day 1 via `AuthHonoPorts.oauthStateStore` port interface. Methods: `findClient(clientId)`, `saveAuthCode(code, payload, ttlSec)`, `consumeAuthCode(code) → atomic single-use`, `saveTokenMeta(jti, meta, ttlSec)`, `findTokenMeta(jti)`, `revokeToken(jti)`, `isTokenRevoked(jti)`, `recordDpopJti(jti, expiresAt) → boolean`, `purgeExpired() → number`. First impl is Postgres via Drizzle in `api/src/services/auth/oauth-state-adapter.ts`. Tests use an in-memory adapter living in `packages/auth-hono/tests/__fixtures__/memory-oauth-state-store.ts`. No Redis dep introduced in 39c; `auth-hono` core never imports Postgres.
- `BR39c-Q1` `decided` (2026-05-31, revised 2026-05-31 post Codex review): OAuth issuer is the public API origin only, e.g. `http://localhost:9197` in branch tests and `http://localhost:8787` in root UAT. Discovery lives at `${issuer}/.well-known/openid-configuration` and `${issuer}/.well-known/jwks.json`. OAuth core endpoints live at `${issuer}/api/v1/auth/oauth/{authorize,token,userinfo,revoke,introspect,consent/decision}`. Discovery documents advertise those endpoint URLs explicitly. `oauth-client.ts` fetches discovery from `${issuer}/.well-known/openid-configuration`. No UI-origin well-known proxy is introduced in 39c.
- `BR39c-Q2` `decided` (2026-05-31, revised 2026-05-31 post Codex review): Encryption-at-rest = Postgres `pgcrypto` `pgp_sym_encrypt(private_key_pem, oauthSigningKek)`. `oauthSigningKek` resolves as `OAUTH_SIGNING_KEK` in production; dev/test may fall back to `JWT_SECRET` or the existing dev secret so docker-compose files do not need branch edits. `api/src/config/env.ts` records the optional env var, and `jwksAdapter` throws on production startup/key generation if `OAUTH_SIGNING_KEK` is absent.

### Adversarial review delta (Opus 4.8, 2026-05-31) — decisions appliquées pour rester self-sufficient jusqu'aux UAT

- `BR39c-D7` `decided`: PKCE plaintext interdit. `code_challenge_method` column = `text NOT NULL CHECK (code_challenge_method = 'S256')`, no default. Authorize-handler rejects any value ≠ `'S256'` with HTTP 400 `invalid_request`. Explicit test in Lot 2.
- `BR39c-D8` `decided`: DPoP `cnf={jkt}` propagation. When `client.dpop_bound_access_tokens=true` token-handler embeds `cnf.jkt` in BOTH access_token AND id_token, persists `dpop_jkt` via `saveTokenMeta`, introspect renvoie le claim, userinfo recompute `jkt` depuis l'incoming DPoP proof et compare au stocké → mismatch = 401. Tests dans Lot 2.
- `BR39c-D9` `decided`: DPoP proof replay defense complet. `OauthStateStorePort.recordDpopJti(jti, expiresAt) → boolean` (false si duplicate). Lot 2 spell out 5 checks: `htm` exact match, `htu` exact match, `iat` ±60s skew, `jti` single-use, `ath = base64url(SHA-256(access_token))` pour les calls resource. Tests par failure mode dans `oauth-dpop-proof.test.ts`.
- `BR39c-D10` `decided`: `id_token` n'est émis QUE si `scope` inclut `openid`. Token-handler: si pas openid → access_token only, pas d'id_token. Test "OAuth-only scope returns no id_token" dans Lot 2.
- `BR39c-D11` `decided`: `redirect_uri` validation byte-exacte. Comparaison byte-equal contre `client.redirect_uris` array; reject `http://` sauf si host est `localhost|127.0.0.1`; reject `#fragment`; reject URIs avec credentials. Stockage `text[]`. 3 tests négatifs explicites.
- `BR39c-D12` `decided`: Rate-limit dédié OAuth. `Allowed Paths` étendu pour `api/src/app.ts` (déjà allowed via Sentropic adapter wiring) → ajouter limiter `/oauth/token` (20/min par client_id+IP) et `/oauth/introspect` (60/min par client_id). Test couverture dans Lot 4.
- `BR39c-D13` `decided`: Refresh-token DIFFÉRÉ à 39d explicitement. Lot 1 schema: `grant_types` default `['authorization_code']` only. Lot 2 authorize-handler reject `scope=offline_access` avec `invalid_scope`. Discovery doc `grant_types_supported=['authorization_code']`. Pas de surprise pour les RPs.
- `BR39c-D14` `decided`: TTLs spec. `access_token` = 1h, `id_token` = 1h, `authorization_code` = 60s (RFC 6749 §4.1.2 dit ≤10 min mais tighter = better contre brute-force). DPoP proof `iat` skew = ±60s.
- `BR39c-D15` `decided`: `POST /api/v1/auth/oauth/consent/decision` ajouté comme 6ème endpoint dans Lot 2. Validates sealed state, re-vérifie user session, émet l'authorization_code à l'approve. Documenté comme host-private (pas exposé dans well-known).
- `BR39c-D16` `decided`: `nonce` strict. Si authorize a un `nonce`, id_token DOIT le contenir verbatim ; si absent, pas de claim nonce. Test explicite dans Lot 2.
- `BR39c-D17` `decided`: Migration 0027 commence par `CREATE EXTENSION IF NOT EXISTS pgcrypto;`. Lot 0 step vérifie que l'image Postgres dev a pgcrypto disponible (le composé Docker `postgres:17` l'a built-in). `ON DELETE CASCADE` pour TOUS les FKs vers `users` sur les 3 nouvelles tables.
- `BR39c-D18` `decided`: Multi-tenant hooks dès 39c. Ajouter `tenant_id text NULL` (avec index) sur `oauth_clients`, `authorization_codes`, `revoked_tokens` (pas de FK pour l'instant). Authorize-handler propage la valeur depuis client row. Tenants vrais arrivent en 39e — pas de behavioral change en 39c.
- `BR39c-D19` `decided`: `kid` rotation propre. Token-handler signe avec `active=true` key seulement. `/jwks.json` emit `Cache-Control: public, max-age=300`. Rotation policy doc: garder previous key `active=false` pour ≥ access_token TTL + JWKS cache TTL (≥ 1h + 5 min). Documenté dans `packages/auth-hono/README.md` Lot N-1.
- `BR39c-D20` `decided`: KEK + first signing key bootstrap automatisé without Makefile edits. Lot 4 adds `api/src/scripts/oauth-init-keys.ts` and `api/package.json` script `oauth:init-keys`; it is invoked through `make exec-api CMD="npm run oauth:init-keys" API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc` after the test stack is up. The same script is referenced in UAT seed instructions.
- `BR39c-D21` `decided`: `client_secret_hash` algorithm = existing `ports.tokens.hashSecret` (Sentropic currently hashes secrets with SHA-256; hosts may provide a stronger implementation later without changing `auth-hono`). No new runtime dependency is introduced. Test introspect with wrong secret → 401.
- `BR39c-D22` `decided`: `prompt=login` (force re-auth) et `prompt=consent` (force consent screen) honorés dans Lot 2. Tests explicites par valeur. Revoke mid-flow stays per-flow (pas de `consent_grants` table en 39c — flagged in `## Deferred to BR-39g`).
- `BR39c-D23` `decided`: Test client pré-seedé. Lot 4 seed: `client_id='example-mock-rp'`, `client_secret='example-mock-rp-secret-dev-only'`, hashé via `ports.tokens.hashSecret`. Plaintext documenté dans Lot N-2 UAT instructions avec note "dev/test only; rotate before prod".
- `BR39c-D24` `decided`: Mock RP test fixture local, pas peerDep circular. Lot 5 ship `packages/auth-hono/tests/__fixtures__/minimal-rp.ts` qui reproduit just enough de `oauth-client.ts` (PKCE + code exchange). Intégration cross-package auth-ui vs auth-hono via Sentropic E2E Lot N-2.
- `BR39c-D25` `decided`: `aud` claim standard RFC 9068. `access_token.aud` = `${issuer}/userinfo` (default resource pour 39c), plus claim `client_id` séparé. `id_token.aud` = `client_id` (OIDC Core).
- `BR39c-D26` `decided`: `auth_time` source en 39c = `session.createdAt`. Limitation documentée dans `spec/SPEC_BR39c_OAUTH_OIDC_IDP.md`: 39j ajoutera tracking du strong-auth time réel via colonne `sessions.mfaAuthTime` (out of scope 39c — `sessions` table en Forbidden Paths).
- `BR39c-D27` `decided`: Auth-code purge planifié. Lot 4: enregistrer un job dans le `QueueManager` existant qui invoke `oauthStateStore.purgeExpired()` toutes les 5 min. Pas d'admin UI (deferred 39g).
- `BR39c-D28` `decided`: Lot N bump `packages/auth-ui/package.json` peerDep `@sentropic/auth-hono: ^0.3.0` (sinon warning consumer).
- `BR39c-D29` `decided`: Repository has no `.env.example`; env docs land in `spec/SPEC_BR39c_OAUTH_OIDC_IDP.md`, `spec/WORKFLOW_AUTH.md`, and package READMEs. OAuth env vars documented: `OAUTH_SIGNING_KEK` (production required), `OAUTH_ISSUER_URL` (optional override; default API origin), `OAUTH_ACCESS_TOKEN_TTL_SEC` (default 3600), `OAUTH_ID_TOKEN_TTL_SEC` (default 3600), `OAUTH_AUTHORIZATION_CODE_TTL_SEC` (default 60), `OAUTH_DPOP_IAT_SKEW_SEC` (default 60).
- `BR39c-D30` `decided`: CI lane vérification AVANT toute implémentation. Lot 0 add explicit step: verify `validate-auth-hono` runs `make test-auth-hono` and path filters include `packages/auth-hono/**`; verify `test-api-unit-integration` covers `api/tests/api/auth/oauth-*.test.ts`. If not, raise `BR39c-EX1` at Lot 0 (not mid-flight) with exact `ci.yml` edit.
- `BR39c-D31` `decided`: `prompt=none` cross-package handling. Lot 1 étendre signature authorize-handler pour accepter `ports.sessions.findByTokenHash` + `ports.cookies.readSessionToken` (composition via `AuthHonoPorts`, pas import direct du session-manager Sentropic). Pseudo-code dans Lot 2 doc.
- `BR39c-D32` `decided` (Codex 5.5 review, 2026-05-31): Normal unauthenticated `/authorize` redirects to the host login URL with a sealed continuation, never JSON 401. `prompt=none` returns an OAuth redirect to `redirect_uri` with `error=login_required` or `error=consent_required` plus original `state`, never JSON 401. `prompt=login` forces login even with a valid session; `prompt=consent` forces the consent screen for the current flow.
- `BR39c-D33` `decided` (Codex 5.5 review, 2026-05-31): OAuth consent uses a dedicated `OAuthConsentTransport` with `getConsent(state)` and `submitConsentDecision({ state, decision })`; it does not extend or assume `AuthUiTransport.fetch`.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- BR-39c does not introduce new AI-backed code paths; AI flaky test status is expected to mirror `main`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: this branch delivers one cohesive OAuth2/OIDC IdP layer atop the existing `auth-hono` package, plus a thin Sentropic API/UI wiring layer. Splitting OAuth core from RP-side helper or from Sentropic adapter would freeze internal boundaries before integration tests exercise them end-to-end.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on the integrated branch only after package, API, UI, and OAuth E2E gates pass.
- Development worktree: `tmp/feat-auth-oidc`.
- Branch ports (slot 2 for BR-39): `API_PORT=9197`, `UI_PORT=5397`, `MAILDEV_UI_PORT=1297`.
- Test envs: `ENV=test-feat-auth-oidc` (unit + integration), `ENV=e2e-feat-auth-oidc` (E2E only).
- Root UAT env: `ENV=dev` on `/home/antoinefa/src/sentropic`, same HEAD as the branch under qualification.
- Execution flow:
  - Develop and run tests in `tmp/feat-auth-oidc`.
  - Push branch before UAT.
  - Run user UAT from root with `API_PORT=8787 UI_PORT=5173 MAILDEV_UI_PORT=1080 ENV=dev`.
  - Switch back to `tmp/feat-auth-oidc` after UAT.

## Plan / Todo (lot-based)

Sub-Agent ready checklist (must be verified by every sub-agent before any code-writing action):
- [ ] `git -C /home/antoinefa/src/sentropic/tmp/feat-auth-oidc branch --show-current` returns `feat/auth-oidc`.
- [ ] Working tree is clean OR only contains Lot-in-progress edits.
- [ ] Read order completed: rules/MASTER → workflow → subagents → testing → security → architecture → data → PLAN.md → memory `project_br39_full_roadmap.md` → packages/auth-hono/README → packages/auth-ui/README → plan/done/39a + 39b → this BRANCH.md → plan/BRANCH_TEMPLATE.md.
- [ ] `make ps-all` shows no service occupying API 9197 / UI 5397 / Maildev 1297.
- [ ] Frozen decisions BR39c-D1..D33 acknowledged verbatim; no re-litigation.
- [ ] Open questions BR39c-Q1 and BR39c-Q2 are resolved by conductor; no user question remains before UAT.
- [ ] Commit policy: `git add <specific-files>` then `make commit MSG="type(BR-39c): description"`; never `git add .` / `git add -A` / direct `git commit`.

- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read all mandatory files (read order above).
  - [x] Confirm worktree `tmp/feat-auth-oidc` is on branch `feat/auth-oidc`, baseline `origin/main` `ff32a06f`.
  - [x] Run `make ps-all` and confirm slot-2 ports (9197 / 5397 / 1297) are free or owned by this worktree.
  - [x] Confirm BR-39a v0.2.0 and BR-39b v0.2.1 are merged on `main` (already verified at branch creation).
  - [x] Confirm scope boundaries (Allowed / Forbidden / Conditional) and declare any `BR39c-EXn` if needed.
  - [x] Verify issuer/discovery decision from `BR39c-Q1`: issuer is API origin, discovery is `${issuer}/.well-known/openid-configuration`, OAuth endpoints are `${issuer}/api/v1/auth/oauth/*`.
  - [x] Verify KEK/bootstrap decision from `BR39c-Q2`/`D20`: no docker-compose or Makefile edit is needed; dev/test fallback KEK is acceptable; first key is bootstrapped through `make exec-api CMD="npm run oauth:init-keys" ... ENV=<env>` after Lot 4.
  - [x] Verify `validate-auth-hono` CI runs `make test-auth-hono` for `packages/auth-hono/**` and API test jobs cover `api/tests/api/auth/oauth-*.test.ts`; if not, raise `BR39c-EX1` before implementation.
  - [x] Create initial draft of `spec/SPEC_BR39c_OAUTH_OIDC_IDP.md` (consolidation spec — temp, deleted at Lot N-1). Include: issuer/discovery model, target endpoints, claim shape, JWKS shape, state-store port interface, DPoP binding contract, login/consent continuation contract, mock RP contract.
  - [x] Commit: `e4c83e2d chore(BR-39c): Lot 0 baseline + spec draft`.

- [x] **Lot 1 — Schemas, ports, JWKS service**
  - [x] Extend `packages/auth-hono/src/ports.ts`:
    - Add `OauthClientRecord`, `AuthCodePayload`, `TokenMeta`, `OauthStateStorePort`, and `DpopProofRecord` interfaces.
    - Add `JwksKeyRecord`, `JwksPort` interface (read-only: list + getActive + verify lookup; write/rotation is host-owned).
    - Add `oauthStateStore: OauthStateStorePort` + `jwks: JwksPort` to `AuthHonoPorts`.
  - [x] Create `packages/auth-hono/src/oauth/jwks-service.ts`:
    - `createJwksService({ jwksPort, clock })` returning `{ getPublicJwks(), signJwt(payload, options), verifyJwt(jwt, options) }` for both access tokens and id tokens.
    - Uses `jose` `SignJWT` with EdDSA / `crypto.KeyObject` from Ed25519 private key.
    - `getPublicJwks()` shape per RFC 7517: `{ keys: [{ kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA', kid, x, status: 'active'|'rotated' }] }`.
  - [x] Create `packages/auth-hono/src/oauth/state-store-types.ts` exporting all type contracts for D6.
  - [x] Create `api/src/db/schema.ts` additions for new tables (materialized in `0027_oauth_clients.sql`):
    - `oauth_clients` (id text PK, client_id text unique, client_secret_hash text nullable for public clients, name text, redirect_uris text[] byte-exact, allowed_scopes text[], grant_types text[] default `["authorization_code"]`, response_types text[] default `["code"]`, token_endpoint_auth_method text default `"client_secret_basic"`, dpop_bound_access_tokens boolean default false, require_pkce boolean default true, tenant_id text nullable + index, created_at, updated_at, owner_user_id text fk users.id nullable `ON DELETE CASCADE`).
    - `authorization_codes` (code text PK, client_id text, user_id text fk users.id `ON DELETE CASCADE`, tenant_id text nullable + index, redirect_uri text, scope text, code_challenge text, code_challenge_method text NOT NULL CHECK `code_challenge_method = 'S256'` and no default, dpop_jkt text nullable, nonce text nullable, payload jsonb, expires_at, used_at nullable, created_at).
    - `oauth_tokens` (jti text PK, token_type text CHECK in `access_token|id_token`, client_id text, user_id text fk users.id `ON DELETE CASCADE`, tenant_id text nullable + index, scope text, audience text, dpop_jkt text nullable, expires_at, created_at).
    - `oauth_dpop_proofs` (jti text PK, expires_at timestamp not null, created_at timestamp default now()).
    - `revoked_tokens` (jti text PK, client_id text, user_id text fk users.id nullable `ON DELETE CASCADE`, tenant_id text nullable + index, revoked_at, expires_at).
    - `id_token_signing_keys` (kid text PK, alg text default `"EdDSA"`, crv text default `"Ed25519"`, public_jwk jsonb, private_key_encrypted bytea, active boolean default true, created_at, rotated_at nullable; enforce one active key with a partial unique index on `active` where true).
  - [x] Create single migration file `api/drizzle/0027_oauth_clients.sql`; first SQL statement is `CREATE EXTENSION IF NOT EXISTS pgcrypto;`. Note: created manually because existing `drizzle/meta` has no 0026 snapshot even though `_journal.json` has idx 26, so `drizzle-kit generate` would not be a safe source of truth.
  - [x] Create `api/src/services/auth/jwks-adapter.ts`:
    - Implements `JwksPort` against Postgres via Drizzle.
    - Read path: cache active + last-3 rotated keys for 60s in-process to avoid pg hit on every token issue.
    - Write path: `generateAndStoreNewKey()` (operator-callable only, not auto-boot), `rotateActive(newKid)`.
    - Private-key encryption: `pgp_sym_encrypt(privateKeyPem, oauthSigningKek)`, decryption via `pgp_sym_decrypt(private_key_encrypted, oauthSigningKek)`, with production requiring `OAUTH_SIGNING_KEK`.
  - [x] Create `api/src/services/auth/oauth-state-adapter.ts`:
    - Postgres impl of `OauthStateStorePort`.
    - `consumeAuthCode(code)` uses `UPDATE authorization_codes SET used_at = now() WHERE code = $1 AND used_at IS NULL RETURNING payload` to guarantee atomic single-use.
    - `recordDpopJti(jti, expiresAt)` inserts into `oauth_dpop_proofs`; duplicate-key conflict returns false.
    - `purgeExpired()` deletes rows where `expires_at < now()` from `authorization_codes`, `oauth_tokens`, `oauth_dpop_proofs`, and `revoked_tokens`.
  - [x] Create `packages/auth-hono/tests/__fixtures__/memory-oauth-state-store.ts`: in-memory `OauthStateStorePort` impl for package tests.
  - [x] Create `packages/auth-hono/tests/__fixtures__/memory-jwks.ts`: in-memory `JwksPort` impl that pre-generates one Ed25519 keypair.
  - [x] Lot 1 gate:
    - [x] `make typecheck-auth-hono ENV=test-feat-auth-oidc`
    - [x] `make typecheck-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [x] **API tests**
      - [x] new file: `api/tests/unit/auth/jwks-adapter.test.ts` (covers: getActive, list rotated, encrypt/decrypt round-trip, KEK rotation simulation)
      - [x] new file: `api/tests/unit/auth/oauth-state-adapter.test.ts` (covers: saveAuthCode TTL, consumeAuthCode atomic single-use under 2 concurrent calls, save/find token metadata, revokeToken, recordDpopJti duplicate rejection, purgeExpired)
      - [x] `make test-api-unit SCOPE="tests/unit/auth/jwks-adapter.test.ts tests/unit/auth/oauth-state-adapter.test.ts" API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [x] Attempted full `make test-api SCOPE="tests/unit/auth/jwks-adapter.test.ts tests/unit/auth/oauth-state-adapter.test.ts" ... ENV=test-feat-auth-oidc`: scoped tests passed through smoke/unit/endpoints/queue/security/ai phases; command then failed on post-test `up-api` wait while API became healthy immediately after (`make ps` showed healthy).
    - [x] **Package tests**
      - [x] new file: `packages/auth-hono/tests/oauth-jwks-service.test.ts` (covers: sign access/id tokens with Ed25519, verify success, verify with rotated kid succeeds, verify with unknown kid fails, getPublicJwks shape)
      - [x] `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-jwks-service.test.ts ENV=test-feat-auth-oidc`
    - [x] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [x] Commit (target ≤150 lines/commit; split if needed): split into atomic commits `2d11e202` through `aac4e5aa`.

- [ ] **Lot 2 — OAuth2/OIDC core endpoints**
  - [ ] Implement against `BR39c-Q1`: issuer is API origin; OAuth endpoints are under `/api/v1/auth/oauth/*`; discovery/JWKS are root `/.well-known/*` on the API origin.
  - [x] Create `packages/auth-hono/src/oauth/authorize-handler.ts`:
    - GET handler validates `response_type=code`, `client_id` exists in `oauthStateStore.findClient(clientId)`, `redirect_uri` byte-exact match against `client.redirect_uris`, HTTPS/localhost/fragment/credentials rules from D11, `code_challenge` present + `code_challenge_method=S256`, optional `dpop_jkt` if client opted in, requested scopes are a subset of `client.allowed_scopes` else `invalid_scope`, `scope=offline_access` rejected, `state` passthrough, `nonce` passthrough, `prompt` / `login_hint` honored.
    - If no valid session and `prompt=none`, redirects to `redirect_uri` with `error=login_required` plus original `state`; if consent is required under `prompt=none`, redirects with `error=consent_required`.
    - If no valid session and prompt is normal or `login`, redirects to host-configurable `loginUrl` with a sealed continuation state; no JSON 401 for browser authorize flows.
    - If session is valid and consent is needed, returns 302 redirect to host-configurable consent URL with sealed state token (so consent page can re-validate without trusting query params).
    - Errors per RFC 6749 §4.1.2.1 (`error=invalid_request|unauthorized_client|access_denied|login_required|consent_required|...`), redirecting to `redirect_uri` only after client + redirect URI validation succeeds.
  - [x] Create `packages/auth-hono/src/oauth/consent-decision-handler.ts`:
    - POST handler validates sealed state, re-checks user session through `ports.cookies` + `ports.sessions`, supports `approve` and `deny`, and emits the authorization code only on approve.
    - On deny, redirects to `redirect_uri` with `error=access_denied` plus original `state`.
  - [x] Create `packages/auth-hono/src/oauth/token-handler.ts`:
    - POST handler for `grant_type=authorization_code` only in 39c (refresh-token flow deferred to 39d gate).
    - Validates client authentication according to `token_endpoint_auth_method` (`client_secret_basic` for confidential clients, `none` for public clients); wrong secret returns 401.
    - Validates submitted `redirect_uri` equals the value stored with the consumed authorization code.
    - PKCE verification: SHA-256(`code_verifier`) base64url == stored `code_challenge`.
    - DPoP binding: if `client.dpop_bound_access_tokens` true, require `DPoP: <proof-jwt>` header; verify `htm`, `htu`, `iat` ±60s, `jti` single-use via `recordDpopJti`, and bind issued access_token and id_token via `cnf={jkt}` claim.
    - Atomic `consumeAuthCode(code)` — second call returns null → 400 `invalid_grant`.
    - Issues `access_token` (JWT signed with active Ed25519 key, claims: `iss, sub, aud=${issuer}/api/v1/auth/oauth/userinfo, client_id, exp, iat, jti, scope, cnf?, acr, auth_time`), `token_type: "Bearer"` (or `"DPoP"` if bound), and `expires_in=3600`.
    - Issues `id_token` only if granted scope includes `openid`; claims: `iss, sub, aud=client_id, exp, iat, nonce if present, auth_time, acr, email?, email_verified?, name?, cnf?` based on scope.
    - `saveTokenMeta(jti, { clientId, userId, scope, expiresAt, dpopJkt? })` for later revocation check.
  - [ ] Create `packages/auth-hono/src/oauth/userinfo-handler.ts`:
    - GET / POST handler accepts `Authorization: Bearer <jwt>` or `Authorization: DPoP <jwt>` + `DPoP: <proof>`.
    - Verifies JWT signature via JWKS, checks `findTokenMeta(jti)` + `isTokenRevoked(jti)`, verifies DPoP proof for bound tokens including `ath = base64url(SHA-256(access_token))`, and returns claims based on issued scope.
  - [ ] Create `packages/auth-hono/src/oauth/revoke-handler.ts`:
    - POST per RFC 7009. Accepts `token` + optional `token_type_hint`. Calls `revokeToken(jti)`. Idempotent.
    - If token was DPoP-bound, requires DPoP proof with valid `ath` to revoke (prevents arbitrary revoke by token theft).
  - [ ] Create `packages/auth-hono/src/oauth/introspect-handler.ts`:
    - POST per RFC 7662. Requires client authentication (Basic auth via `oauth_clients.client_secret_hash`).
    - Returns `{active: true|false, scope, client_id, sub, exp, iat, jti, token_type, cnf?}` for active tokens, `{active: false}` for revoked/expired/unknown.
  - [ ] Create `packages/auth-hono/src/oauth/wellknown-handler.ts`:
    - GET `/openid-configuration` returns standard OIDC discovery doc: `issuer`, endpoint URLs under `${issuer}/api/v1/auth/oauth/*`, `jwks_uri=${issuer}/.well-known/jwks.json`, `response_types_supported=["code"]`, `grant_types_supported=["authorization_code"]`, `code_challenge_methods_supported=["S256"]`, `id_token_signing_alg_values_supported=["EdDSA"]`, `scopes_supported=["openid","profile","email"]`, `claims_supported=[...]`, `dpop_signing_alg_values_supported=["EdDSA"]`.
    - GET `/jwks.json` returns `JwksPort.getPublicJwks()` with `Cache-Control: public, max-age=300`.
  - [ ] Create `packages/auth-hono/src/oauth/router.ts`:
    - `createOAuthRouter(options: { ports, issuer, loginUrl, consentUrl })` → `Hono` mounting authorize/token/userinfo/revoke/introspect/consent-decision endpoints under a configurable subprefix (default `/oauth`).
    - Separate `createWellKnownRouter(options: { ports, issuer })` for root-mounted discovery + jwks.
  - [ ] Update `packages/auth-hono/src/index.ts` to re-export the new `oauth` subtree.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-auth-hono ENV=test-feat-auth-oidc`
    - [ ] **Package tests**
      - [x] new: `packages/auth-hono/tests/oauth-authorize.test.ts` (PKCE present, redirect_uri exact match + negative URI cases, unknown client → 400, invalid scope → redirect/error, normal no session → login redirect, prompt=none no session → redirect `login_required`, valid session → 302 to consent URL with sealed state)
      - [x] new: `packages/auth-hono/tests/oauth-token.test.ts` (PKCE verify success, redirect_uri mismatch → invalid_grant, PKCE mismatch → invalid_grant, code reuse → invalid_grant, OAuth-only scope returns no id_token, nonce copied verbatim, wrong client secret → 401, DPoP-bound client without DPoP header → 400, DPoP-bound client with valid DPoP → 200 + cnf on access_token/id_token)
      - [ ] new: `packages/auth-hono/tests/oauth-dpop-proof.test.ts` (htm mismatch, htu mismatch, stale iat, duplicate jti, missing/wrong ath on resource calls)
      - [ ] new: `packages/auth-hono/tests/oauth-userinfo.test.ts` (valid bearer → claims, revoked token → 401, DPoP-bound token requires proof, jkt mismatch → 401, unknown scopes rejected rather than filtered)
      - [ ] new: `packages/auth-hono/tests/oauth-revoke.test.ts` (idempotent revoke, DPoP-bound token requires DPoP proof to revoke)
      - [ ] new: `packages/auth-hono/tests/oauth-introspect.test.ts` (active token → details, revoked → {active: false}, missing client auth → 401)
      - [ ] new: `packages/auth-hono/tests/oauth-wellknown.test.ts` (openid-configuration shape, jwks.json shape, kid rotation reflected)
      - [ ] new: `packages/auth-hono/tests/oauth-router-factory.test.ts` (router mounts all routes, prefix override works, well-known router separates correctly)
      - [x] `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-authorize.test.ts ENV=test-feat-auth-oidc`
      - [x] `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-token.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-dpop-proof.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-userinfo.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-revoke.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-introspect.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-wellknown.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/oauth-router-factory.test.ts ENV=test-feat-auth-oidc`
    - [ ] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [ ] Commit (split into 2-3 commits ≤150 lines each): `feat(BR-39c): Lot 2 oauth core endpoints (authorize/token/userinfo/revoke/introspect/wellknown)`.

- [ ] **Lot 3 — Consent UI component + RP client helper**
  - [ ] Create `packages/auth-ui/src/oauth-client.ts`:
    - `createOAuthClient({ issuer, clientId, redirectUri, scopes, dpop?: { generateKeyPair, store } })` → `{ startAuthorization(state?, nonce?, codeChallenge?) → URL, exchangeCode(code, codeVerifier) → tokens, refreshToken (deferred 39d), revoke(token), userInfo(token) }`.
    - DPoP support: when `dpop` option provided, generates Ed25519 keypair on RP side via SubtleCrypto, attaches `DPoP` proof header to token + userinfo + revoke calls. Key stored via injected `store` adapter (browser app picks IndexedDB / localStorage / in-memory).
    - PKCE: generates `code_verifier` (43-128 chars) and `code_challenge = base64url(SHA-256(code_verifier))`.
    - Discovery: on `createOAuthClient` first call, fetches `${issuer}/.well-known/openid-configuration` and caches it.
  - [ ] Create `packages/auth-ui/src/oauth-consent.ts`:
    - Export `OAuthConsentTransport`, `OAuthConsentDetails`, `OAuthConsentDecision`, and `OAuthConsentLabels`.
    - `OAuthConsentTransport` methods: `getConsent(input: { state: string }) → { clientName, scopes, redirectUri }` and `submitConsentDecision(input: { state: string; decision: 'approve' | 'deny' }) → { redirectTo: string }`.
  - [ ] Create `packages/auth-ui/src/components/OAuthConsent.svelte`:
    - Svelte 5 component. Props: `{ state: string, transport: OAuthConsentTransport, labels?: Partial<OAuthConsentLabels>, onRedirect?: (url: string) => void, onError?: (error) => void }`.
    - Slots: `branding`, `scope-description`, `footer`.
    - Loads details with `transport.getConsent({ state })`, renders "{clientName} requests access to:" + scope list (with human-friendly descriptions from labels), redirect destination preview, Approve / Deny buttons.
    - Calls `transport.submitConsentDecision({ state, decision })`; host navigation happens through `onRedirect(redirectTo)` or a returned URL handled by the wrapper.
  - [ ] Create `packages/auth-ui/src/components/OAuthConsent.svelte.d.ts`: matching props/slot types.
  - [ ] Extend `packages/auth-ui/src/labels.ts` with `createDefaultOAuthConsentLabels` (EN) + `createFrenchOAuthConsentLabels` (FR).
  - [ ] Update `packages/auth-ui/src/index.ts` to re-export `oauth-client`, `oauth-consent`, and component types.
  - [ ] Update `packages/auth-ui/package.json` `exports` map with `./oauth-client` + `./components/OAuthConsent.svelte`.
  - [ ] Lot 3 gate:
    - [ ] `make typecheck-auth-ui ENV=test-feat-auth-oidc`
    - [ ] **Package tests**
      - [ ] new: `packages/auth-ui/tests/oauth-client.test.ts` (PKCE generation, discovery fetch + cache, authorize URL shape, exchange code happy path, exchange code error mapping, DPoP keypair generation + proof header attachment)
      - [ ] new: `packages/auth-ui/tests/oauth-consent.test.ts` (loads details via `OAuthConsentTransport`, renders client name + scopes, approve/deny call `submitConsentDecision`, redirect callback receives returned URL, label override works)
      - [ ] `make test-packages SCOPE=packages/auth-ui/tests/oauth-client.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-packages SCOPE=packages/auth-ui/tests/oauth-consent.test.ts ENV=test-feat-auth-oidc`
    - [ ] `make build-auth-ui ENV=test-feat-auth-oidc`
    - [ ] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [ ] Commit: `feat(BR-39c): Lot 3 oauth-client helper + OAuthConsent component`.

- [ ] **Lot 4 — Sentropic host adapter + ports wiring + UI thin wrappers**
  - [ ] Create `api/src/routes/auth/oauth.ts`:
    - Imports `createOAuthRouter` from `@sentropic/auth-hono`.
    - Wires Sentropic-side `oauthStateStorePort` + `jwksPort` + reuses existing `AuthHonoPorts` (users, sessions, clock, random, auditLog).
    - Issuer URL = `env.OAUTH_ISSUER_URL` when set; otherwise derive the API origin from `AUTH_CALLBACK_BASE_URL`, request origin, or `http://localhost:${API_PORT}` in dev/test. The issuer MUST NOT include `/api/v1/auth/oauth`.
    - Login URL = `${UI_BASE_URL}/auth/login` with sealed continuation; consent URL = `${UI_BASE_URL}/auth/oauth/consent`.
    - Export `oauthRouter`.
  - [ ] Create `api/src/routes/well-known.ts`:
    - Imports `createWellKnownRouter` from `@sentropic/auth-hono`.
    - Same ports / issuer.
    - Exports `wellKnownRouter`.
  - [ ] Update `api/src/routes/auth/index.ts` to mount `oauthRouter` under `/oauth`.
  - [ ] Update `api/src/app.ts`:
    - `app.route('/.well-known', wellKnownRouter)` mounted BEFORE the `/api/v1` mounts so it lives at root.
    - Add dedicated OAuth rate limiters before the general `/api/v1/auth/*` limiter: `/api/v1/auth/oauth/token` (20/min per `client_id+IP`) and `/api/v1/auth/oauth/introspect` (60/min per `client_id+IP`).
    - No change to `app.route('/api/v1/auth', authRouter)` (the OAuth subrouter is mounted inside the existing auth router via Lot-4 step above).
  - [ ] Create `api/src/services/auth/oauth-client-seed.ts` and `api/src/scripts/oauth-seed-clients.ts`:
    - Seed `client_id='example-mock-rp'`, `client_secret='example-mock-rp-secret-dev-only'` hashed via `ports.tokens.hashSecret`, `name='Example Mock RP'`, `redirect_uris=['http://localhost:5397/auth/oauth/callback','http://localhost:5173/auth/oauth/callback']`, `allowed_scopes=['openid','profile','email']`, `dpop_bound_access_tokens=false`, `require_pkce=true`.
    - Seed `client_id='example-dpop-rp'`, same redirect URIs, `dpop_bound_access_tokens=true`.
    - Hook E2E seeding through `api/tests/utils/seed-test-data.ts`; UAT seeding runs through `make exec-api CMD="npm run oauth:seed-clients" ... ENV=dev`.
  - [ ] Create `api/src/scripts/oauth-init-keys.ts` and `api/package.json` script `oauth:init-keys`; run it through `make exec-api CMD="npm run oauth:init-keys" ... ENV=<env>` after DB migration to create the first active signing key if none exists.
  - [ ] Create `api/src/services/auth/oauth-token-purge.ts`: registers or exposes a QueueManager-compatible job that calls `oauthStateStore.purgeExpired()` every 5 minutes.
  - [ ] Update `api/src/config/env.ts`: add optional OAuth env vars (`OAUTH_SIGNING_KEK`, `OAUTH_ISSUER_URL`, TTL/skew overrides) and enforce production `OAUTH_SIGNING_KEK` in the JWKS adapter.
  - [ ] Create `ui/src/lib/services/oauth-transport.ts`: Sentropic-side adapter calling `/auth/oauth/*` endpoints through `ui/src/lib/utils/api.ts` (do not prefix `/api/v1`; `apiFetch` already prefixes `API_BASE_URL`).
  - [ ] Create `ui/src/routes/auth/oauth/consent/+page.svelte`: thin wrapper rendering `<OAuthConsent />` from `@sentropic/auth-ui`. Pulls sealed `state` from URL params, passes it to the component transport, and navigates to the returned `redirectTo` on approve/deny.
  - [ ] Create `ui/src/routes/auth/oauth/callback/+page.svelte`: example RP-side callback wrapper for testing locally (would normally live in the consumer app). Extracts `code` + `state`, calls `oauthClient.exchangeCode`, displays resulting tokens (dev-only, hidden behind `import.meta.env.DEV` check).
  - [ ] Lot 4 gate:
    - [ ] `make typecheck-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] `make lint-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] `make typecheck-ui ENV=test-feat-auth-oidc`
    - [ ] `make lint-ui ENV=test-feat-auth-oidc`
    - [ ] **API integration tests** (use real Postgres adapters via Sentropic test stack)
      - [ ] new: `api/tests/api/auth/oauth-authorize.test.ts` (full flow against test DB, seeded mock RP, no auth → 401, with session cookie → redirect to consent URL with state)
      - [ ] new: `api/tests/api/auth/oauth-token.test.ts` (POST /token authorization_code grant, PKCE verify, redirect_uri equality, single-use enforcement, public/confidential client auth behavior, DPoP-bound flow for example-dpop-rp)
      - [ ] new: `api/tests/api/auth/oauth-userinfo.test.ts` (bearer flow + revocation interaction)
      - [ ] new: `api/tests/api/auth/oauth-revoke-introspect.test.ts` (revoke happy path + introspect after revoke returns active:false)
      - [ ] new: `api/tests/api/auth/oauth-wellknown.test.ts` (GET /.well-known/openid-configuration + /.well-known/jwks.json shape + issuer claim)
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-authorize.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-token.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-userinfo.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-revoke-introspect.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-wellknown.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] **UI tests (TypeScript only)**
      - [ ] new: `ui/tests/utils/oauth-transport.test.ts` (transport methods call `/auth/oauth/*` paths, error mapping, 401 → onUnauthorized callback)
      - [ ] `make test-ui SCOPE=tests/utils/oauth-transport.test.ts ENV=test-feat-auth-oidc`
    - [ ] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [ ] Commit (split ≤150 lines): `feat(BR-39c): Lot 4 sentropic api + ui wiring for oauth idp`.

- [ ] **Lot 5 — Mock RP integration proof (in-process, no host)**
  - [ ] Create `packages/auth-hono/tests/example-oauth-rp.test.ts`:
    - In-process mock RP using a local minimal RP helper inside the test file; do not add a cross-package dev-dependency from `auth-hono` to `auth-ui`.
    - Walks complete flow: `authorize → consent (auto-approve in test) → callback → token → userinfo → revoke → userinfo expecting 401`.
    - Variant 1: bearer (no DPoP). Variant 2: DPoP-bound with Ed25519 keypair generated by mock RP.
    - Uses in-memory `oauthStateStore` + in-memory `JwksPort` fixtures from Lot 1.
    - Pattern mirrors BR-39a `packages/auth-ui/tests/example-admin-fetch-transport.test.ts`.
  - [ ] Lot 5 gate:
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests/example-oauth-rp.test.ts ENV=test-feat-auth-oidc`
    - [ ] `make build-auth-hono ENV=test-feat-auth-oidc`
    - [ ] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [ ] Commit: `test(BR-39c): Lot 5 in-process mock RP end-to-end integration test`.

- [ ] **Lot 6 — E2E full stack OAuth flow**
  - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`.
  - [ ] new: `e2e/tests/02-auth-oauth-authorization-code.spec.ts`:
    - Existing user signs in via passkey (reuse BR-39a/b helper).
    - Browser navigates to `http://localhost:9197/api/v1/auth/oauth/authorize?response_type=code&client_id=example-mock-rp&redirect_uri=http://localhost:5397/auth/oauth/callback&scope=openid+profile+email&code_challenge=...&code_challenge_method=S256&state=test-state&nonce=test-nonce`.
    - Consent screen renders; user clicks Approve.
    - Browser redirected to `/auth/oauth/callback?code=...&state=test-state`.
    - Callback page exchanges code via `oauthClient.exchangeCode` and verifies received `id_token` contains `iss`, `sub`, `aud`, `nonce=test-nonce`, `acr=urn:sentropic:loa:passkey-fresh`, `auth_time`.
    - Calls `http://localhost:9197/api/v1/auth/oauth/userinfo` with received bearer; verifies email + profile claims returned.
  - [ ] new: `e2e/tests/02-auth-oauth-revoke.spec.ts`:
    - Continues from above (or independent setup): obtains token, calls `http://localhost:9197/api/v1/auth/oauth/revoke` with token, subsequent userinfo call returns 401.
  - [ ] new: `e2e/tests/02-auth-oauth-wellknown.spec.ts`:
    - Unauthenticated GET `http://localhost:9197/.well-known/openid-configuration` → 200 with correct shape, issuer == `http://localhost:9197`.
    - Unauthenticated GET `http://localhost:9197/.well-known/jwks.json` → 200 with EdDSA Ed25519 key listed.
  - [ ] Lot 6 gate:
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-oauth-authorization-code.spec.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-oauth-revoke.spec.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`
    - [ ] `make test-e2e E2E_SPEC=tests/02-auth-oauth-wellknown.spec.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`
    - [ ] `make clean ENV=e2e-feat-auth-oidc`
  - [ ] Commit: `test(BR-39c): Lot 6 E2E oauth authorization-code + revoke + wellknown`.

- [ ] **Lot N-2 — UAT (web app only; Chrome ext + VSCode ext are out of scope)**
  - [ ] Web app setup:
    - [ ] Push branch before UAT: `git push origin feat/auth-oidc`.
    - [ ] Confirm root workspace `/home/antoinefa/src/sentropic` is commit-identical to branch HEAD.
    - [ ] Run user UAT from root with `API_PORT=8787 UI_PORT=5173 MAILDEV_UI_PORT=1080 ENV=dev`.
    - [ ] Bootstrap first signing key: `make exec-api CMD="npm run oauth:init-keys" API_PORT=8787 UI_PORT=5173 MAILDEV_UI_PORT=1080 ENV=dev`.
    - [ ] Seed example mock RP client into dev DB: `make exec-api CMD="npm run oauth:seed-clients" API_PORT=8787 UI_PORT=5173 MAILDEV_UI_PORT=1080 ENV=dev`.
  - [ ] Web app evolution tests:
    - [ ] Open `http://localhost:8787/.well-known/openid-configuration` → verify JSON returns and `issuer` claim matches `http://localhost:8787`.
    - [ ] Open `http://localhost:8787/.well-known/jwks.json` → verify at least one Ed25519 key returned with `use=sig` and `alg=EdDSA`.
    - [ ] As signed-in user, open `http://localhost:8787/api/v1/auth/oauth/authorize?response_type=code&client_id=example-mock-rp&redirect_uri=http://localhost:5173/auth/oauth/callback&scope=openid+profile+email&code_challenge=<S256-of-verifier>&code_challenge_method=S256&state=uat-1&nonce=uat-1-nonce`.
    - [ ] Verify consent screen renders with client name "Example Mock RP" and 3 scopes.
    - [ ] Click Approve → verify redirect to `/auth/oauth/callback?code=...&state=uat-1`.
    - [ ] Callback page shows received `id_token` (dev-mode display), verify `nonce=uat-1-nonce` + `acr=urn:sentropic:loa:passkey-fresh` + `auth_time` present.
    - [ ] Verify access_token grants `/userinfo` access with expected claims.
    - [ ] POST `http://localhost:8787/api/v1/auth/oauth/revoke` with `token=<access_token>` → 200, subsequent userinfo call returns 401.
  - [ ] Web app non-regression tests:
    - [ ] Existing passkey login at `/auth/login` still works (no regression on BR-39a/b flows).
    - [ ] Existing protected routes still require valid session.
    - [ ] Existing `/auth/devices` still lists / renames / revokes credentials.
    - [ ] Existing magic-link verify at `/auth/magic-link/verify` still works.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` row 24 (`@sentropic/auth-hono`) to add: "+ OAuth2/OIDC IdP surface (BR-39c): `/oauth/{authorize,token,userinfo,revoke,introspect}` + `/.well-known/openid-configuration` + `/.well-known/jwks.json`; PKCE-only auth-code grant; Ed25519 JWT signing with JWKS rotation; DPoP opt-in per client (RFC 9449); `OauthStateStorePort` + `JwksPort` for storage abstraction; `acr` + `auth_time` claims emitted from passkey login for 39j step-up consumers." Update version reference to 0.3.0.
  - [ ] Update row 25 (`@sentropic/auth-ui`) to add: "+ `<OAuthConsent />` Svelte component + `oauth-client.ts` RP-side helper with PKCE + optional DPoP keypair management (BR-39c)." Update version to 0.3.0.
  - [ ] Update `packages/auth-hono/README.md`:
    - Add `## OAuth2 / OIDC IdP` section with quick-start recipe, ports diagram, and a worked example mounting the OAuth router + well-known router.
    - Document DPoP opt-in flow and how the host wires the consent URL.
  - [ ] Update `packages/auth-ui/README.md`:
    - Add `## <OAuthConsent /> Component` section with props/slots/labels.
    - Add `## oauth-client.ts Helper` section with API surface and DPoP example.
  - [ ] Append OAuth2 flow diagram to `spec/WORKFLOW_AUTH.md`.
  - [ ] Integrate `spec/SPEC_BR39c_OAUTH_OIDC_IDP.md` content into the two specs above (boundaries + workflow), then `git rm spec/SPEC_BR39c_OAUTH_OIDC_IDP.md`.
  - [ ] Commit: `docs(BR-39c): Lot N-1 spec + readme consolidation`.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint:
    - [ ] `make typecheck-auth-hono ENV=test-feat-auth-oidc`
    - [ ] `make typecheck-auth-ui ENV=test-feat-auth-oidc`
    - [ ] `make typecheck-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] `make typecheck-ui ENV=test-feat-auth-oidc`
    - [ ] `make lint-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] `make lint-ui ENV=test-feat-auth-oidc`
  - [ ] Retest packages:
    - [ ] `make test-auth-hono SCOPE=packages/auth-hono/tests ENV=test-feat-auth-oidc`
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests ENV=test-feat-auth-oidc`
  - [ ] Retest API (full):
    - [ ] `make test-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
  - [ ] Retest UI:
    - [ ] `make test-ui ENV=test-feat-auth-oidc`
  - [ ] Retest E2E (per `.github/workflows/ci.yml` group split; auth E2E land in group `00-02`):
    - [ ] `make build-api build-ui-image API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`
    - [ ] `make clean test-e2e E2E_GROUP=00-02 API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`
    - [ ] `make clean test-e2e E2E_GROUP=03-05 API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`
    - [ ] `make clean test-e2e E2E_GROUP=06-08 API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`
  - [ ] Retest AI flaky tests (non-blocking; expect `main` parity):
    - [ ] `make test-api-ai API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc` (document any flake signature)
  - [ ] Record explicit user sign-off for any AI flaky acceptance.
  - [ ] Bump package versions:
    - [ ] `packages/auth-hono/package.json`: `0.2.1 → 0.3.0` (minor: new OAuth2/OIDC surface).
    - [ ] `packages/auth-ui/package.json`: `0.2.0 → 0.3.0` (minor: new `<OAuthConsent />` + `oauth-client.ts`).
  - [ ] CI publish lane: no bootstrap needed (OIDC trusted publisher already attached to both packages from BR-39a/b merges).
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body via `gh pr create --title "feat(BR-39c): OAuth2/OIDC IdP" --body-file BRANCH.md` (or update existing PR if branch already pushed).
  - [ ] Final gate step 2: run/verify branch CI on PR; resolve any remaining blockers. CI was green on `main`; any failure IS a branch problem.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge via merge-commit (per §0 repo merge policy).

## Deferred to BR-39d
- `client_credentials` grant_type + `@sentropic/auth-client` npm helper.
- `createRequireServiceAuth({ scopes })` Hono middleware.
- `service_clients` table.

## Deferred to BR-39e
- Multi-tenant `tenant_id` column on users/credentials/sessions/email_verifications.
- Cross-tenant SSO via OIDC Federation 1.0.

## Deferred to BR-39h
- Unified `identities` table merging `oauth_clients` + `service_clients`.
- Bridge with `mcp__h2a__h2a_nhi_*` MCP tools.
- Attestation on identity registration.

## Deferred to BR-39i
- RFC 8693 Token Exchange grant_type.
- Chained `act` claims in delegated tokens.
- `<DelegateToAgent />` Svelte consent screen.
- `delegation_grants` table + revoke endpoint.

## Deferred to BR-39j
- ACR enforcement middleware `createRequireAcr({ minAcr, maxAuthAge })`.
- `<AuthStepUp />` Svelte component.
- `urn:sentropic:loa:passkey-1d` and freshness window enforcement.

## Deferred to BR-39k
- Delegation of MFA / step-up to agents under explicit consent.
- Policy fields: `max_uses`, `rate_limit`, `tenant_scope`, `resource_scope`.
- Hard stops: `account:delete`, `billing:change`, `mfa:reset`, `delegation:revoke`.

## Deferred to BR-39l
- OAuth Dynamic Client Registration (RFC 7591).
- MCP + claude.ai connector glue.
- `packages/auth-hono/RECIPES.md` example flows.

## Deferred to BR-39f / BR-39g
- Per-tenant branding (39f).
- Admin UI for OAuth clients / service clients / tenants / branding (39g).
