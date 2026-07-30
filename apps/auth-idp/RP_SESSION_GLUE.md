# RP session-glue recipe (BR-39m Phase A0, gap G2)

> **Why this exists.** The IdP ships the full `authorization_code` + PKCE +
> consent + userinfo + JWKS flow, but the **relying party (RP) side stops at
> token exchange**:
> - `@sentropic/auth-ui` → `createOAuthClient(...).exchangeCode()` returns the
>   tokens and goes no further (see `packages/auth-ui/src/oauth-client.ts`); the
>   demo callback `ui/src/routes/auth/oauth/callback/+page.svelte` only renders
>   the tokens in dev.
> - `@sentropic/auth-client` is the **S2S** client-credentials helper (BR-39d) —
>   it has no browser/authorization-code/session concept.
>
> So every RP (starting with `design-system`) must implement the last mile:
> **callback → verify the id_token against the IdP JWKS → set its OWN session
> cookie**. This recipe is the documented, copy-paste reference for that mile.
> It is intentionally a recipe, not yet a package; a shared
> `@sentropic/auth-client` browser helper is a later-phase decision (spec R3).

## Preconditions

- The RP is registered as an `oauth_clients` row at the IdP (Phase A0 seeds
  `design-system`; see `api/src/services/auth/oauth-client-seed.ts`).
- The RP's exact `redirect_uri` is in that row's `redirectUris` (PLACEHOLDER
  values for `design-system` pending F5 validation).
- The IdP issuer base URL is known to the RP (e.g. `https://auth.sent-tech.ca`).

## Flow overview

```
Browser            RP backend                 IdP (auth.sent-tech.ca)
  |  GET /login -----> startAuthorization() --------------------------->
  |  <----------------- 302 to /api/v1/auth/oauth/authorize ------------|
  |  (user logs in / consents at the IdP origin) ---------------------->|
  |  <------------------------ 302 back to RP redirect_uri?code&state --|
  |  GET /auth/oauth/callback?code&state --> [GLUE] :                   |
  |       1. validate state (CSRF)                                      |
  |       2. exchangeCode(code, code_verifier) --> POST /oauth/token -->|
  |       3. verify id_token signature via JWKS  --> GET /jwks.json --->|
  |       4. verify iss / aud / exp / nonce                             |
  |       5. set RP session cookie (HttpOnly)                           |
  |  <----------------- 302 to the RP app, now authenticated ----------|
```

Steps 1–2 are provided by `createOAuthClient`. **Steps 3–5 are the glue.**

## Step 1 — Start authorization (already available)

```ts
import { createOAuthClient } from '@sentropic/auth-ui';

const client = createOAuthClient({
  clientId: 'design-system',
  issuer: 'https://auth.sent-tech.ca',
  redirectUri: 'https://design-system.example/auth/oauth/callback',
  scopes: ['openid', 'profile', 'email'],
});

// Generate + persist (server-side session or signed cookie) the codeVerifier,
// state, and nonce so the callback can validate them.
const { url, codeVerifier, state, nonce } = await client.startAuthorization({
  state: crypto.randomUUID(),
  nonce: crypto.randomUUID(),
});
// store { codeVerifier, state, nonce } keyed to the user agent, then redirect:
// return Response.redirect(url, 302);
```

## Step 2 — Exchange the code (already available)

```ts
// In the callback handler, after validating `state` matches what you stored:
const tokens = await client.exchangeCode(code, storedCodeVerifier);
// tokens: { access_token, token_type, expires_in?, id_token?, scope? }
```

## Step 3 — Verify the id_token against the IdP JWKS (THE GLUE)

The IdP signs id_tokens with Ed25519 (`alg: EdDSA`) and publishes its public
keys at `/.well-known/jwks.json`. Verify with `jose`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = 'https://auth.sent-tech.ca';
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

if (!tokens.id_token) throw new Error('missing_id_token');

const { payload } = await jwtVerify(tokens.id_token, JWKS, {
  issuer: ISSUER,                 // must equal the IdP issuer
  audience: 'design-system',      // must equal your client_id
});

// Step 4 — verify nonce binds this id_token to YOUR authorization request:
if (payload.nonce !== storedNonce) throw new Error('nonce_mismatch');
// `exp` is enforced by jwtVerify. `payload.sub` is the stable user id.
```

> **Claim set — CORRECTED 2026-07-25.** This note previously said the tokens
> carry only `sub`, `name`, `email` and that any tenant-scoped RP "must wait for
> Phase A1 (BR-39n)". That is STALE: BR-39e landed the `tid` binding, and live
> discovery at `auth.sent-tech.ca` (verified 2026-07-25) advertises
> `claims_supported = [sub, aud, iss, exp, iat, nonce, auth_time, acr, email,
> email_verified, name, tid]`. `tid` is emitted on both id_token and
> access_token when an approved `tenant_memberships` row resolves, and is
> dropped if that membership was suspended between authorize and token.
> Still NOT emitted: `role`, a membership-LIST claim, or any product-scoped
> authorization claim — do NOT hand-roll those. An RP that only needs to
> identify the account needs `sub` alone (stable `users.id`), which A0 already
> emitted; it does not need to wait for anything.

Optionally fetch fresh profile data with the access token:

```ts
const profile = await client.userInfo(tokens.access_token); // { sub, name, email }
```

## Step 5 — Set the RP's OWN session cookie

The id_token proves identity; it is **not** the RP session. Mint your own
session (DB-backed or signed) and set an `HttpOnly` cookie scoped to the RP:

```ts
const session = await rpSessions.create({ sub: payload.sub, email: payload.email });

headers.append(
  'Set-Cookie',
  serializeCookie('ds_session', session.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',     // Lax is enough for top-level redirect login
    path: '/',
    maxAge: 60 * 60 * 8, // RP-decided lifetime; see F8 for silent renew
  }),
);
return new Response(null, { status: 302, headers: { Location: '/', ...Object.fromEntries(headers) } });
```

## Cross-subdomain / passkey notes (Phase A0 caveats)

- **Cookie domain (G2).** The IdP session cookie is host-only at the IdP origin.
  The RP sets its OWN cookie at the RP origin — do NOT try to share one cookie
  across subdomains. SSO is achieved by re-running `authorize` (the IdP session
  cookie satisfies it silently); see F8 silent renew via `prompt=none`.
- **Passkey rpID (G3).** Passkeys are bound to the origin where they were
  registered. Moving human login to `auth.sent-tech.ca` means passkeys minted
  under another origin will NOT validate at the IdP — a one-time
  re-registration / magic-link bootstrap is required. `design-system` free auth
  sidesteps this in A0 (login optional), but every later app must plan it.

## Logout (fork F7 default)

RP-initiated logout: clear the RP cookie locally, then redirect the browser to
the IdP `end_session_endpoint` to clear the IdP session. Back-channel SLO is a
later phase.

## Token verification — do NOT skip

- Always verify `iss`, `aud`, `exp`, signature (JWKS), and `nonce`.
- Honor the JWKS `Cache-Control: max-age=300`; `createRemoteJWKSet` caches and
  refetches on unknown `kid`, which tolerates IdP key rotation (spec §5.3 / §7).
- Never trust an unverified id_token or treat the access_token as identity.
