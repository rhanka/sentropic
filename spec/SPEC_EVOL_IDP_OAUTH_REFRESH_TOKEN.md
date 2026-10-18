# SPEC_EVOL — OAuth 2.0 Refresh Token for the Sentropic IdP

Status: **specification only** on branch `spec/idp-oauth-refresh-token` (base `origin/main` at `9ed96eb83`). No runtime code, database migration, package version, or deployment manifest changes on this branch; implementation belongs to the BUILD lots in section 10 on separate branches.

## 0. Verbatim owner decision and investigation context

Owner messages (relayed verbatim by `radar-immobilier`, 2026-10-18, recorded in `.tmp/idp-refresh-token/OWNER-DECISION.md`):

- « Au passage farid dit que le relogin oauth est bcp trop frequent pour le mcp »
- « Faut gerer les refresh a la migration immo vers cluster mesh. Relogin aux 15j suffit »
- « Ou gerer le refresh auto comme pour les sieges »

Closed owner decision (2026-10-18, binding):

- Chosen option: **« Refresh OAuth par l'IdP (Recommandé) »**.
- Exact label: the Sentropic IdP issues a standard OAuth refresh token (rotation on every use, reuse detection, revocation, hashed storage) with a **15-day absolute lifetime**; `claude.ai` handles it natively (silent renewal, relogin every 15 days); access tokens stay short (**1 h**); delivered with the migration to `cluster-mesh`; also serves the other Sentropic MCPs.

Companion findings from the `radar-immobilier` investigation (`.tmp/idp-refresh-token/radar-enquete-astra.md`):

1. **Primary cause (high probability):** `OAUTH_ACCESS_TOKEN_TTL_SEC` defaults to `3600` s (`1 h`) and the IdP neither advertises nor issues nor accepts `refresh_token`, while rejecting `offline_access` at `/authorize` with `invalid_scope`. Hosted MCP connectors (`claude.ai`) hold no IdP browser cookie and therefore cannot silently re-run `/authorize` when the 1-hour bearer expires.
2. **Scope error mapping (`@sentropic/mcp-auth` `0.1.0` -> `0.2.2`):** in `0.1.0`, `requiredScopes` was forwarded into `@sentropic/oauth-verify`, turning a missing scope into `401 invalid_token` instead of `403 insufficient_scope`, which can trigger an OAuth re-authentication loop on the client. Fixed in `@sentropic/mcp-auth` `0.2.2` (`b9d15ebf6`, `packages/mcp-auth/src/core.ts:154-184` `[EXISTS]`).
3. **In-memory MCP transport sessions (`radar-immobilier`):** Immo MCP streamable HTTP sessions live in an in-memory `Map` (`30 min` idle timeout, `8 h` max lifetime) and return `HTTP 404` (not `401`) on loss or restart; the client must re-run MCP `initialize` with its still-valid (or freshly renewed) bearer token rather than full OAuth re-consent.

Conventions in this document:

- `[EXISTS]` marks behaviour verified in merged code at baseline `9ed96eb83`, with an exact `file:line` citation.
- `[TO BUILD Lot N]` marks target behaviour assigned to an implementation lot in section 10. Nothing marked `[TO BUILD]` is claimed as merged.
- No secret value appears in this document. Secrets and configuration keys are named by variable only, following `docs/oauth-client-rotation.md`.

## 1. Objective and scope

Specify standard OAuth 2.0 refresh token issuance and `grant_type=refresh_token` renewal in `@sentropic/auth-hono` and the Sentropic API host (`api/src/routes/auth/oauth.ts`, `api/src/services/auth/oauth-state-adapter.ts`) so that authorized OAuth clients — starting with `immo-mcp` during the `cluster-mesh` migration and the other Sentropic MCP clients — silently renew 1-hour access tokens for up to **15 days absolute lifetime** per authorization flow.

In scope:

- Per-client refresh eligibility (`oauth_clients.grant_types` containing `'refresh_token'`) and `offline_access` scope acceptance at `/authorize`.
- Authorization Server metadata advertisement (`grant_types_supported`, `scopes_supported`) on both `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server`.
- Hashed, persistent refresh token families (`oauth_refresh_tokens`) with a 15-day absolute family lifetime (`OAUTH_REFRESH_TOKEN_TTL_SEC`, default `1296000`), single-use atomic rotation on every refresh, and family-wide reuse detection.
- Binding of every refresh token to `(client_id, user_id, tenant_id, scope, resource, dpop_jkt, acr, amr, auth_time)` and live revalidation of user status, subject allowlist, consent grant, tenant membership, and per-client MFA policy at refresh time.
- RFC 7009 `/revoke` and RFC 7662 `/introspect` behaviour for opaque refresh tokens and token families.
- Boundary rules with per-client forced MFA (`spec/SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md`, PR #695, `kvm-gateway`), `@sentropic/mcp-auth`, `cluster-mesh` MCP registry and RFC 8693 token exchange (PR #679, PR #692), and prod-to-preprod identity sync (`spec/SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md`).

Out of scope (cited, not redesigned):

- Changing the 1-hour human access token lifetime (`OAUTH_ACCESS_TOKEN_TTL_SEC = 3600`) or the 15-minute service token lifetime (`OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC = 900`).
- Issuing refresh tokens on `client_credentials` (`RFC 6749 §4.4.3`) or RFC 8693 `urn:ietf:params:oauth:grant-type:token-exchange` (`packages/cluster-mesh/src/token-exchange.ts:72` `[EXISTS]`).
- Replacing the IdP browser session refresh endpoint (`/api/v1/auth/session/refresh`, `api/src/services/session-manager.ts:255` `[EXISTS]`), which manages first-party browser cookies (`user_sessions`) and not OAuth grants.
- Dynamic Client Registration (RFC 7591): MCP and RP clients remain pre-registered via the governed registration Job (`api/src/scripts/oauth-register-client.ts` `[EXISTS]`).

## 2. Verified baseline at 9ed96eb83

### 2.1 OAuth token issuance, lifetimes, and discovery today

| Behaviour | Baseline evidence (`9ed96eb83`) |
|---|---|
| `OAUTH_ACCESS_TOKEN_TTL_SEC` defaults to `3600` (`1 h`); `OAUTH_ID_TOKEN_TTL_SEC` defaults to `3600`; `OAUTH_AUTHORIZATION_CODE_TTL_SEC` defaults to `60`; `OAUTH_DPOP_IAT_SKEW_SEC` defaults to `60` | `api/src/config/env.ts:140-143`, wired in `api/src/routes/auth/oauth.ts:78-86` `[EXISTS]` |
| `OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC` defaults to `900` (`15 min`) for stateless `client_credentials` tokens | `api/src/config/env.ts:145`, `packages/auth-hono/src/oauth/token-handler.ts:13,364` `[EXISTS]` |
| No `OAUTH_REFRESH_TOKEN_TTL_SEC` env var exists; `session-manager.ts` has an unused `REFRESH_DURATION = 30 * 24 * 60 * 60` constant for browser sessions | `api/src/config/env.ts:138-146`, `api/src/services/session-manager.ts:53-56` `[EXISTS]` |
| `/authorize` explicitly rejects `offline_access` with `invalid_scope` before checking `client.allowedScopes` | `packages/auth-hono/src/oauth/authorize-handler.ts:386-393` `[EXISTS]` |
| `/token` accepts only `authorization_code`, `client_credentials`, and `urn:ietf:params:oauth:grant-type:token-exchange`; any other `grant_type` (including `refresh_token`) returns `400 unsupported_grant_type` | `packages/auth-hono/src/oauth/token-handler.ts:39-57` `[EXISTS]` |
| `issueTokens` mints an EdDSA JWT `access_token` (and `id_token` when `openid` is in scope), persists `TokenMeta` (`'access_token' \| 'id_token'`) in `oauth_tokens`, and never emits `refresh_token` | `packages/auth-hono/src/oauth/token-handler.ts:398-511`, `packages/auth-hono/src/oauth/state-store-types.ts:3` `[EXISTS]` |
| Discovery advertises `grant_types_supported: ['authorization_code', 'client_credentials', ...additionalGrantTypesSupported]`; the host passes `[TOKEN_EXCHANGE_GRANT_TYPE]` and MCP/Immo scopes, without `refresh_token` or `offline_access` | `packages/auth-hono/src/oauth/wellknown-handler.ts:7,48,56`, `api/src/routes/namespaces/oauth-ingress.ts:49-50` `[EXISTS]` |
| `/revoke` decodes the token as a JWT (`decodeJwt`) to extract `jti` and inserts into `revoked_tokens`; non-JWT strings silently return `{ success: true }` without revoking anything | `packages/auth-hono/src/oauth/revoke-handler.ts:20-30,63-70` `[EXISTS]` |
| `/introspect` verifies the token as an EdDSA JWT and checks `oauth_tokens` + `revoked_tokens` by `jti`; opaque tokens return `{ active: false }` | `packages/auth-hono/src/oauth/introspect-handler.ts:23-33,74-88` `[EXISTS]` |
| `oauth_clients.grant_types` defaults to `ARRAY['authorization_code']::text[]`; `buildOAuthClientRegistration` hardcodes `grantTypes: ['authorization_code']` | `api/src/db/schema.ts:310`, `api/src/scripts/oauth-register-client.ts:162` `[EXISTS]` |

### 2.2 Per-client policy, tenancy, consent, and tier sync today

| Behaviour | Baseline evidence (`9ed96eb83`) |
|---|---|
| Per-client `required_acr` and `allowed_user_ids` on `oauth_clients` are enforced at `/authorize`, `/authorize?continue=...`, and `/consent` | `api/drizzle/0042_oauth_clients_mfa_policy.sql:8-10`, `packages/auth-hono/src/oauth/authorize-handler.ts:80,90,253,256`, `consent-decision-handler.ts:110-116` `[EXISTS]` |
| `tid` is derived at `/authorize` from an approved membership and re-verified at `/token` via `ports.tenant.isApprovedMember(userId, boundTenantId)` | `packages/auth-hono/src/oauth/authorize-handler.ts:135,182-194`, `token-handler.ts:417-421` `[EXISTS]` |
| RFC 8707 `resource` is validated against `client.resourceIndicators`, sealed into the authorization code, checked on `/token`, and becomes the access token `aud` | `packages/auth-hono/src/oauth/authorize-handler.ts:424-443`, `token-handler.ts:159-173,429` `[EXISTS]` |
| Consent grants (`oauth_consents`) are keyed on `(user_id, client_id, tenant_id)` and checked for scope superset coverage (`hasCoveringGrant`) | `api/src/db/schema.ts:392-410`, `packages/auth-hono/src/oauth/authorize-handler.ts:205-218` `[EXISTS]` |
| Prod-to-preprod identity sync exports `users`, `webauthn_credentials`, `oauth_consents`, and `oauth_clients` (including `allowed_scopes` and `grant_types`), never tokens or codes, and deletes ephemeral auth rows on rekey | `deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql:7-10`, `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql:101-106,123` `[EXISTS]` |

### 2.3 Comparison with the CI seat refresh model (comparison only)

The owner's initial question contrasted two models: « Faut gerer les refresh a la migration immo vers cluster mesh. Relogin aux 15j suffit » vs « Ou gerer le refresh auto comme pour les sieges », and closed in favour of **standard OAuth refresh tokens issued by the Sentropic IdP**. The comparison with the CI seat model (`packages/llm-mesh/src/enrollment/seat-bundle.ts`, `spec/SPEC_EVOL_CI_SEATS.md`) is recorded here for clarity only and introduces no coupling between `@sentropic/auth-hono` and `@sentropic/llm-mesh`:

| Dimension | CI seat refresh model (`seat-bundle.ts` `[EXISTS]`) | IdP OAuth refresh token model (this spec) |
|---|---|---|
| Role of Sentropic | **Consumer / custodian** of third-party CLI seats (`agy`, `codex`, `vibe`, `muse`, `claude`) issued by external provider IdPs (`seat-bundle.ts:13-28`). | **Authorization Server (IdP)** issuing tokens to external OAuth/MCP clients (`claude.ai`, SPA/RP clients) against Sentropic resources. |
| Who holds refresh authority | Only the `custodian` authority channel (`refreshAuthority: 'custody'`, `seat-bundle.ts:19,298-314`); `consumer` and `native-store` projections forbid any key matching `REFRESH_KEY_PATTERN` (`seat-bundle.ts:40,327-332`). | The authenticated OAuth client (`immo-mcp`, etc.) holds the opaque `refresh_token` and presents it directly to `POST /oauth/token` (`claude.ai` native OAuth 2.1 client). Downstream MCP resource servers and `cluster-mesh` exchanged tokens never receive refresh material (`token-exchange.ts:72` `[EXISTS]`). |
| Lineage and replay control | `SeatBundleIdentity.refreshFamilyRef` + `SeatBundleLifecycle` `(epoch, generation, operationId)` with `classifyTransition` (`idempotent`, `forward`, `stale`, `conflict`, `epoch-replacement-required`, `seat-bundle.ts:68,85-93,366-374`). | `oauth_refresh_tokens` family (`family_id`, `parent_id`, `generation`, `replaced_by_id`, `revoked_at`, `reuse_detected_at`): strictly single-use (`forward` only on active leaf); presenting a consumed generation triggers family-wide revocation (`conflict` -> revoke entire family + active access tokens). |
| Expiry policy | Provider-controlled `providerExpiry` plus `localExpiryPolicy` (`seat-bundle.ts:90-91`); re-enrollment via `make seat-reenroll` (`SPEC_EVOL_CI_SEATS.md:80`). | Deterministic **15-day absolute family cap** (`family_expires_at` fixed at `authorization_code` exchange, never extended on rotation) + **1-hour access token TTL** (`OAUTH_ACCESS_TOKEN_TTL_SEC = 3600`). |

Why the IdP OAuth model wins for MCPs: `claude.ai` and standard MCP hosts already implement RFC 6749 / OAuth 2.1 `grant_type=refresh_token` natively. Implementing standard refresh tokens at the Sentropic IdP requires zero custom custodian daemon on the client side and serves `immo-mcp` plus every other Sentropic MCP server uniformly.

## 3. Threat model and security invariants

### 3.1 Assets and target security properties

- **A-ACCESS (short-lived resource bearer):** EdDSA-signed JWT access tokens (`1 h` default, `300 s` ceiling for RFC 8693 exchanged tokens) verified locally via JWKS by `@sentropic/mcp-auth` without per-call introspection (`radar-enquete-astra.md:25`).
- **A-REFRESH (long-lived renewal capability):** Opaque high-entropy refresh tokens valid up to **15 days** from initial authorization, redeemable only at the IdP `/token` endpoint.
- **P-SHORT-BEARER:** Access tokens remain short (`1 h`) so the offline verification window of a leaked bearer stays bounded without requiring synchronous introspection on every MCP tool call.
- **P-SINGLE-USE-ROTATION:** Every successful `grant_type=refresh_token` request atomically consumes the presented refresh token and issues a new refresh token in the same family (`generation + 1`).
- **P-REUSE-DETECTION (RFC 6819 §5.2.2.3 / RFC 9700 §4.14.2):** Presenting an already-consumed refresh token proves either token theft or client state fork; the IdP immediately revokes the **entire refresh family** (`family_id`) and all non-expired `oauth_tokens` minted for that family, and returns `400 invalid_grant`.
- **P-ABSOLUTE-CAP:** A refresh family's `family_expires_at` (`created_at + 15 days` at initial `authorization_code` exchange) is immutable across rotations; rotation never extends the 15-day re-authentication deadline.
- **P-NO-PRIVILEGE-ESCALATION:** Refresh never widens `scope`, never changes `client_id`, `user_id`, `tenant_id`, or RFC 8707 `resource`/`audience`, never strips DPoP binding (`dpop_jkt`), and never fabricates a newer `auth_time` or higher `acr`/`amr`.
- **P-LIVE-POLICY:** Before minting on refresh, the IdP re-verifies live user existence and `accountPolicy.canAuthenticate`, client existence and `allowedUserIds`, covering `oauth_consents` grant, approved `tenant_memberships` for `tenant_id`, and per-client `required_acr` / MFA freshness rules (section 7.1).

### 3.2 Adversaries and failure modes

- **T-DB-READ (database snapshot / SQL read leak):** Mitigated by storing only `token_hash = sha256(raw_refresh_token)` (`64` hex chars) in `oauth_refresh_tokens`, matching `user_sessions.refresh_token_hash` (`api/src/db/schema.ts:191` `[EXISTS]`) and `auth_invite_tokens.token_hash` (`:249` `[EXISTS]`). Raw refresh tokens are never persisted or logged.
- **T-REPLAY (stolen refresh token replayed alongside legitimate client):** Mitigated by atomic single-use rotation (`UPDATE ... WHERE consumed_at IS NULL AND revoked_at IS NULL`) and family-wide revocation on reuse detection (`P-REUSE-DETECTION`).
- **T-CROSS-CLIENT / T-CROSS-RESOURCE:** A refresh token stolen from client A or resource X is presented by client B or with `resource=Y`. Mitigated by strict `client_id` equality, confidential client secret or DPoP proof verification, and sealed `resource` matching (`P-NO-PRIVILEGE-ESCALATION`).
- **T-REVOKED-PRINCIPAL:** User disabled, removed from `allowed_user_ids`, suspended in `tenant_memberships`, or consent revoked after initial login. Mitigated by live re-evaluation on every refresh request (`P-LIVE-POLICY`), revoking the family on policy failure.

## 4. Refresh token family data model, lifetime, and storage

### 4.1 Opaque token format and SHA-256 hashed persistence

1. **Format (`[TO BUILD Lot 1]`):** Each refresh token is an opaque, cryptographically random string generated via `ports.random.token(32)` (`32` random bytes, `base64url`, `43` chars) prefixed with `srt_` (`Sentropic Refresh Token`, total `47` chars). The `srt_` prefix lets `/revoke` and `/introspect` distinguish an opaque refresh token from a 3-segment JWT (`eyJ...`) in $O(1)$ without attempting `decodeJwt` first, and enables secret-scanner patterns.
2. **Hashed storage (`[TO BUILD Lot 1]`):** The IdP computes `tokenHash = ports.tokens.hashSecret(rawToken)` (SHA-256 hex, `api/src/routes/auth/oauth.ts:308` `[EXISTS]`) and stores only `tokenHash`. The plaintext `srt_...` value is returned once in the `/token` JSON response and never stored in PostgreSQL, logs, or audit payloads.

### 4.2 Database schema (`oauth_refresh_tokens`, single migration)

One additive Drizzle migration (`api/drizzle/0044_oauth_refresh_tokens.sql`, `[TO BUILD Lot 1]`) creates `oauth_refresh_tokens` and links `oauth_tokens` to `family_id` for family-wide access-token revocation:

| Column (`oauth_refresh_tokens`) | Type & constraints | Semantics |
|---|---|---|
| `id` | `text PRIMARY KEY` | UUID (`ports.random.uuid()`) identifying this refresh token generation row |
| `token_hash` | `text NOT NULL UNIQUE` | `sha256` hex of the opaque `srt_...` token |
| `family_id` | `text NOT NULL` | UUID set to `id` on generation `0` (`authorization_code` exchange) and copied unchanged to every rotated child |
| `parent_id` | `text REFERENCES oauth_refresh_tokens(id) ON DELETE SET NULL` | `NULL` for generation `0`; parent row `id` for rotated tokens (`generation >= 1`) |
| `replaced_by_id` | `text` | Set atomically to the child row `id` when consumed by rotation |
| `generation` | `integer NOT NULL DEFAULT 0` | Monotonic counter (`0` at code exchange, `parent.generation + 1` on each rotation) |
| `client_id` | `text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE` | Bound OAuth client; cascade-deletes when the client is deleted |
| `user_id` | `text NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Bound human subject (`sub`); cascade-deletes when the user is deleted |
| `tenant_id` | `text` | Sealed tenant (`tid`) from initial authorization (`NULL` when untenantized) |
| `scope` | `text NOT NULL` | Current granted scope string (space-delimited; downscopable on refresh, never widened) |
| `Initial / sealed claims` (`resource`, `dpop_jkt`, `acr`, `amr`, `auth_time`, `session_id`) | `resource text`, `dpop_jkt text`, `acr text NOT NULL`, `amr text[] NOT NULL`, `auth_time timestamp NOT NULL`, `session_id text` | Sealed authorization context: `resource` (RFC 8707 `aud`, nullable), `dpop_jkt` (DPoP thumbprint when bound), original `acr`, `amr`, `auth_time` (never bumped on refresh), and originating IdP `session_id` (nullable, for session-linked revocation/audit) |
| `created_at` | `timestamp NOT NULL DEFAULT now()` | Mint timestamp of this generation |
| `expires_at` | `timestamp NOT NULL` | Per-token expiry (`min(now + refreshTokenTtlSec, family_expires_at)`) |
| `family_expires_at` | `timestamp NOT NULL` | Immutable absolute deadline (`initial_created_at + OAUTH_REFRESH_TOKEN_TTL_SEC`, 15 days) |
| `consumed_at` | `timestamp` | Set atomically when rotated; `NULL` while active |
| `revoked_at` | `timestamp` | Set when explicitly revoked, policy-invalidated, or killed by reuse detection |
| `revoked_reason` | `text` | Nullable audit code: `'explicit_revoke' \| 'reuse_detected' \| 'policy_denied' \| 'user_logout' \| 'consent_revoked'` |

Indexes on `oauth_refresh_tokens`: `token_hash` (unique), `family_id`, `(user_id, client_id)`, and `expires_at` (for `purgeExpired()`). In addition, `oauth_tokens` gains a nullable `refresh_family_id text` column indexed on `refresh_family_id` so revoking a refresh family can immediately insert all active `oauth_tokens` of that family into `revoked_tokens`.

### 4.3 Lifetime configuration (`15 days` absolute cap, `1 hour` access token)

- `OAUTH_REFRESH_TOKEN_TTL_SEC` (`api/src/config/env.ts` `[TO BUILD Lot 1]`): `z.coerce.number().int().positive().default(1296000)` (`15 * 24 * 60 * 60 = 1,296,000` seconds = **15 days**).
- `OAUTH_ACCESS_TOKEN_TTL_SEC` (`api/src/config/env.ts:140` `[EXISTS]`): remains `3600` (`1 hour`).
- At `authorization_code` exchange (`t0`), `family_expires_at = t0 + OAUTH_REFRESH_TOKEN_TTL_SEC` and `expires_at = family_expires_at`.
- At each rotation (`t_rot < family_expires_at`), the child refresh token inherits `family_expires_at` unchanged and sets `expires_at = family_expires_at`. When `now >= family_expires_at`, refresh is refused with `400 invalid_grant` and the user performs a fresh interactive OAuth login (every 15 days).
- The newly minted access token at `t_rot` receives `expires_in = min(OAUTH_ACCESS_TOKEN_TTL_SEC, Math.floor((family_expires_at - t_rot) / 1000))` (or full `OAUTH_ACCESS_TOKEN_TTL_SEC = 3600`; see section 6.2 rule `R-TTL-CAP` where clamping vs full 1 h on the final hour is pinned).
