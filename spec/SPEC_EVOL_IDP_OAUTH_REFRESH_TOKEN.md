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

Indexes and uniqueness constraints on `oauth_refresh_tokens`: `token_hash` (unique), `UNIQUE (family_id, generation)`, partial unique index `ON (family_id) WHERE consumed_at IS NULL AND revoked_at IS NULL` (enforcing at most one active generation per family at the PostgreSQL layer), `(user_id, client_id)`, and `expires_at` (for `purgeExpired()`). In addition, `oauth_tokens` gains a nullable `refresh_family_id text` column indexed on `refresh_family_id` so revoking a refresh family can immediately insert all active `oauth_tokens` of that family into `revoked_tokens`.

### 4.3 Lifetime configuration (`15 days` absolute cap, `1 hour` access token)

- `OAUTH_REFRESH_TOKEN_TTL_SEC` (`api/src/config/env.ts` `[TO BUILD Lot 1]`): `z.coerce.number().int().positive().default(1296000)` (`15 * 24 * 60 * 60 = 1,296,000` seconds = **15 days**).
- `OAUTH_ACCESS_TOKEN_TTL_SEC` (`api/src/config/env.ts:140` `[EXISTS]`): remains `3600` (`1 hour`).
- At `authorization_code` exchange (`t0`), `family_expires_at = t0 + OAUTH_REFRESH_TOKEN_TTL_SEC` and `expires_at = family_expires_at`.
- At each rotation (`t_rot < family_expires_at`), the child refresh token inherits `family_expires_at` unchanged and sets `expires_at = family_expires_at`. When `now >= family_expires_at`, refresh is refused with `400 invalid_grant` and the user performs a fresh interactive OAuth login (every 15 days).
- The newly minted access token at `t_rot` has `exp` capped at `min(t_rot + OAUTH_ACCESS_TOKEN_TTL_SEC, family_expires_at)` (`expires_in = min(OAUTH_ACCESS_TOKEN_TTL_SEC, Math.floor((family_expires_at - t_rot) / 1000))`, rule `R-TTL-CAP` in section 6.2) so a refresh near day 15 never extends bearer validity past the 15-day family ceiling.

## 5. Client eligibility, scope semantics, and discovery

### 5.1 Explicit per-client opt-in (default-deny)

Refresh capability uses a single authoritative eligibility rule (`isRefreshEligibleClient(client)` in `packages/auth-hono/src/oauth/` `[TO BUILD Lot 2]`):

1. `client.grantTypes` contains **both** `'authorization_code'` and `'refresh_token'`.
2. `client.allowedScopes` contains `'offline_access'`.
3. If the client requests a resource indicator, `resource` is present in `client.resourceIndicators` (`authorize-handler.ts:424` `[EXISTS]`).
4. In the initial rollout (until `#695`'s shared fifth-leg MFA evaluator and `security_generation` hooks land in Lot 3), `client.requiredAcr` is `NULL` (or `'urn:sentropic:loa:bearer'`). Any client with a forced-MFA `requiredAcr` (`urn:sentropic:loa:passkey-fresh` or `urn:sentropic:loa:mfa`) is refused refresh issuance and renewal by default (section 7.1).

| Client / class | Initial refresh eligibility |
|---|---|
| `immo-mcp` (prod) and `immo-mcp-preprod` (non-prod) | **Eligible** after explicit registration update (`grant_types = ['authorization_code', 'refresh_token']`, `allowed_scopes` including `'offline_access'`) and Lot 0 preprod qualification. |
| Other Sentropic human-delegated MCP clients | **Supported** by the same mechanism, enabled individually per `(project, tier)` registration (`SPEC_DECISION_TIER_AUTH_PATTERN.md:54` `[EXISTS]`), never inferred from a `client_id` prefix or MCP scope presence. |
| Public (`token_endpoint_auth_method = 'none'` + PKCE S256) and confidential (`client_secret_basic`) MCP clients | **Both supported** when explicitly allowlisted above; public clients rely on S256 PKCE at initial code exchange and strict single-use refresh rotation + reuse detection (`RFC 9700 §4.14.2`, `draft-ietf-oauth-v2-1-16 §4.3`). |
| `immo-mcp-workload` and `service_clients` | **Ineligible (`[EXISTS]`):** workload/service clients use `service_clients`, never `oauth_clients`, and never receive `refresh_token` or `offline_access` (`oauth-client-seed.ts:166-184` `[EXISTS]`). |
| `kvm-gateway` | **Ineligible (`grant_types = ['authorization_code']`):** administrative console with `required_acr` and owner-only `allowed_user_ids` (`SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md:716`). Not covered by the MCP refresh decision. |
| `design-system`, `example-mock-rp`, `example-dpop-rp`, and existing browser RPs | **Ineligible by default (`grant_types = ['authorization_code']`):** zero global backfill. |

### 5.2 Scope rules (`offline_access`) and OIDC consent (`OIDC Core §11`)

- At `GET /authorize` (`packages/auth-hono/src/oauth/authorize-handler.ts:386-393` `[TO BUILD Lot 2]`): remove the unconditional `if (requestedScopes.includes('offline_access'))` refusal. Instead, `offline_access` is validated through `client.allowedScopes.includes('offline_access')` **plus** `client.grantTypes.includes('refresh_token')`; if either is missing, `/authorize` returns `invalid_scope`.
- **Recorded offline consent (`OIDC Core §11`):** `hasCoveringGrant` (`authorize-handler.ts:205-218` `[EXISTS]`) checks `stored.scopes ⊇ requested.scopes`. Consequently, an existing consent row without `'offline_access'` never skips the consent screen when `'offline_access'` is requested: the user sees and approves the offline grant explicitly, and `consentStore.saveGrant` records `'offline_access'` in `oauth_consents.scopes` (`consent-decision-handler.ts:81` `[EXISTS]`).
- **Preprod qualification of `claude.ai` (`[TO BUILD Lot 0]`):** Anthropic documents hosted MCP connector support for token expiry and refresh (`https://claude.ai/api/mcp/auth_callback`), distinct from the caller-managed Messages API MCP connector, but whether `claude.ai` sends `scope=... offline_access` on `/authorize` is **unverified** at spec time (`.tmp/idp-refresh-token/analysis-astra.md:187-198`). Lot 0 captures sanitized preprod `/authorize` and `/token` traces before enabling prod. No silent global issuance without `offline_access` is permitted to guess around an unobserved client quirk.

### 5.3 Discovery metadata and client registration preservation

- **Discovery (`packages/auth-hono/src/oauth/wellknown-handler.ts:48,56`, `api/src/routes/namespaces/oauth-ingress.ts:49-50` `[TO BUILD Lot 2]`):** Once the refresh handler is deployed on all serving replicas, advertise `'refresh_token'` in `grant_types_supported` and `'offline_access'` in `scopes_supported` on both `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server`.
- **Registration script (`api/src/scripts/oauth-register-client.ts:162,206-215` `[TO BUILD Lot 1]`):** Add optional `OAUTH_CLIENT_GRANT_TYPES` (comma-separated, validated subset of `['authorization_code', 'refresh_token']`, requiring `'authorization_code'` whenever `'refresh_token'` is requested). Extend `resolvePolicyUpdate` so omitting `OAUTH_CLIENT_GRANT_TYPES` during a 90-day secret rotation (`docs/oauth-client-rotation.md`) preserves the stored `grant_types`, while an explicit value (`OAUTH_CLIENT_GRANT_TYPES=authorization_code`) can disable refresh without wiping `required_acr` or `allowed_user_ids`.

## 6. Protocol flows: issuance, atomic rotation, reuse detection, and revocation

### 6.1 Initial issuance on `authorization_code` exchange

When `POST /token` (`grant_type=authorization_code`) succeeds (`token-handler.ts:82` `[TO BUILD Lot 2]`):

1. Check `isRefreshEligibleClient(auth.client)` **and** `codePayload.scope.split(/\s+/).includes('offline_access')`. If either is false, mint only `access_token` (and `id_token` when `openid` is present), byte-identical to baseline `9ed96eb83`.
2. Otherwise, at `t0 = ports.clock.now()` with `T = addSeconds(t0, refreshTokenTtlSeconds)` (`1,296,000 s` = 15 days), mint raw token `srt_<43-char-base64url>`, compute its domain-separated SHA-256 digest, and persist generation `0` (`family_id = id`, `parent_id = null`, `generation = 0`, `family_expires_at = T`, `expires_at = T`, sealed `client_id`, `user_id`, `tenant_id = boundTenantId`, `scope = codePayload.scope`, `resource = codePayload.resource`, `dpop_jkt = dpopJkt`, `acr`, `amr`, `auth_time`).
3. Persist `oauth_tokens` metadata for `access_token` with `refresh_family_id = family_id`, and return `refresh_token` alongside `access_token`, `token_type`, `expires_in`, and `scope` with headers `Cache-Control: no-store` and `Pragma: no-cache` (`RFC 6749 §5.1`).

### 6.2 Refresh grant validation, live policy re-evaluation, and atomic rotation

On `POST /token` with `grant_type=refresh_token` (`[TO BUILD Lot 2]`):

1. **Client authentication & binding first:** Authenticate the client via its registered `tokenEndpointAuthMethod` (`client_secret_basic` or `none`; reject dual Basic + form credentials or unauthenticated confidential clients with `401 invalid_client` + `WWW-Authenticate` when Basic was used, `RFC 6749 §5.2`). Verify `isRefreshEligibleClient(client)`; otherwise return `400 unauthorized_client`.
2. **Lookup & ownership check before reuse trigger:** Hash the presented `refresh_token`. If no row matches in `oauth_refresh_tokens`, return `400 invalid_grant`. Verify `row.clientId === client.clientId` and (if `row.dpopJkt` or `client.dpopBoundAccessTokens`) verify the `DPoP` proof `jkt === row.dpopJkt` **before** checking `consumed_at`: a wrong client or missing/mismatched DPoP proof returns `400 invalid_grant` / `400 invalid_dpop_proof` without revoking the legitimate owner's family.
3. **Reuse detection (`P-REUSE-DETECTION`):** Inside a database transaction locking the family (`SELECT ... FOR UPDATE`), if `row.consumedAt !== null`, atomically set `revoked_at = now, revoked_reason = 'reuse_detected'` on every row of `row.familyId`, copy all non-expired `oauth_tokens` rows with `refresh_family_id = row.familyId` into `revoked_tokens`, **commit the revocation transaction**, emit a credential-free security audit event, and return `400 invalid_grant`.
4. **Expiry & live policy re-evaluation (`P-LIVE-POLICY`):** If `row.revokedAt !== null` or `now >= row.familyExpiresAt` or `now >= row.expiresAt`, return `400 invalid_grant`. Re-read live `user = ports.users.findById(row.userId)` and verify `accountPolicy.canAuthenticate(user, now).allowed`, `isSubjectAllowed(user.id, client.allowedUserIds)`, and covering `oauth_consents` grant (`hasCoveringGrant` including `'offline_access'`). If `row.tenantId !== null`, require `ports.tenant` and `await ports.tenant.isApprovedMember(user.id, row.tenantId) === true` — **never drop `tid` to `null` on refresh** (unlike initial code exchange at `token-handler.ts:420`); if membership was lost, revoke the family (`revoked_reason = 'policy_denied'`) and return `400 invalid_grant`.
5. **Scope & resource rules (`RFC 6749 §6`, `RFC 8707`):** Omitted `scope` defaults to `row.scope`; any requested scope outside `row.scope` returns `400 invalid_scope`. A narrowed `scope` applies to the new `access_token`, while the replacement `refresh_token` retains the family's original `row.scope` (`RFC 6749 §6`). Omitted `resource` retains `row.resource`; repeated or mismatched `resource` returns `400 invalid_target` / `400 invalid_grant`.
6. **R-TTL-CAP & atomic rotation:** Compute `accessExp = min(now + accessTokenTtlSeconds, row.familyExpiresAt)` and `expiresIn = Math.floor((accessExp - now) / 1000)` (if `expiresIn <= 0`, return `400 invalid_grant`), so a refresh near day 15 never extends bearer validity past `family_expires_at`. Consume `row` (`consumed_at = now, replaced_by_id = nextId`), insert generation `row.generation + 1` with identical `family_id`, `family_expires_at`, `scope = row.scope`, and original `acr`, `amr`, `auth_time`, persist the new `oauth_tokens` row (`refresh_family_id = row.familyId`), commit, and return the new `access_token` + new `refresh_token`. Spent generation rows are retained in `oauth_refresh_tokens` until `family_expires_at < now` (`purgeExpired` deletes a family only after `family_expires_at` and all associated `oauth_tokens.expires_at` have passed).

### 6.3 Wire error contract (`oauthJsonError` compatibility) and RFC 7009 / 7662 / logout

- **RFC 6749 §5.2 wire error shape (`[TO BUILD Lot 2]`):** `packages/auth-hono/src/oauth/http-utils.ts:17` `[EXISTS]` currently serializes `{ error: { code, message } }`. Standard OAuth 2.0 / MCP clients and `packages/cluster-mesh/src/trust/token-exchange-http.ts:325` `[EXISTS]` inspect top-level `typeof body.error === 'string'`. Lot 2 aligns `/token` and `/revoke` error responses to emit RFC 6749 top-level `"error": "<code>"` and `"error_description": "<message>"` (with `Cache-Control: no-store`), auditing existing internal callers (`api/tests/**`, `packages/auth-hono/tests/**`) in the same lot.
- **RFC 7009 `/revoke` & RFC 7662 `/introspect` (`[TO BUILD Lot 3]`):** `/revoke` (`revoke-handler.ts:13` `[EXISTS]`) authenticates confidential clients (or verifies public `client_id`), checks whether `token` is an `srt_...` refresh token (or looks up by `token_hash` when `decodeJwt` returns null), verifies `row.clientId === client.clientId`, and revokes the entire `family_id` plus all associated `oauth_tokens` JTIs (`revoked_reason = 'explicit_revoke'`), even if the submitted generation was already spent. Unknown tokens return `200 OK` without enumeration. `/introspect` (`introspect-handler.ts:13` `[EXISTS]`) resolves active, unconsumed, unrevoked refresh tokens by `token_hash` (`token_type: 'refresh_token'`, `exp = family_expires_at`) and returns `{ active: false }` for spent, revoked, or expired generations.
- **Retention of spent digests and no grace window:** No replay grace interval or plaintext response cache is introduced; concurrent duplicate refresh requests on the same token trigger reuse detection on the loser. Clients we control serialize refresh calls; `claude.ai` concurrency is qualified in Lot 0.

## 7. Boundary contracts: per-client MFA (#695), `@sentropic/mcp-auth`, `cluster-mesh` (#679/#692), and tier sync

### 7.1 Per-client MFA policy (PR #695, open target spec) and `kvm-gateway`

- **Status & shared fifth issuance leg:** `spec/SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md` (`PR #695`, head `ef956c306be72b066f2a316d79fd6b0f8b1c4d68`) is an open specification; baseline `9ed96eb83` already enforces `oauth_clients.required_acr` and `allowed_user_ids` via `0042_oauth_clients_mfa_policy.sql` `[EXISTS]`. Adding `grant_type=refresh_token` introduces a **fifth OAuth issuance leg** alongside `authorize`, `authorize?continue`, `consent`, and `token (authorization_code)`, evaluated through the same shared policy helper (`evaluateOAuthClientPolicy`, `SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md:198-206`).
- **Sealed authentication context (`acr`, `amr`, `auth_time`):** Refresh tokens seal the initial login's `acr`, `amr`, and `auth_time` (plus, when `#695` lands, `mfaCompletedAt`, `security_generation`, credential provenance, and `policy_version`). Refresh **never** advances `auth_time`, **never** upgrades `acr`, and **never** synthesizes `amr` from `acr` (`token-handler.ts:430` `[EXISTS]` fallback must not run on refresh; `amr` is copied verbatim from `oauth_refresh_tokens.amr`).
- **Decoupling from the 7-day browser session cookie:** Offline refresh families (`15 d`) are independent of the 7-day `user_sessions` cookie (`api/src/services/session-manager.ts:53` `[EXISTS]`): a connector (`claude.ai`) continues to refresh after the browser session expires unless an explicit revocation event occurs.
- **Forced-MFA clients (`required_acr != null`) and `kvm-gateway`:** Because headless MCP connectors cannot execute an interactive WebAuthn ceremony on `POST /token`, any client with `required_acr != null` (including `kvm-gateway`, `SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md:716`) remains **refresh-ineligible** (`grant_types = ['authorization_code']`, section 5.1 rule 4). If an administrator tightens `required_acr` or `allowed_user_ids` on an existing client after a family was minted, section 6.2 step 4 re-evaluates the live client policy on refresh and revokes the family (`400 invalid_grant`, `revoked_reason = 'policy_denied'`).
- **Recovery and security-event revocation (`#695` §6):** Initiating an unauthenticated recovery request (`POST /auth/recovery/request`) **never** revokes refresh families (preventing email-targeted DoS, `SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md:465`). Completed recovery redeem, passkey removal, account disablement, consent withdrawal, or a `users.security_generation` bump immediately revokes all active `oauth_refresh_tokens` families and their active `oauth_tokens` JTIs (`revoked_reason = 'security_event'`).

### 7.2 `@sentropic/mcp-auth` (`0.2.2`), RFC 9728 PRM canonical path, and MCP transport `404`

- **Upgrade to `@sentropic/mcp-auth >= 0.2.2` (`b9d15ebf6` `[EXISTS]`):** `packages/mcp-auth/src/core.ts:154-184` checks `requiredScopes` after JWT signature/expiry verification so missing scopes return `403 insufficient_scope` instead of `401 invalid_token`. Downstream MCP servers (`radar-immobilier`, observed on `0.1.0` in `radar-enquete-astra.md:57`) must upgrade to `@sentropic/mcp-auth >= 0.2.2` during the `cluster-mesh` migration so scope mismatches never trigger false token-refresh or re-login loops.
- **Canonical RFC 9728 PRM path:** `@sentropic/mcp-auth` serves Protected Resource Metadata at `/.well-known/oauth-protected-resource<resource-pathname>` (`packages/mcp-auth/src/prm.ts:49`, `hono.ts:28` `[EXISTS]`) with a `308` redirect from legacy `/.well-known/oauth-protected-resource` (`core.ts:144` `[EXISTS]`). Ingress manifests must route the path-suffixed `.well-known` endpoint alongside the root path.
- **MCP Streamable HTTP (`2025-11-25`) session `404` vs OAuth `401`:** MCP transport sessions (`Mcp-Session-Id`, `30 min` idle / `8 h` max in `radar-immobilier`, `radar-enquete-astra.md:62-75`) are orthogonal to OAuth token lifetime. Pod restart or idle eviction returns `HTTP 404` (not `401`), requiring MCP `initialize` with the current or refreshed bearer token. Downstream MCP servers binding `Mcp-Session-Id` to caller identity must key session ownership on `(sub, client_id, tid)` rather than access-token `jti` or raw JWT bytes so hourly token rotation does not orphan active MCP sessions.

### 7.3 `cluster-mesh` MCP registry and RFC 8693 token exchange (PR #679 merged, PR #692 open spec)

- **`oauth_tokens` persistence required for `verifySubject`:** `packages/auth-hono/src/oauth/token-exchange-handler.ts:231-253` `[EXISTS]` requires the human `subject_token` JTI to exist in `oauth_tokens` (`tokenType === 'access_token'`) and not in `revoked_tokens`. Every `grant_type=refresh_token` rotation therefore inserts a new `oauth_tokens` row (`refresh_family_id = family_id`, section 6.2 step 6) so refreshed human access tokens remain valid RFC 8693 `subject_token`s for `cluster-mesh` MCP calls (`PR #679` `1472d961e` `[EXISTS]`; `PR #692` `spec/SPEC_EVOL_CLUSTER_MESH_MCP_REGISTRY_ARTIFACTS.md` at `4ed7cb37d4de12ee86eda3faeff5f1bc0de07ec2`).
- **Bearer-only human subject tokens for exchange:** `token-exchange-handler.ts:207-212` `[EXISTS]` rejects `subject_token`s containing `cnf`. Human MCP clients that invoke downstream RFC 8693 exchange (`immo-mcp`) keep `dpop_bound_access_tokens = false`.
- **Zero refresh material in workload exchange:** `token-exchange-handler.ts:154-169` (`OAUTH_TOKEN_EXCHANGE_MAX_TTL_SEC = 300`), `packages/cluster-mesh/src/trust/token-exchange-http.ts:331`, and `packages/cluster-mesh/src/token-exchange.ts:72` `[EXISTS]` never accept, mint, or propagate `refresh_token` or `offline_access`.
- **Revocation vs mesh cache window:** Revoking a refresh family immediately inserts its active `oauth_tokens` JTIs into `revoked_tokens`, blocking `/introspect` and new RFC 8693 `/token` exchanges at the IdP; already-minted mesh tokens cached in `TokenExchangeService` remain bounded by the `60 s` local cache (`packages/cluster-mesh/src/token-exchange.ts:9,224` `[EXISTS]`, invalidated globally with `'all'`, `SPEC_EVOL_CLUSTER_MESH_MCP_REGISTRY_ARTIFACTS.md:170`).

### 7.4 Prod-to-preprod identity sync (`SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md`) and backup/restore boundaries

- **`export-prod.sql` (`deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql:7-10` `[EXISTS]`):** Never exports `oauth_refresh_tokens`, `oauth_tokens`, or `revoked_tokens`. Prod refresh token digests never leave prod. `oauth_clients` (`grant_types`, `allowed_scopes`) and `oauth_consents` continue to sync as durable convergence state.
- **`import-preprod.sql` (`deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql:101-125` `[TO BUILD Lot 1]`):** Because `import-preprod.sql:114` defaults unlisted FK tables referencing `users(id)` to `'durable-repoint'`, Lot 1 adds `oauth_refresh_tokens` to the `'ephemeral-auth'` classification (`:101-106`) and the explicit `DELETE FROM` list (`:121-125`) alongside `oauth_tokens` and `oauth_authorization_codes`. Replicated `oauth_consents` with `'offline_access'` only cover future preprod `/authorize` checks after a preprod login and never mint preprod refresh tokens on their own.
- **Database backup restore (`make db-restore` / DR runbook `[TO BUILD Lot 3]`):** To prevent a snapshot rollback from resurrecting spent generations or revoked families, any IdP database restore must immediately mark all pre-restore `oauth_refresh_tokens` rows revoked (`revoked_reason = 'db_restore_invalidation'`) and clear active `oauth_tokens` before reopening `/oauth/token` traffic.

## 8. Observability, audit, and confirmation measurements

- **Structured telemetry & security audit events (`[TO BUILD Lot 2-3]`):** Emit structured, credential-free events for:
  - `/authorize`: `client_id`, `requested_offline_access: boolean`, `client_refresh_eligible: boolean`, `decision` (`issued_code | consent_required | login_required | error`), `error_code`.
  - `/token`: `grant_type`, `client_id`, `refresh_token_issued: boolean`, `expires_in`, `access_token_ttl_sec` (`exp - iat`), `family_id`, `generation`, `family_remaining_sec`, `error_code`.
  - Family lifecycle audit: `oauth.refresh.issued`, `oauth.refresh.rotated`, `oauth.refresh.reuse_detected` (high-severity security alert with `family_id`, `client_id`, `user_id`, `replayed_generation`), `oauth.refresh.revoked`, `oauth.refresh.policy_denied`.
- **Strict redaction invariant:** Logs, metrics, error payloads, and Lot 0 preprod qualification notes **never** record raw `refresh_token` (`srt_...`), `access_token`, `id_token`, `code`, `code_verifier`, `client_secret`, `Authorization` headers, or session cookies.

## 9. Test plan (file-level granularity)

### 9.1 `@sentropic/auth-hono` unit and protocol suites

- `packages/auth-hono/tests/oauth/refresh-token-flow.test.ts` `[TO BUILD Lot 2]`:
  - Mints `srt_...` (`47` chars) on `authorization_code` exchange if and only if `isRefreshEligibleClient(client)` and granted `scope` contains `'offline_access'`.
  - Rotates generation `0 -> 1 -> 2` atomically; preserves `family_id`, `family_expires_at` (`15 d` = `1,296,000 s`), `acr`, `amr` (verbatim, never synthesized from `acr`), and `auth_time`; caps access token `expires_in` via `R-TTL-CAP` when `family_expires_at - now < 3600 s`.
  - Applies narrowed `scope` to the minted `access_token` while keeping original family `scope` on the replacement `refresh_token` (`RFC 6749 §6`); enforces sealed RFC 8707 `resource` (`aud`) and `dpop_jkt`.
  - Rejects wrong `client_id`, invalid `client_secret`, or missing/mismatched `DPoP` proof **before** reuse detection so an attacker or misconfigured client cannot DoS-revoke a legitimate family.
  - Detects replay of any spent generation (`RT_0` replayed after `RT_0 -> RT_1 -> RT_2`), marks the entire `family_id` as `revoked_reason = 'reuse_detected'`, inserts all active family `oauth_tokens` JTIs into `revoked_tokens`, and rejects `RT_2` on subsequent use.
  - Fails closed (`400 invalid_grant` + family revocation) when live user is disabled, removed from `allowed_user_ids`, consent (`offline_access`) is withdrawn, `required_acr` is added to the client, or `ports.tenant.isApprovedMember(userId, tenantId)` becomes false (never dropping `tid` to `null`).
- `packages/auth-hono/tests/oauth/authorize-offline-access.test.ts` `[TO BUILD Lot 2]`:
  - `/authorize` accepts `offline_access` only when `client.allowedScopes` has `'offline_access'` and `client.grantTypes` has `'refresh_token'`; existing consent without `'offline_access'` forces interactive consent (`hasCoveringGrant === false`); discovery endpoints advertise `'refresh_token'` and `'offline_access'`; `/token` and `/revoke` error responses emit RFC 6749 top-level `"error"` and `"error_description"` strings (`http-utils.ts`).
- `packages/auth-hono/tests/oauth/revoke-introspect-refresh.test.ts` `[TO BUILD Lot 3]`:
  - `/revoke` with an active or already-spent `srt_...` token revokes the entire `family_id` and its active `oauth_tokens` JTIs; cross-client revocation is refused; unknown tokens return `200 OK`; `/introspect` returns `{ active: true, token_type: 'refresh_token', exp: family_expires_at }` only for the unconsumed, unrevoked, unexpired leaf.

### 9.2 `api` persistence, PostgreSQL concurrency race, registration, and tier-sync suites

- `api/tests/services/auth/oauth-state-adapter.refresh.test.ts` `[TO BUILD Lot 1-2]`:
  - Verifies SHA-256 `token_hash` persistence (no plaintext `srt_...` column), `UNIQUE (family_id, generation)` and partial unique active-leaf index, `Promise.all` concurrent rotation race on the same `srt_...` token against PostgreSQL (never producing two active children; loser hits reuse detection), and `purgeExpired()` retaining spent digests until `family_expires_at < now`.
- `api/tests/routes/oauth-refresh.integration.test.ts` `[TO BUILD Lot 2-3]`:
  - Exercises `/oauth/authorize` -> `/oauth/consent` -> `/oauth/token` (`authorization_code`) -> `/oauth/token` (`refresh_token`) -> `/oauth/revoke` -> `/oauth/introspect` over HTTP, plus family invalidation on account disablement, consent deletion, and recovery completion.
- `api/src/scripts/oauth-register-client.test.ts` `[TO BUILD Lot 1]`:
  - Covers `OAUTH_CLIENT_GRANT_TYPES` parsing, rejection of `'refresh_token'` without `'authorization_code'`, and preservation of existing `grant_types` when `OAUTH_CLIENT_GRANT_TYPES` is omitted during 90-day secret rotation.
- `api/tests/scripts/idp-identity-sync.test.ts` `[TO BUILD Lot 1]`:
  - Verifies `export-prod.sql` never exports `oauth_refresh_tokens` and `import-preprod.sql` classifies `oauth_refresh_tokens` as `'ephemeral-auth'` and deletes preprod refresh rows on user rekeying.

### 9.3 `cluster-mesh`, `@sentropic/mcp-auth`, E2E, and preprod `claude.ai` UAT

- `packages/auth-hono/tests/oauth/token-exchange-refreshed-subject.test.ts` `[TO BUILD Lot 4]`: verifies that an `access_token` issued by `grant_type=refresh_token` succeeds as an RFC 8693 `subject_token` (`verifySubject` via `oauth_tokens`), is rejected immediately when its family is revoked (`revoked_tokens`), and never yields a `refresh_token` on the exchanged workload token.
- `e2e/tests/auth/oauth-refresh-token.spec.ts` `[TO BUILD Lot 4]`: Playwright E2E flow covering login, `offline_access` consent, rotation, reuse-detection family kill, and `/oauth/revoke`.
- Preprod native `claude.ai` UAT (`[TO BUILD Lot 0 & Lot 5]`): connect `claude.ai` to `immo-mcp-preprod`, verify sanitized `/authorize` and `/token` logs (`refresh_token_issued: true`, `expires_in: 3600`), confirm silent renewal across access-token expiry without user relogin, and verify MCP `initialize` recovery after an Immo MCP pod restart (`HTTP 404`) with `@sentropic/mcp-auth >= 0.2.2`.

## 10. Implementation lots for BUILD branches

| Lot | Scope & deliverables (separate BUILD branch(es), atomic commits <= 150 lines) | Verification gate |
|---|---|---|
| **Lot 0** | Preprod `claude.ai` trace qualification: add credential-free structured logging on `/authorize` and `/token` (`requested_offline_access`, `grant_type`, `error_code`) and capture a real `claude.ai` connector handshake on `immo-mcp-preprod`. | Scoped API tests + sanitized preprod trace recorded in `BRANCH.md`. |
| **Lot 1** | Persistence & tooling foundation: `api/drizzle/0044_oauth_refresh_tokens.sql` (`oauth_refresh_tokens` + `oauth_tokens.refresh_family_id`), `OAUTH_REFRESH_TOKEN_TTL_SEC=1296000` in `api/src/config/env.ts`, `RefreshTokenStore` in `packages/auth-hono` + `api/src/services/auth/oauth-state-adapter.ts`, `OAUTH_CLIENT_GRANT_TYPES` preservation in `oauth-register-client.ts`, and `oauth_refresh_tokens` in `import-preprod.sql` `'ephemeral-auth'`. | `oauth-state-adapter.refresh.test.ts`, `oauth-register-client.test.ts`, `idp-identity-sync.test.ts`. |
| **Lot 2** | Core protocol flow: `/authorize` `offline_access` gating, `authorization_code` generation-0 issuance, `grant_type=refresh_token` rotation + reuse detection + live policy/tenant/consent re-evaluation + `R-TTL-CAP`, RFC 6749 top-level `error` wire fix in `http-utils.ts`, and discovery metadata (`grant_types_supported`, `scopes_supported`). | `refresh-token-flow.test.ts`, `authorize-offline-access.test.ts`, `oauth-refresh.integration.test.ts`. |
| **Lot 3** | Revocation, introspection, DR & `#695` hooks: opaque `srt_...` support in `/revoke` and `/introspect`, family revocation on consent withdrawal / account disablement / completed recovery / `security_generation` bump (`#695` fifth leg), and `make db-restore` refresh-family invalidation step. | `revoke-introspect-refresh.test.ts` + updated `oauth-refresh.integration.test.ts`. |
| **Lot 4** | `cluster-mesh` RFC 8693 integration & Playwright E2E: `token-exchange-refreshed-subject.test.ts` and `e2e/tests/auth/oauth-refresh-token.spec.ts`. | Scoped `auth-hono` + `cluster-mesh` + Playwright E2E suite on `ENV=e2e-*`. |
| **Lot 5** | MCP rollout with `cluster-mesh` migration: upgrade `radar-immobilier` to `@sentropic/mcp-auth >= 0.2.2`, key MCP session ownership on `(sub, client_id, tid)`, route `/.well-known/oauth-protected-resource/mcp`, register `grant_types = ['authorization_code', 'refresh_token']` and `'offline_access'` on `immo-mcp-preprod` then `immo-mcp`, and run native `claude.ai` UAT. | Preprod & prod `claude.ai` MCP UAT + confirmation telemetry (`section 8`). |

## 11. Compatibility, non-goals, and rollout risks

- **Zero impact on existing clients:** Clients registered with `grant_types = ['authorization_code']` (`design-system`, `kvm-gateway`, `example-*`) keep baseline behaviour (`offline_access` rejected, no refresh token issued).
- **Rolling deployment order:** Deploy Lots 1–3 to all API replicas **before** advertising `'refresh_token'` in discovery or enabling `'refresh_token'` on `immo-mcp`, so no replica ever returns `unsupported_grant_type` mid-rollout.
- **Explicit non-goals:** No sliding extension past `family_expires_at` (`15 d`); no replay grace window or plaintext token response cache; no refresh tokens on `client_credentials` or RFC 8693 `token-exchange`; no refresh tokens on forced-MFA console clients (`kvm-gateway`).

## 12. Décisions propriétaire

### 12.1 Décision principale (fermée le 2026-10-18 — exécutoire)

- **Option retenue :** **« Refresh OAuth par l'IdP (Recommandé) »** — l'IdP Sentropic émet un refresh token OAuth standard (rotation à chaque usage, détection de réutilisation avec révocation de toute la famille, révocation explicite, stockage haché SHA-256) avec une **durée de vie absolue de 15 jours** (`1 296 000 s`) ; `claude.ai` le gère nativement (renouvellement silencieux, relogin aux 15 jours) ; les access tokens restent courts (**1 h** = `3 600 s`) ; livré avec la migration vers `cluster-mesh` ; sert également les autres MCP Sentropic.

### 12.2 Arbitrages résiduels bornés (avec valeurs par défaut sûres non bloquantes)

Les trois points ci-dessous disposent chacun d'une règle par défaut dans cette spécification afin qu'aucun lot BUILD ne soit bloqué ; le propriétaire peut confirmer la règle par défaut ou la modifier avant le Lot 2/3 :

1. **D-R1 — Relogin aux 15 jours face au cookie navigateur IdP (7 jours) :**
   - **Par défaut (recommandé) :** à l'expiration de la famille à 15 jours, `POST /oauth/token` refuse le refresh (`invalid_grant`) et le client relance `GET /oauth/authorize` ; si l'utilisateur possède une session navigateur IdP active (< 7 jours) et un consentement valide, `/authorize` s'appuie dessus normalement, sinon il demande une ré-authentification interactive.
   - **Alternative stricte :** exiger `now - session.auth_time < 15 jours` (ou `prompt=login`) lors d'un `/authorize` demandant `offline_access` pour imposer une saisie d'identifiants / passkey fraîche même si un cookie navigateur plus récent existe.
2. **D-R2 — Portée d'un logout navigateur local (`/oauth/end_session` / `/auth/logout`) sur les connecteurs MCP :**
   - **Par défaut (recommandé) :** un logout navigateur local ferme la session `user_sessions` du navigateur sans couper les familles `oauth_refresh_tokens` des connecteurs MCP (`claude.ai`) ; les familles MCP sont révoquées lors d'un `POST /oauth/revoke` du connecteur, d'un retrait de consentement OAuth, d'une désactivation de compte ou d'un événement de sécurité (`#695` `security_generation` / recovery complété).
   - **Alternative couplée :** révoquer également toutes les familles `oauth_refresh_tokens` liées à `session_id` (ou à `user_id`) lors d'un logout navigateur.
3. **D-R3 — Clients à MFA forcé (`required_acr != null`, ex. `kvm-gateway`) :**
   - **Par défaut (recommandé, section 5.1 & 7.1) :** `grant_type=refresh_token` est **désactivé** pour tout client ayant `required_acr != null` (`kvm-gateway` reste en `authorization_code` seul). Si un client nécessitant MFA devait un jour utiliser le refresh hors-ligne après `#695`, un arbitrage dédié précisera si `maxMfaAgeSeconds` borne directement le refresh ou si une fenêtre offline MFA distincte s'applique.
