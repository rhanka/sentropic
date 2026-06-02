# @sentropic/auth-hono

Reusable Hono authentication route factories, contracts, and server-side auth helpers for Sentropic-compatible apps.

## Boundary

`@sentropic/auth-hono` owns backend auth route composition and reusable ceremony logic for:

- email code verification;
- magic-link verification;
- passkey registration;
- passkey authentication;
- session refresh/logout;
- credential list/rename/revoke;
- Hono auth middleware factories.

Application-owned adapters provide storage, email delivery, audit logging, cookies, token secrets, and workspace/account policy.

## Auth UI Alignment

The package route contract is aligned with the `@sentropic/auth-ui` `AuthUiTransport` shape from BR-39a. Backend implementations must preserve those request/result boundaries while allowing host apps to mount routes under their own prefix, such as Sentropic `/auth/*` or `spa-transpose-cv` `/admin/auth/*`.

## Quick start (per-route mounting)

Each route handler is independent; the host app composes only the ones it wants.

```ts
import {
  createAuthEmailRouteHandlers,
  createAuthWebAuthnRegistrationRouteHandlers,
  createAuthWebAuthnAuthenticationRouteHandlers,
} from '@sentropic/auth-hono';
import { Hono } from 'hono';

const router = new Hono();

const emailHandlers = createAuthEmailRouteHandlers({ service: hostEmailService });
router.post('/email/verify-request', emailHandlers.requestEmailCode!);
router.post('/email/verify-code', emailHandlers.verifyEmailCode!);

const registerHandlers = createAuthWebAuthnRegistrationRouteHandlers({
  prepareRegistrationOptions: hostPrepare,
  resolveRegistrationUser: hostResolveUser,
  service: hostRegistrationService,
  // Optional: own the success response (session creation, cookie, rich body)
  finalizeRegistration: hostFinalizeRegistration,
});
router.post('/register/options', registerHandlers.createPasskeyRegistrationOptions!);
router.post('/register/verify', registerHandlers.verifyPasskeyRegistration!);
```

## Hooks (since 0.2.x)

WebAuthn route handlers expose two host-owned extension points so the package can stay storage- and policy-agnostic while still letting hosts express their flow:

- **Error short-circuit** — `prepareRegistrationOptions` / `resolveRegistrationUser` / `resolveAuthenticationOptions` may return either their normal success value **or** an `AuthHonoRouteHandlerError` (`{ error: { status, code, message } }`). The handler maps it directly to the HTTP response, so the host can refuse early (e.g. unverified email → 403) without throwing.
- **Finalize hook** — `finalizeRegistration` / `finalizeAuthentication` are optional callbacks invoked after a successful credential verification with `{ credentialId, userId, request }` and the Hono `Context`. They return the final `Response`, giving the host full control over session creation, cookies, and the response body. Without a hook the package returns the default structured `{ credentialId, success, userId }` body.

## Response contract (structured)

All package handlers emit structured responses to keep contracts predictable across hosts:

- success bodies carry domain-specific fields (e.g. `{ delivery: 'email', expiresAt, success: true }`, `{ success: true, verificationToken }`, `{ sessionToken, refreshToken, expiresAt, success: true }` when the host's `finalize` builds the session response);
- error bodies are always `{ error: { code, message } }` plus an HTTP status. Hosts that need a host-specific shape (legacy flat errors, additional metadata) can wrap a handler or use the prepare/finalize hooks to project a different payload.

## Mounting recipes

- **Sentropic-style app** with a Drizzle/Postgres backend, WebAuthn-only login, and workspace-scoped sessions: implement `AuthHonoCredentialPort`, an `AuthHonoSessionService` adapter (or the package's `createAuthSessionService` when the full `AuthHonoPorts` bundle is wired), an `AuthHonoWebAuthnRegistrationService`/`AuthHonoWebAuthnAuthenticationService` adapter, and provide `prepareRegistrationOptions`/`resolveRegistrationUser` for first-admin + account-status policy and `finalizeRegistration`/`finalizeAuthentication` for session creation and cookie issuance. Sentropic's `api/src/services/auth/*-adapter.ts` modules show this end-to-end.
- **DB-less admin flow** (e.g. `spa-transpose-cv` mounting at `/admin/auth/*`): use a file- or memory-backed implementation of `AuthHonoCredentialPort` and the relevant ports, skip workspace bootstrap entirely, and either rely on the default verify response or supply a minimal `finalizeAuthentication` that issues a host-managed session cookie. The package never touches workspace state, so no DB schema is required.

## OAuth2 / OpenID Connect Identity Provider (since 0.3.0)

`@sentropic/auth-hono` ships a complete OAuth2 Authorization Server + OIDC Identity Provider built on the same ports-and-adapters model as the existing WebAuthn routes.

### Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /oauth/authorize` | Authorization Code + PKCE entry point (S256 required) |
| `POST /oauth/token` | Token issuance (`grant_type=authorization_code` and `client_credentials` since 0.4.0) |
| `GET\|POST /oauth/userinfo` | Returns claims for a valid access token |
| `POST /oauth/revoke` | Revokes an access token (RFC 7009) |
| `POST /oauth/introspect` | Token introspection (RFC 7662, client-auth required) |
| `POST /oauth/consent/decision` | Host-private consent approval/denial — NOT in discovery doc |
| `GET /.well-known/openid-configuration` | OIDC discovery document |
| `GET /.well-known/jwks.json` | Public Ed25519 signing keys (RFC 7517) |

### Wiring the OAuth router

```ts
import { createOAuthRouter, createWellKnownRouter } from '@sentropic/auth-hono';
import { Hono } from 'hono';

// Router mounted under /api/v1/auth
const authRouter = new Hono();
authRouter.route('/oauth', createOAuthRouter({
  ports,           // AuthHonoPorts — includes oauthStateStore + jwks
  issuer,          // e.g. 'https://api.example.com'
  loginUrl,        // e.g. 'https://app.example.com/auth/login'
  consentUrl,      // e.g. 'https://app.example.com/auth/oauth/consent'
}));

// Well-known router mounted at root level
const app = new Hono();
app.route('/.well-known', createWellKnownRouter({ ports, issuer }));
app.route('/api/v1/auth', authRouter);
```

### JwksService and signing

`createJwksService({ jwksPort, clock })` returns `{ signJwt, verifyJwt, getPublicJwks }`:

```ts
import { createJwksService } from '@sentropic/auth-hono';

const jwksService = createJwksService({ jwksPort: hostJwksPort, clock: Date.now });

// Sign an access token
const accessToken = await jwksService.signJwt(
  { sub: userId, scope: 'openid profile', iss: issuer, aud: `${issuer}/userinfo` },
  { expiresIn: 3600 }
);

// Verify any token (looks up kid from JWKS, accepts active and rotated keys)
const payload = await jwksService.verifyJwt(incomingJwt);
```

Signing algorithm: EdDSA (Ed25519) only. No RS256 fallback. JWKS response includes the active key and all rotated keys for at least `access_token TTL + JWKS cache TTL` (≥ 65 minutes). Discovery response sends `Cache-Control: public, max-age=300` on JWKS.

### Key rotation policy

1. The active signing key is created once via the host's `make exec-api CMD="npm run oauth:init-keys"` (or `make oauth-init-keys`).
2. Rotate via `make oauth-rotate-keys` (calls `JwksService.rotateKey()` through `api/src/scripts/oauth-rotate-keys.ts`).
3. Rotated keys remain in JWKS for ≥ 65 minutes so in-flight tokens stay verifiable.
4. Rotate the KEK (`OAUTH_SIGNING_KEK`) separately, every 90 days; re-encrypt stored private keys.

### OauthStateStorePort

`AuthHonoPorts.oauthStateStore` must implement:

```ts
interface OauthStateStorePort {
  findClient(clientId: string): Promise<OauthClientRecord | null>;
  saveAuthCode(code: string, payload: AuthCodePayload, ttlSec: number): Promise<void>;
  consumeAuthCode(code: string): Promise<AuthCodePayload | null>; // atomic single-use
  saveTokenMeta(jti: string, meta: TokenMeta, ttlSec: number): Promise<void>;
  findTokenMeta(jti: string): Promise<TokenMeta | null>;
  revokeToken(jti: string): Promise<void>;
  isTokenRevoked(jti: string): Promise<boolean>;
  recordDpopJti(jti: string, expiresAt: Date): Promise<boolean>; // false = duplicate
  purgeExpired(): Promise<number>;
}
```

The package never imports Postgres or any persistence library. Sentropic supplies `api/src/services/auth/oauth-state-adapter.ts` (Drizzle/Postgres). Package tests use the in-memory fixture at `packages/auth-hono/tests/__fixtures__/memory-oauth-state-store.ts`.

### DPoP opt-in (RFC 9449)

Set `dpop_bound_access_tokens: true` on the OAuth client record. Bound clients must send a `DPoP: <proof-jwt>` header on `/token`, `/userinfo`, and `/revoke`. The IdP verifies `htm`, `htu`, `iat` skew, unique proof `jti`, and `ath` on resource calls. Access and ID tokens include `cnf.jkt`.

### Service-to-service auth — `client_credentials` (since 0.4.0)

Backend services mint scoped, audience-bound, **stateless** access tokens without
a human via the `client_credentials` grant.

- **Service clients** are a separate record type, `ServiceClientRecord`, looked up
  through an **optional** `findServiceClient?(clientId)` method on
  `OauthStateStorePort`. Existing implementors of the `0.3.0` contract keep
  compiling; if the method is absent, `client_credentials` returns
  `unsupported_grant_type`.
- **Auth methods**: `client_secret_basic` and `client_secret_post`, verified via
  `ports.tokens.hashSecret`.
- **Scopes**: empty/absent `scope` grants the client's full `allowed_scopes`;
  otherwise the request must be a subset (else `invalid_scope`).
- **RFC 8707 resource indicators**: the issued token `aud` is the resolved
  `resource`, which must be in the client's `resource_indicators`. Resolution: 1
  indicator + no `resource` ⇒ use it; >1 + no `resource` ⇒ `invalid_target`; 0
  indicators ⇒ `resource` required else `invalid_target`; unknown `resource` ⇒
  `invalid_target`.
- **Stateless** (no `saveTokenMeta`, no `oauth_tokens` row): security relies on a
  short TTL (`serviceAccessTokenTtlSeconds`, default `900`) + secret rotation.
  Service-token revocation/introspection are deferred to BR-39h.
- **DPoP** is opt-in via `dpop_bound_access_tokens` and strongly recommended for
  production S2S.

Resource servers verify these tokens with `createRequireServiceAuth`:

```ts
import { createRequireServiceAuth, type ServiceAuthPorts } from '@sentropic/auth-hono';

const ports: ServiceAuthPorts = {
  clock,                                   // AuthHonoClockPort
  jwks,                                    // JwksPort
  dpopReplay: { recordDpopJti },           // optional, required to enforce DPoP replay
};

app.get(
  '/internal/ping',
  createRequireServiceAuth({ issuer, resource, requiredScopes: ['service:ping'], ports }),
  (c) => c.json({ ok: true, client: c.get('serviceClient') }),
);
```

`ServiceAuthPorts` is a **narrow** port (`Pick<AuthHonoPorts,'jwks'|'clock'> & { dpopReplay? }`):
resource servers do not construct user/credential/session/email ports just to
verify a token. The middleware validates `iss`, `aud === resource`, `exp`, and
`scope ⊇ requiredScopes`; for `cnf.jkt`-bound tokens it requires a DPoP proof,
enforces `ath` (RFC 9449 §4.3), and records the proof `jti` for replay defense.
On failure it returns 401/403 with a `WWW-Authenticate` header.

### Claims and ACR levels

| Claim | Source | Notes |
| --- | --- | --- |
| `acr` | Session type | `urn:sentropic:loa:passkey-fresh` (passkey session), `urn:sentropic:loa:bearer` (magic-link session) |
| `auth_time` | `session.createdAt` | Strong-auth timestamp tracking lands in BR-39j |
| `tenant_id` | `oauth_clients.tenant_id` | Forward-compat column; real tenants in BR-39e |

### Required environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `OAUTH_SIGNING_KEK` | Passphrase for Postgres `pgp_sym_encrypt` of private key | **Required in production** — see `docs/secrets.md` |
| `OAUTH_ISSUER_URL` | Override issuer claim | Derived from `AUTH_CALLBACK_BASE_URL` |
| `OAUTH_ACCESS_TOKEN_TTL_SEC` | Access token lifetime | `3600` |
| `OAUTH_ID_TOKEN_TTL_SEC` | ID token lifetime | `3600` |
| `OAUTH_AUTHORIZATION_CODE_TTL_SEC` | Authorization code TTL | `60` |
| `OAUTH_DPOP_IAT_SKEW_SEC` | DPoP proof `iat` tolerance | `60` |
| `OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC` | Stateless service token TTL (`client_credentials`) | `900` |
| `OAUTH_SERVICE_RESOURCE_URI` | Service token `aud` this API accepts/advertises | Derived from issuer |

### End-to-end example

See `packages/auth-hono/tests/example-oauth-rp.test.ts` for a complete in-process test that walks the full flow: authorize → consent → callback → token → userinfo → revoke → userinfo 401.

## First Publish

This is a brand-new public package. First publish requires the one-shot bootstrap flow from `rules/workflow.md`: trigger `ci.yml` with `bootstrap_publish_target=auth-hono`, handle any npm token or 2FA requirement with the npm owner, then attach the npm OIDC trusted publisher for `rhanka/sentropic` workflow `ci.yml`. Steady-state publishes should use trusted publishing and skip if the version already exists.

## Versioning

This branch ships `0.4.0`:

- `0.2.0` adds `AuthHonoRouteHandlerError` short-circuit on WebAuthn prepare/resolve hooks and the `finalizeRegistration`/`finalizeAuthentication` post-verify hooks. Additive; existing handler signatures stay valid.
- `0.2.1` patches `extractChallenge` (both WebAuthn handlers) to handle `credential.response === null` defensively (returns 400 `invalid_credential` instead of throwing 500).
- `0.3.0` adds the OAuth2/OIDC IdP surface: `createOAuthRouter`, `createWellKnownRouter`, `createJwksService`, `OauthStateStorePort`, `JwksPort`, Ed25519 signing, DPoP opt-in, and all six OAuth endpoints. Additive; existing WebAuthn/session handler signatures unchanged.
- `0.4.0` adds the S2S `client_credentials` grant (stateless service tokens), `createRequireServiceAuth` + `ServiceAuthPorts`, the optional `findServiceClient?` on `OauthStateStorePort`, `ServiceClientRecord`, and RFC 8707 resource indicators. Discovery now advertises `client_credentials` and `client_secret_post`. Additive and non-breaking — existing `0.3.0` implementors keep compiling.
