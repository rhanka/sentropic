# Feature: BR-39c OAuth2 / OIDC Identity Provider

## Objective
Turn `@sentropic/auth-hono` into a standard OAuth2 + OpenID Connect Identity Provider (IdP) so external apps (immo, diag, paas tenant apps, and the example mock RP shipped with the package) can federate users via "Login with Sentropic". Adds `<OAuthConsent />` to `@sentropic/auth-ui` and wires the Sentropic API/UI as the first live consumer pair.

## Scope / Guardrails
- Scope limited to OAuth2/OIDC IdP surface: `authorize`, `token`, `userinfo`, `revoke`, `introspect` endpoints, `.well-known/openid-configuration` + `.well-known/jwks.json` discovery, Ed25519 JWT signing with JWKS rotation, PKCE-only auth-code flow, DPoP opt-in per client (RFC 9449), oauth state-store port abstraction, `<OAuthConsent />` Svelte component, RP-side helper `oauth-client.ts`, Sentropic API host adapter + UI thin wrappers, one Drizzle migration (`oauth_clients` + `authorization_codes` + `revoked_tokens` + `id_token_signing_keys`), seeded mock RP for integration tests.
- Out of scope (pushed to BR-39d/e/h/i/j/k/l per `project_br39_full_roadmap`): `client_credentials` grant (39d), multi-tenant (39e), unified `identities` table (39h), Token Exchange RFC 8693 + chained `act` claims (39i), step-up MFA enforcement / `<AuthStepUp />` middleware (39j), MFA delegation policies (39k), MCP Dynamic Client Registration RFC 7591 (39l), per-tenant branding (39f), admin UI (39g).
- The IdP must remain host-adapter driven: no direct app-store / SvelteKit-nav / Sentropic-DB imports from `packages/**` source.
- One migration max in `api/drizzle/*.sql`: a single consolidated file `0027_oauth_clients.sql` containing all 4 new tables.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/feat-auth-oidc`.
- Automated test campaigns run on dedicated environments (`ENV=test-feat-auth-oidc` for unit/integration, `ENV=e2e-feat-auth-oidc` for E2E), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA before sign-off).
- In every `make` command, the concrete branch environment value must be passed as the last argument.
- All new text, comments, errors, OpenAPI schemas, claim names, and code in English.
- Package version bumps mandatory for `packages/auth-hono` (0.2.1 → 0.3.0, minor for new OAuth2/OIDC surface) and `packages/auth-ui` (0.2.0 → 0.3.0, minor for new `<OAuthConsent />` + `oauth-client.ts`).
- No bootstrap publish needed (both packages already published with OIDC trusted publisher attached).
- No new external runtime dep beyond `jose` (already peer dep of `auth-hono`) for JWT signing. DPoP proof verification reuses `jose`. Postgres `pgcrypto` extension used for at-rest encryption of signing private keys.

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
  - `packages/auth-hono/tests/oauth-*.test.ts` (new — see test list below)
  - `packages/auth-hono/tests/example-oauth-rp.test.ts` (new)
  - `packages/auth-hono/README.md`
  - `packages/auth-ui/package.json`
  - `packages/auth-ui/src/oauth-client.ts` (new)
  - `packages/auth-ui/src/components/OAuthConsent.svelte` (new)
  - `packages/auth-ui/src/components/OAuthConsent.svelte.d.ts` (new)
  - `packages/auth-ui/src/index.ts` (re-export)
  - `packages/auth-ui/tests/oauth-client.test.ts` (new)
  - `packages/auth-ui/tests/oauth-consent.test.ts` (new)
  - `packages/auth-ui/README.md`
  - `package-lock.json` (workspace lockfile only, no new top-level deps expected)
  - `api/package.json` (workspace ref bump only if needed)
  - `api/drizzle/0027_oauth_clients.sql` (the single new migration)
  - `api/src/db/schema.ts` (add new tables matching the migration)
  - `api/src/services/auth/oauth-state-adapter.ts` (new — Postgres impl of `oauthStateStore` port)
  - `api/src/services/auth/jwks-adapter.ts` (new — Postgres-backed Ed25519 key store)
  - `api/src/routes/auth/oauth.ts` (new — mounts oauth router with Sentropic adapters)
  - `api/src/routes/auth/index.ts` (extend to mount `oauth` subrouter)
  - `api/src/routes/well-known.ts` (new — root-mounted `/.well-known/openid-configuration` + `/.well-known/jwks.json`)
  - `api/src/app.ts` (mount `well-knownRouter` at root path)
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
  - `.env` (worktree-local only — add `OAUTH_SIGNING_KEK`, `OAUTH_ISSUER_URL` for branch test envs)
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
  - `Makefile` only if `test-packages` SCOPE filtering on `packages/auth-hono/tests/oauth-*.test.ts` requires a new target (existing `make test-packages SCOPE=...` should cover; defensive exception only) — `BR39c-EX2`.
  - `.env.example` if `OAUTH_*` env vars must be documented for downstream — defer to Lot N-1 docs lot if needed, `BR39c-EX3`.

- **Exception process**:
  - Declare exception ID `BR39c-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop

- `BR39c-D1` `decided`: Identities split. `oauth_clients` table created here in 39c. `service_clients` separate, lands in 39d. Fusion to unified `identities` table deferred to 39h. No `identities` table introduced in 39c.
- `BR39c-D2` `decided`: DPoP (RFC 9449) is opt-in per client via `dpop_bound_access_tokens` boolean column on `oauth_clients`. Support implemented and tested in 39c, but no client class enforces it yet (will be mandatory for `type ∈ {agent, nhi, mcp_connector}` from 39h+). Ed25519 keypair on RP side, stored client-side only (in `oauth-client.ts` helper). Cited as RFC 9449.
- `BR39c-D3` `decided`: Delegation TTL hard cap 24h, default 1h. Delegation flow lands in 39i; in 39c the `access_tokens.expires_at` / `revoked_tokens.expires_at` column policy accommodates this — no DB-level CHECK constraint that forbids > 24h.
- `BR39c-D4` `decided`: Step-up freshness enforcement lands in 39j, but `id_token` MUST emit `acr` + `auth_time` claims from 39c so 39j consumers can read them. ACR levels: `urn:sentropic:loa:bearer | urn:sentropic:loa:passkey-1d | urn:sentropic:loa:passkey-fresh`. In 39c, every successful passkey login emits `acr=urn:sentropic:loa:passkey-fresh` + `auth_time=now`.
- `BR39c-D5` `decided`: JWT signing algorithm is Ed25519 only. No RS256 fallback. JWKS includes ONE `active=true` key + N `active=false` rotated keys. Key generation uses `crypto.generateKeyPairSync('ed25519')`. Storage: Postgres with `pgcrypto` `pgp_sym_encrypt` keyed by `OAUTH_SIGNING_KEK` env var (operator-rotated).
- `BR39c-D6` `decided`: Auth-code / token storage abstracted from day 1 via `AuthHonoPorts.oauthStateStore` port interface. Methods: `saveAuthCode(code, payload, ttlSec)`, `consumeAuthCode(code) → atomic single-use`, `saveTokenMeta(jti, meta, ttlSec)`, `revokeToken(jti)`, `isTokenRevoked(jti)`, `purgeExpired() → number`. First impl is Postgres via Drizzle in `api/src/services/auth/oauth-state-adapter.ts`. Tests use an in-memory adapter living in `packages/auth-hono/tests/__fixtures__/memory-oauth-state-store.ts`. No Redis dep introduced in 39c; `auth-hono` core never imports Postgres.
- `BR39c-Q1` `decided` (2026-05-31): Mount OAuth core endpoints at `/api/v1/auth/oauth/{authorize,token,userinfo,revoke,introspect}` for consistency with existing Sentropic auth router (`api/src/app.ts:170`). Well-known endpoints `/.well-known/openid-configuration` and `/.well-known/jwks.json` exposed at ROOT (OIDC mandate). The `issuer` claim = `${PUBLIC_BASE_URL}/api/v1/auth/oauth`. Reversible while no RPs deployed.
- `BR39c-Q2` `decided` (2026-05-31): Encryption-at-rest = Postgres `pgcrypto` `pgp_sym_encrypt(private_key_pem, env('OAUTH_SIGNING_KEK'))`. Reasons: pg already deployed and trusted, KEK rotation independent of app code, audit trail via pg logs. `OAUTH_SIGNING_KEK` env var documented in Lot N-1 docs (`.env.example` via `BR39c-EX3` if needed).

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
- [ ] Frozen decisions BR39c-D1..D6 acknowledged verbatim; no re-litigation.
- [ ] Open questions BR39c-Q1, BR39c-Q2 resolved by conductor (or Lot 0/1 explicitly blocked until resolved).
- [ ] Commit policy: `git add <specific-files>` then `make commit MSG="type(BR-39c): description"`; never `git add .` / `git add -A` / direct `git commit`.

- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read all mandatory files (read order above).
  - [ ] Confirm worktree `tmp/feat-auth-oidc` is on branch `feat/auth-oidc`, baseline `origin/main` `ff32a06f`.
  - [ ] Run `make ps-all` and confirm slot-2 ports (9197 / 5397 / 1297) are free or owned by this worktree.
  - [ ] Confirm BR-39a v0.2.0 and BR-39b v0.2.1 are merged on `main` (already verified at branch creation).
  - [ ] Confirm scope boundaries (Allowed / Forbidden / Conditional) and declare any `BR39c-EXn` if needed.
  - [ ] Wait for conductor resolution of `BR39c-Q1` (mount path) and `BR39c-Q2` (KEK mechanism) before Lot 1.
  - [ ] Create initial draft of `spec/SPEC_BR39c_OAUTH_OIDC_IDP.md` (consolidation spec — temp, deleted at Lot N-1). Include: target endpoints, claim shape, JWKS shape, state-store port interface, DPoP binding contract, mock RP contract.
  - [ ] Commit: `git add BRANCH.md spec/SPEC_BR39c_OAUTH_OIDC_IDP.md && make commit MSG="chore(BR-39c): Lot 0 baseline + spec draft"`.

- [ ] **Lot 1 — Schemas, ports, JWKS service**
  - [ ] Extend `packages/auth-hono/src/ports.ts`:
    - Add `OauthClientRecord`, `AuthCodePayload`, `TokenMeta`, `OauthStateStorePort` interfaces.
    - Add `JwksKeyRecord`, `JwksPort` interface (read-only: list + getActive — write/rotation is host-owned).
    - Add `oauthStateStore: OauthStateStorePort` + `jwks: JwksPort` to `AuthHonoPorts`.
  - [ ] Create `packages/auth-hono/src/oauth/jwks-service.ts`:
    - `createJwksService({ jwksPort, clock })` returning `{ getPublicJwks(), signIdToken(payload, kid?), verifyIdToken(jwt) }`.
    - Uses `jose` `SignJWT` with EdDSA / `crypto.KeyObject` from Ed25519 private key.
    - `getPublicJwks()` shape per RFC 7517: `{ keys: [{ kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA', kid, x, status: 'active'|'rotated' }] }`.
  - [ ] Create `packages/auth-hono/src/oauth/state-store-types.ts` exporting all type contracts for D6.
  - [ ] Create `api/src/db/schema.ts` additions for new tables (will materialize via Drizzle generate into `0027_oauth_clients.sql`):
    - `oauth_clients` (id text PK, client_id text unique, client_secret_hash text nullable for public clients, name text, redirect_uris jsonb, allowed_scopes jsonb, grant_types jsonb default `["authorization_code","refresh_token"]`, response_types jsonb default `["code"]`, token_endpoint_auth_method text default `"client_secret_basic"`, dpop_bound_access_tokens boolean default false, require_pkce boolean default true, created_at, updated_at, owner_user_id text fk users.id nullable).
    - `authorization_codes` (code text PK, client_id text, user_id text fk users.id, redirect_uri text, scope text, code_challenge text, code_challenge_method text default `"S256"`, dpop_jkt text nullable, nonce text nullable, payload jsonb, expires_at, used_at nullable, created_at).
    - `revoked_tokens` (jti text PK, client_id text, user_id text nullable, revoked_at, expires_at).
    - `id_token_signing_keys` (kid text PK, alg text default `"EdDSA"`, crv text default `"Ed25519"`, public_jwk jsonb, private_key_encrypted bytea, active boolean default true, created_at, rotated_at nullable).
  - [ ] Run `make db-generate ENV=test-feat-auth-oidc` to produce single migration file `api/drizzle/0027_oauth_clients.sql`. If Drizzle generates multiple files, manually consolidate to one before commit (rule: 1 migration max per branch).
  - [ ] Create `api/src/services/auth/jwks-adapter.ts`:
    - Implements `JwksPort` against Postgres via Drizzle.
    - Read path: cache active + last-3 rotated keys for 60s in-process to avoid pg hit on every token issue.
    - Write path: `generateAndStoreNewKey()` (operator-callable only, not auto-boot), `rotateActive(newKid)`.
    - Private-key encryption: `pgp_sym_encrypt(privateKeyPem, env('OAUTH_SIGNING_KEK'))`, decryption via `pgp_sym_decrypt(private_key_encrypted, env('OAUTH_SIGNING_KEK'))`.
  - [ ] Create `api/src/services/auth/oauth-state-adapter.ts`:
    - Postgres impl of `OauthStateStorePort`.
    - `consumeAuthCode(code)` uses `UPDATE authorization_codes SET used_at = now() WHERE code = $1 AND used_at IS NULL RETURNING payload` to guarantee atomic single-use.
    - `purgeExpired()` deletes rows where `expires_at < now()` from both `authorization_codes` and `revoked_tokens`.
  - [ ] Create `packages/auth-hono/tests/__fixtures__/memory-oauth-state-store.ts`: in-memory `OauthStateStorePort` impl for package tests.
  - [ ] Create `packages/auth-hono/tests/__fixtures__/memory-jwks.ts`: in-memory `JwksPort` impl that pre-generates one Ed25519 keypair.
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-auth-hono ENV=test-feat-auth-oidc`
    - [ ] `make typecheck-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] **API tests**
      - [ ] new file: `api/tests/unit/auth/jwks-adapter.test.ts` (covers: getActive, list rotated, encrypt/decrypt round-trip, KEK rotation simulation)
      - [ ] new file: `api/tests/unit/auth/oauth-state-adapter.test.ts` (covers: saveAuthCode TTL, consumeAuthCode atomic single-use under 2 concurrent calls, revokeToken, purgeExpired)
      - [ ] `make test-api SCOPE=tests/unit/auth/jwks-adapter.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [ ] `make test-api SCOPE=tests/unit/auth/oauth-state-adapter.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] **Package tests**
      - [ ] new file: `packages/auth-hono/tests/oauth-jwks-service.test.ts` (covers: signIdToken with Ed25519, verifyIdToken success, verifyIdToken with rotated kid succeeds, verifyIdToken with unknown kid fails, getPublicJwks shape)
      - [ ] `make test-packages SCOPE=packages/auth-hono/tests/oauth-jwks-service.test.ts ENV=test-feat-auth-oidc`
    - [ ] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [ ] Commit (target ≤150 lines/commit; split if needed): `chore(BR-39c): Lot 1 oauth schemas, ports, jwks service`.

- [ ] **Lot 2 — OAuth2/OIDC core endpoints**
  - [ ] Pending: resolution of `BR39c-Q1` for mount path. Assuming recommended decision (`/api/v1/auth/oauth/*` + root `/.well-known/*`), implement below.
  - [ ] Create `packages/auth-hono/src/oauth/authorize-handler.ts`:
    - GET handler validates `response_type=code`, `client_id` exists in `oauthStateStore.findClient(clientId)`, `redirect_uri` exact match against `client.redirect_uris`, `code_challenge` present + `code_challenge_method=S256`, optional `dpop_jkt` if client opted in, `scope` filtered against `client.allowed_scopes`, `state` passthrough, `nonce` passthrough, `prompt` / `login_hint` honored.
    - Returns 302 redirect to host-configurable consent URL with sealed state token (so consent page can re-validate without trusting query params).
    - Errors per RFC 6749 §4.1.2.1 (`error=invalid_request|unauthorized_client|access_denied|...`).
  - [ ] Create `packages/auth-hono/src/oauth/token-handler.ts`:
    - POST handler for `grant_type=authorization_code` only in 39c (refresh-token flow deferred to 39d gate).
    - PKCE verification: SHA-256(`code_verifier`) base64url == stored `code_challenge`.
    - DPoP binding: if `client.dpop_bound_access_tokens` true, require `DPoP: <proof-jwt>` header; verify proof per RFC 9449 §4; bind issued access_token via `cnf={jkt}` claim.
    - Atomic `consumeAuthCode(code)` — second call returns null → 400 `invalid_grant`.
    - Issues `access_token` (opaque JWT signed with active Ed25519 key, claims: `iss, sub, aud=client_id, exp, iat, jti, scope, cnf?, acr, auth_time`), `id_token` (OIDC, claims: `iss, sub, aud=client_id, exp, iat, nonce?, auth_time, acr, email?, email_verified?, name?` based on scope), and `token_type: "Bearer"` (or `"DPoP"` if bound).
    - `saveTokenMeta(jti, { clientId, userId, scope, expiresAt, dpopJkt? })` for later revocation check.
  - [ ] Create `packages/auth-hono/src/oauth/userinfo-handler.ts`:
    - GET / POST handler accepts `Authorization: Bearer <jwt>` or `Authorization: DPoP <jwt>` + `DPoP: <proof>`.
    - Verifies JWT signature via JWKS, checks `isTokenRevoked(jti)`, returns claims based on issued scope.
  - [ ] Create `packages/auth-hono/src/oauth/revoke-handler.ts`:
    - POST per RFC 7009. Accepts `token` + optional `token_type_hint`. Calls `revokeToken(jti)`. Idempotent.
    - If token was DPoP-bound, requires DPoP proof to revoke (prevents arbitrary revoke by token-theft).
  - [ ] Create `packages/auth-hono/src/oauth/introspect-handler.ts`:
    - POST per RFC 7662. Requires client authentication (Basic auth via `oauth_clients.client_secret_hash`).
    - Returns `{active: true|false, scope, client_id, sub, exp, iat, jti, token_type, cnf?}` for active tokens, `{active: false}` for revoked/expired/unknown.
  - [ ] Create `packages/auth-hono/src/oauth/wellknown-handler.ts`:
    - GET `/openid-configuration` returns standard OIDC discovery doc: `issuer, authorization_endpoint, token_endpoint, userinfo_endpoint, revocation_endpoint, introspection_endpoint, jwks_uri, response_types_supported=["code"], grant_types_supported=["authorization_code"], code_challenge_methods_supported=["S256"], id_token_signing_alg_values_supported=["EdDSA"], scopes_supported=["openid","profile","email"], claims_supported=[...], dpop_signing_alg_values_supported=["EdDSA"]`.
    - GET `/jwks.json` returns `JwksPort.getPublicJwks()`.
  - [ ] Create `packages/auth-hono/src/oauth/router.ts`:
    - `createOAuthRouter(options: { ports, issuer, consentUrl })` → `Hono` mounting all 5 endpoints under a configurable subprefix (default `/oauth`).
    - Separate `createWellKnownRouter(options: { ports, issuer })` for root-mounted discovery + jwks.
  - [ ] Update `packages/auth-hono/src/index.ts` to re-export the new `oauth` subtree.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-auth-hono ENV=test-feat-auth-oidc`
    - [ ] **Package tests**
      - [ ] new: `packages/auth-hono/tests/oauth-authorize.test.ts` (PKCE present, redirect_uri exact match, unknown client → 400, prompt=none with no session → 401, valid request → 302 to consent URL with sealed state)
      - [ ] new: `packages/auth-hono/tests/oauth-token.test.ts` (PKCE verify success, PKCE mismatch → 400 invalid_grant, code reuse → 400 invalid_grant, DPoP-bound client without DPoP header → 400, DPoP-bound client with valid DPoP → 200 + cnf claim, id_token contains acr=passkey-fresh + auth_time)
      - [ ] new: `packages/auth-hono/tests/oauth-userinfo.test.ts` (valid bearer → claims, revoked token → 401, DPoP-bound token requires proof, scope filtering)
      - [ ] new: `packages/auth-hono/tests/oauth-revoke.test.ts` (idempotent revoke, DPoP-bound token requires DPoP proof to revoke)
      - [ ] new: `packages/auth-hono/tests/oauth-introspect.test.ts` (active token → details, revoked → {active: false}, missing client auth → 401)
      - [ ] new: `packages/auth-hono/tests/oauth-wellknown.test.ts` (openid-configuration shape, jwks.json shape, kid rotation reflected)
      - [ ] new: `packages/auth-hono/tests/oauth-router-factory.test.ts` (router mounts all routes, prefix override works, well-known router separates correctly)
      - [ ] `make test-packages SCOPE=packages/auth-hono/tests/oauth-authorize.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-packages SCOPE=packages/auth-hono/tests/oauth-token.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-packages SCOPE=packages/auth-hono/tests/oauth-userinfo.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-packages SCOPE=packages/auth-hono/tests/oauth-revoke.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-packages SCOPE=packages/auth-hono/tests/oauth-introspect.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-packages SCOPE=packages/auth-hono/tests/oauth-wellknown.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-packages SCOPE=packages/auth-hono/tests/oauth-router-factory.test.ts ENV=test-feat-auth-oidc`
    - [ ] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [ ] Commit (split into 2-3 commits ≤150 lines each): `feat(BR-39c): Lot 2 oauth core endpoints (authorize/token/userinfo/revoke/introspect/wellknown)`.

- [ ] **Lot 3 — Consent UI component + RP client helper**
  - [ ] Create `packages/auth-ui/src/oauth-client.ts`:
    - `createOAuthClient({ issuer, clientId, redirectUri, scopes, dpop?: { generateKeyPair, store } })` → `{ startAuthorization(state?, nonce?, codeChallenge?) → URL, exchangeCode(code, codeVerifier) → tokens, refreshToken (deferred 39d), revoke(token), userInfo(token) }`.
    - DPoP support: when `dpop` option provided, generates Ed25519 keypair on RP side via SubtleCrypto, attaches `DPoP` proof header to token + userinfo + revoke calls. Key stored via injected `store` adapter (browser app picks IndexedDB / localStorage / in-memory).
    - PKCE: generates `code_verifier` (43-128 chars) and `code_challenge = base64url(SHA-256(code_verifier))`.
    - Discovery: on `createOAuthClient` first call, fetches `${issuer}/.well-known/openid-configuration` and caches it.
  - [ ] Create `packages/auth-ui/src/components/OAuthConsent.svelte`:
    - Svelte 5 component. Props: `{ clientName: string, scopes: string[], redirectUri: string, onApprove: () => void, onDeny: () => void, transport: AuthUiTransport, labels?: Partial<OAuthConsentLabels> }`.
    - Slots: `branding`, `scope-description`, `footer`.
    - Renders: branding slot, "{clientName} requests access to:" + scope list (with human-friendly descriptions from labels), redirect destination preview, Approve / Deny buttons.
    - Calls `transport.fetch` (existing `AuthUiTransport.fetch` from BR-39a) to POST consent decision to the host-owned consent endpoint (host wires the URL).
  - [ ] Create `packages/auth-ui/src/components/OAuthConsent.svelte.d.ts`: matching props/slot types.
  - [ ] Extend `packages/auth-ui/src/labels.ts` with `createDefaultOAuthConsentLabels` (EN) + `createFrenchOAuthConsentLabels` (FR).
  - [ ] Update `packages/auth-ui/src/index.ts` to re-export `oauth-client` and component types.
  - [ ] Update `packages/auth-ui/package.json` `exports` map with `./oauth-client` + `./components/OAuthConsent.svelte`.
  - [ ] Lot 3 gate:
    - [ ] `make typecheck-auth-ui ENV=test-feat-auth-oidc`
    - [ ] **Package tests**
      - [ ] new: `packages/auth-ui/tests/oauth-client.test.ts` (PKCE generation, discovery fetch + cache, authorize URL shape, exchange code happy path, exchange code error mapping, DPoP keypair generation + proof header attachment)
      - [ ] new: `packages/auth-ui/tests/oauth-consent.test.ts` (renders client name + scopes, approve calls onApprove + transport, deny calls onDeny + transport, label override works, slot rendering works)
      - [ ] `make test-packages SCOPE=packages/auth-ui/tests/oauth-client.test.ts ENV=test-feat-auth-oidc`
      - [ ] `make test-packages SCOPE=packages/auth-ui/tests/oauth-consent.test.ts ENV=test-feat-auth-oidc`
    - [ ] `make build-auth-ui ENV=test-feat-auth-oidc`
    - [ ] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [ ] Commit: `feat(BR-39c): Lot 3 oauth-client helper + OAuthConsent component`.

- [ ] **Lot 4 — Sentropic host adapter + ports wiring + UI thin wrappers**
  - [ ] Create `api/src/routes/auth/oauth.ts`:
    - Imports `createOAuthRouter` from `@sentropic/auth-hono`.
    - Wires Sentropic-side `oauthStateStorePort` + `jwksPort` + reuses existing `AuthHonoPorts` (users, sessions, clock, random, auditLog).
    - Issuer URL = `${PUBLIC_BASE_URL}/api/v1/auth/oauth` (read from `OAUTH_ISSUER_URL` env, fallback to `process.env.PUBLIC_BASE_URL`).
    - Consent URL = `${UI_BASE_URL}/auth/oauth/consent` (host UI).
    - Export `oauthRouter`.
  - [ ] Create `api/src/routes/well-known.ts`:
    - Imports `createWellKnownRouter` from `@sentropic/auth-hono`.
    - Same ports / issuer.
    - Exports `wellKnownRouter`.
  - [ ] Update `api/src/routes/auth/index.ts` to mount `oauthRouter` under `/oauth`.
  - [ ] Update `api/src/app.ts`:
    - `app.route('/.well-known', wellKnownRouter)` mounted BEFORE the `/api/v1` mounts so it lives at root.
    - No change to `app.route('/api/v1/auth', authRouter)` (the OAuth subrouter is mounted inside the existing auth router via Lot-4 step above).
  - [ ] Seed at least one example OAuth client row for the integration test consumer in `api/src/db/seed.ts` (or whichever seed file is canonical):
    - `client_id='example-mock-rp'`, `name='Example Mock RP'`, `redirect_uris=['http://localhost:9197/oauth/callback','http://localhost:8787/oauth/callback']`, `allowed_scopes=['openid','profile','email']`, `dpop_bound_access_tokens=false`, `require_pkce=true`.
    - And a DPoP-bound variant: `client_id='example-dpop-rp'`, same redirect URIs, `dpop_bound_access_tokens=true`.
  - [ ] Create `ui/src/lib/services/oauth-transport.ts`: Sentropic-side adapter calling its own `/api/v1/auth/oauth/*` endpoints via `ui/src/lib/utils/api.ts`.
  - [ ] Create `ui/src/routes/auth/oauth/consent/+page.svelte`: thin wrapper rendering `<OAuthConsent />` from `@sentropic/auth-ui`. Pulls `client_id`, `scope`, `state` from URL params, fetches client metadata via transport, hands them to the component. On Approve, POSTs to `/api/v1/auth/oauth/consent/decision` (handled inside `authorize-handler`), then receives a redirect URL and navigates to it.
  - [ ] Create `ui/src/routes/auth/oauth/callback/+page.svelte`: example RP-side callback wrapper for testing locally (would normally live in the consumer app). Extracts `code` + `state`, calls `oauthClient.exchangeCode`, displays resulting tokens (dev-only, hidden behind `import.meta.env.DEV` check).
  - [ ] Lot 4 gate:
    - [ ] `make typecheck-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] `make lint-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] `make typecheck-ui ENV=test-feat-auth-oidc`
    - [ ] `make lint-ui ENV=test-feat-auth-oidc`
    - [ ] **API integration tests** (use real Postgres adapters via Sentropic test stack)
      - [ ] new: `api/tests/api/auth/oauth-authorize.test.ts` (full flow against test DB, seeded mock RP, no auth → 401, with session cookie → redirect to consent URL with state)
      - [ ] new: `api/tests/api/auth/oauth-token.test.ts` (POST /token authorization_code grant, PKCE verify, single-use enforcement, DPoP-bound flow for example-dpop-rp)
      - [ ] new: `api/tests/api/auth/oauth-userinfo.test.ts` (bearer flow + revocation interaction)
      - [ ] new: `api/tests/api/auth/oauth-revoke-introspect.test.ts` (revoke happy path + introspect after revoke returns active:false)
      - [ ] new: `api/tests/api/auth/oauth-wellknown.test.ts` (GET /.well-known/openid-configuration + /.well-known/jwks.json shape + issuer claim)
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-authorize.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-token.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-userinfo.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-revoke-introspect.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
      - [ ] `make test-api SCOPE=tests/api/auth/oauth-wellknown.test.ts API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
    - [ ] **UI tests (TypeScript only)**
      - [ ] new: `ui/tests/utils/oauth-transport.test.ts` (transport methods POST correct paths, error mapping, 401 → onUnauthorized callback)
      - [ ] `make test-ui SCOPE=tests/utils/oauth-transport.test.ts ENV=test-feat-auth-oidc`
    - [ ] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [ ] Commit (split ≤150 lines): `feat(BR-39c): Lot 4 sentropic api + ui wiring for oauth idp`.

- [ ] **Lot 5 — Mock RP integration proof (in-process, no host)**
  - [ ] Create `packages/auth-hono/tests/example-oauth-rp.test.ts`:
    - In-process mock RP using `createOAuthClient` from `@sentropic/auth-ui` (via dev-dep `peerDep` import in test only) OR a local minimal RP module if cross-package dev-dep is awkward.
    - Walks complete flow: `authorize → consent (auto-approve in test) → callback → token → userinfo → revoke → userinfo expecting 401`.
    - Variant 1: bearer (no DPoP). Variant 2: DPoP-bound with Ed25519 keypair generated by mock RP.
    - Uses in-memory `oauthStateStore` + in-memory `JwksPort` fixtures from Lot 1.
    - Pattern mirrors BR-39a `packages/auth-ui/tests/example-admin-fetch-transport.test.ts`.
  - [ ] Lot 5 gate:
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests/example-oauth-rp.test.ts ENV=test-feat-auth-oidc`
    - [ ] `make build-auth-hono ENV=test-feat-auth-oidc`
    - [ ] End-of-lot cleanup: `make down ENV=test-feat-auth-oidc`.
  - [ ] Commit: `test(BR-39c): Lot 5 in-process mock RP end-to-end integration test`.

- [ ] **Lot 6 — E2E full stack OAuth flow**
  - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`.
  - [ ] new: `e2e/tests/02-auth-oauth-authorization-code.spec.ts`:
    - Existing user signs in via passkey (reuse BR-39a/b helper).
    - Browser navigates to `/api/v1/auth/oauth/authorize?response_type=code&client_id=example-mock-rp&redirect_uri=http://localhost:5397/auth/oauth/callback&scope=openid+profile+email&code_challenge=...&code_challenge_method=S256&state=test-state&nonce=test-nonce`.
    - Consent screen renders; user clicks Approve.
    - Browser redirected to `/auth/oauth/callback?code=...&state=test-state`.
    - Callback page exchanges code via `oauthClient.exchangeCode` and verifies received `id_token` contains `iss`, `sub`, `aud`, `nonce=test-nonce`, `acr=urn:sentropic:loa:passkey-fresh`, `auth_time`.
    - Calls `/api/v1/auth/oauth/userinfo` with received bearer; verifies email + profile claims returned.
  - [ ] new: `e2e/tests/02-auth-oauth-revoke.spec.ts`:
    - Continues from above (or independent setup): obtains token, calls `/api/v1/auth/oauth/revoke` with token, subsequent `/userinfo` returns 401.
  - [ ] new: `e2e/tests/02-auth-oauth-wellknown.spec.ts`:
    - Unauthenticated GET `/.well-known/openid-configuration` → 200 with correct shape, issuer == expected.
    - Unauthenticated GET `/.well-known/jwks.json` → 200 with EdDSA Ed25519 key listed.
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
    - [ ] Seed example mock RP client into dev DB: `make db-query QUERY="INSERT INTO oauth_clients ..." ENV=dev` (provide concrete SQL in UAT instructions).
  - [ ] Web app evolution tests:
    - [ ] Open `http://localhost:5173/.well-known/openid-configuration` → verify JSON returns and `issuer` claim matches `http://localhost:8787/api/v1/auth/oauth`.
    - [ ] Open `http://localhost:5173/.well-known/jwks.json` → verify at least one Ed25519 key returned with `use=sig` and `alg=EdDSA`.
    - [ ] As signed-in user, open `http://localhost:8787/api/v1/auth/oauth/authorize?response_type=code&client_id=example-mock-rp&redirect_uri=http://localhost:5173/auth/oauth/callback&scope=openid+profile+email&code_challenge=<S256-of-verifier>&code_challenge_method=S256&state=uat-1&nonce=uat-1-nonce`.
    - [ ] Verify consent screen renders with client name "Example Mock RP" and 3 scopes.
    - [ ] Click Approve → verify redirect to `/auth/oauth/callback?code=...&state=uat-1`.
    - [ ] Callback page shows received `id_token` (dev-mode display), verify `nonce=uat-1-nonce` + `acr=urn:sentropic:loa:passkey-fresh` + `auth_time` present.
    - [ ] Verify access_token grants `/userinfo` access with expected claims.
    - [ ] Open `/api/v1/auth/oauth/revoke` (POST with `token=<access_token>`) → 200, subsequent `/userinfo` returns 401.
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
    - [ ] `make test-packages SCOPE=packages/auth-hono/tests ENV=test-feat-auth-oidc`
    - [ ] `make test-packages SCOPE=packages/auth-ui/tests ENV=test-feat-auth-oidc`
  - [ ] Retest API (full):
    - [ ] `make test-api API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=test-feat-auth-oidc`
  - [ ] Retest UI:
    - [ ] `make test-ui ENV=test-feat-auth-oidc`
  - [ ] Retest E2E (per `.github/workflows/ci.yml` group split; auth E2E land in group `00-02`):
    - [ ] `make build-api build-ui-image API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc`
    - [ ] `make clean test-e2e API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc E2E_GROUP=00-02`
    - [ ] `make clean test-e2e API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc E2E_GROUP=03-05`
    - [ ] `make clean test-e2e API_PORT=9197 UI_PORT=5397 MAILDEV_UI_PORT=1297 ENV=e2e-feat-auth-oidc E2E_GROUP=06-08`
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
