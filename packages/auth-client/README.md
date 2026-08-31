# @sentropic/auth-client

Node-only OAuth2 `client_credentials` helper for Sentropic service-to-service (S2S) auth. It mints scoped, audience-bound, optionally DPoP-bound access tokens and caches them in memory with automatic refresh.

Pairs with `@sentropic/auth-hono`:

- the IdP exposes the `client_credentials` grant on its token endpoint;
- the resource server protects routes with `createRequireServiceAuth`;
- this package is the outbound consumer that obtains and presents the token.

## Scope

- **Node-only** (`BR39d-D3`): uses `jose` + Node `crypto`. A browser variant is deferred.
- Tokens are **stateless** (`BR39d-D5`): there is no revocation endpoint; rely on short TTLs (default 900s) and secret rotation. Resource servers verify statelessly via JWKS.

## Install

```bash
npm install @sentropic/auth-client
```

`jose` is a peer dependency.

## Quickstart

```ts
import { createAuthClient } from '@sentropic/auth-client';

const auth = createAuthClient({
  issuer: 'https://api.example.com',
  clientId: 'my-service',
  clientSecret: process.env.MY_SERVICE_SECRET!,
  scope: ['service:ping'],
  resource: 'https://api.example.com',
});

// Cached + auto-refreshed (refresh skew defaults to 30s before expiry).
const token = await auth.getToken();

const res = await fetch('https://api.example.com/internal/ping', {
  headers: { authorization: `${token.token_type} ${token.access_token}` },
});
```

`getToken({ scope, resource, forceRefresh })` overrides the defaults per call. The
cache is keyed by `scope + resource`, so different audiences/scopes are cached
independently.

## DPoP (opt-in)

Enable DPoP-bound tokens (recommended for production S2S, `BR39d-D1`):

```ts
const auth = createAuthClient({
  issuer: 'https://api.example.com',
  clientId: 'my-service',
  clientSecret: process.env.MY_SERVICE_SECRET!,
  dpop: true,
});

const token = await auth.getToken(); // token_type === 'DPoP'

// Bind each outbound request to the token (RFC 9449 ath):
const proof = await auth.buildDpopProof({
  htm: 'GET',
  htu: 'https://api.example.com/internal/ping',
  accessToken: token.access_token,
});

await fetch('https://api.example.com/internal/ping', {
  headers: { authorization: `DPoP ${token.access_token}`, dpop: proof },
});
```

A single Ed25519 keypair is generated lazily per client instance and reused for
the token request proof and all subsequent request proofs.

## Configuration

| Option               | Default                                  | Notes                                            |
| -------------------- | ---------------------------------------- | ------------------------------------------------ |
| `issuer`             | —                                        | Required. OAuth2 issuer base URL.                |
| `clientId`           | —                                        | Required.                                        |
| `clientSecret`       | —                                        | Required. Sent via HTTP Basic auth.              |
| `scope`              | `undefined`                              | Default scopes (string or array).                |
| `resource`           | `undefined`                              | Default RFC 8707 resource indicator.             |
| `dpop`               | `false`                                  | Opt-in DPoP-bound tokens.                        |
| `tokenEndpoint`      | `${issuer}/api/v1/oauth/token`           | Override for the IdP projection.                 |
| `refreshSkewSeconds` | `30`                                     | Refresh this long before expiry.                 |
| `fetch`              | global `fetch`                           | Injectable for testing/proxying.                 |
| `now`                | `() => new Date()`                       | Injectable clock for testing.                    |

## Errors

`getToken` throws `AuthClientError` on a non-2xx token response, exposing
`status` and the OAuth `code` (e.g. `invalid_client`, `invalid_scope`,
`invalid_target`).
