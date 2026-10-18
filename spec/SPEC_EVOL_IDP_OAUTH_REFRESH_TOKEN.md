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
