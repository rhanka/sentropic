# BR-39c OAuth2 / OpenID Connect IdP Spec Draft

Temporary consolidation spec for BR-39c. This file is the implementation contract for
the branch and is folded into `spec/WORKFLOW_AUTH.md`,
`spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`, and package READMEs during Lot N-1.

## Scope

BR-39c turns `@sentropic/auth-hono` into a reusable OAuth2/OIDC Identity Provider
for Authorization Code + PKCE flows. It adds Sentropic host adapters, a consent UI
component in `@sentropic/auth-ui`, a browser RP helper, and an in-process mock RP
proof.

Out of scope: `client_credentials`, refresh tokens, dynamic client registration,
token exchange, real multi-tenancy, admin UI, and step-up enforcement.

## Issuer And Discovery

The issuer is the public API origin only:

- Branch tests: `http://localhost:9197`
- Root UAT: `http://localhost:8787`

Discovery is root-mounted on the API origin:

- `GET {issuer}/.well-known/openid-configuration`
- `GET {issuer}/.well-known/jwks.json`

OAuth endpoints are advertised under the existing auth API prefix:

- `GET {issuer}/api/v1/auth/oauth/authorize`
- `POST {issuer}/api/v1/auth/oauth/token`
- `GET {issuer}/api/v1/auth/oauth/userinfo`
- `POST {issuer}/api/v1/auth/oauth/revoke`
- `POST {issuer}/api/v1/auth/oauth/introspect`
- `POST {issuer}/api/v1/auth/oauth/consent/decision`

The UI origin does not proxy `.well-known` in BR-39c.

## Authorization Flow

`/authorize` accepts only `response_type=code` with `code_challenge_method=S256`.
It rejects unknown clients, redirect URI mismatches, fragment-bearing redirect URIs,
non-HTTPS redirect URIs except localhost, missing PKCE, and unknown scopes.
`offline_access` is rejected because refresh tokens are deferred.

When no valid Sentropic session is present:

- Normal authorize redirects to the host login URL with a sealed continuation.
- `prompt=none` redirects back to the RP with `error=login_required`.
- `prompt=login` forces the login continuation even when a session exists.

When consent is required:

- Normal authorize redirects to the host consent URL with a sealed state.
- `prompt=none` redirects back to the RP with `error=consent_required`.
- `prompt=consent` always shows the consent screen for that flow.

The consent decision endpoint is host-private and not listed in discovery. It
validates sealed state, rechecks the Sentropic session, and returns the final RP
redirect URL after approve or deny.

## Token And Claims

`/token` supports only `grant_type=authorization_code`. The handler verifies:

- client authentication method (`none` for public, `client_secret_basic` for
  confidential clients);
- exact `redirect_uri` equality with the saved authorization request;
- atomic single-use authorization code consumption;
- PKCE verifier equality against the saved S256 challenge;
- DPoP proof when the client is DPoP-bound.

Access tokens are EdDSA JWTs with a stored `jti`. Their audience is
`{issuer}/api/v1/auth/oauth/userinfo`. The token metadata store is the source for
revocation, scope, client, subject, expiration, and DPoP binding checks.

ID tokens are emitted only when the granted scope includes `openid`. Claims:
`iss`, `sub`, `aud=client_id`, `exp`, `iat`, `nonce` when supplied,
`auth_time=session.createdAt`, `acr=urn:sentropic:loa:passkey-fresh` for
passkey-backed sessions, optional `email`, `email_verified`, `name`, and optional
`cnf` when DPoP-bound.

`/userinfo` rejects unknown, expired, revoked, or scope-mismatched tokens. Unknown
requested scopes are rejected before token issuance rather than silently filtered.

## JWKS And Signing Keys

Signing uses Ed25519 / EdDSA only. The JWKS response is:

```json
{ "keys": [{ "kty": "OKP", "crv": "Ed25519", "use": "sig", "alg": "EdDSA", "kid": "...", "x": "..." }] }
```

`/.well-known/jwks.json` sends `Cache-Control: public, max-age=300`. The database
enforces one active signing key. Rotated keys remain published for at least access
token TTL plus JWKS cache TTL.

Private keys are encrypted in Postgres with `pgcrypto`. Production requires
`OAUTH_SIGNING_KEK`; dev/test may fall back to existing local secrets so docker
compose files do not change. The first key is created by
`make exec-api CMD="npm run oauth:init-keys" ... ENV=<env>` after migration.

## State Store Port

`AuthHonoPorts` gains an `oauthStateStore` port with:

- `findClient(clientId)`
- `saveAuthCode(code, payload, ttlSec)`
- `consumeAuthCode(code)`
- `saveTokenMeta(jti, meta, ttlSec)`
- `findTokenMeta(jti)`
- `revokeToken(jti)`
- `isTokenRevoked(jti)`
- `recordDpopJti(jti, expiresAt)`
- `purgeExpired()`

The package implementation stays storage-agnostic. Sentropic supplies Drizzle /
Postgres adapters; package tests use in-memory fixtures.

## DPoP Contract

DPoP is opt-in per OAuth client via `dpop_bound_access_tokens`. Bound clients must
send RFC 9449 proofs on token, userinfo, and revoke calls. The IdP verifies `htm`,
`htu`, `iat` skew, unique proof `jti`, public-key thumbprint `jkt`, and `ath` on
resource/revoke requests.

Bound access and ID tokens include `cnf.jkt`. Proof replay state is stored in
`oauth_dpop_proofs`.

## Host And UI Contracts

Sentropic mounts OAuth under `/api/v1/auth/oauth` and root discovery under
`/.well-known`. UI wrappers call `/auth/oauth/*` through `apiFetch`, which already
adds the API base URL.

`@sentropic/auth-ui` exports:

- `createOAuthClient(...)` for discovery, PKCE, code exchange, revoke, userinfo,
  and optional DPoP proof generation;
- `OAuthConsent.svelte`;
- `OAuthConsentTransport` with `getConsent({ state })` and
  `submitConsentDecision({ state, decision })`.

`OAuthConsent` never assumes `AuthUiTransport.fetch`.

## Mock RP And Tests

The package-level mock RP test uses a local minimal RP helper inside
`packages/auth-hono/tests`, not a dev dependency on `@sentropic/auth-ui`.

Full stack E2E uses:

- API origin `http://localhost:9197`
- UI origin `http://localhost:5397`
- seeded client `example-mock-rp`
- callback `http://localhost:5397/auth/oauth/callback`

Root UAT uses API origin `http://localhost:8787`, UI origin
`http://localhost:5173`, and the seed scripts `oauth:init-keys` plus
`oauth:seed-clients`.
