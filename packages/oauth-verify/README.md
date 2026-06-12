# @sentropic/oauth-verify

Framework-free OAuth2/OIDC **verification** core for Sentropic. It provides the verify-only
primitives that both the authorization server (`@sentropic/auth-hono`) and resource servers
(`@sentropic/mcp-auth`, app endpoints) share, so security-critical verification logic lives in
exactly one place.

- **Access-token verification** — `jwtVerify` against a resolved key, validating issuer,
  audience, expiry and required scopes.
- **DPoP-proof verification** (RFC 9449) — header `jwk` + signature, `htm`/`htu`/`iat`/`ath`
  checks, optional single-use `jti` replay guard, returns the key thumbprint (`jkt`) + `jti`.
- **Pluggable key source** — a `TokenKeySource` port with two adapters: a remote JWKS
  (`fromRemoteJwks`, for external resource servers) and an in-process JWKS provider
  (`fromJwksPort`, for the IdP-colocated server).
- **Canonical claim types** — `AccessTokenClaims`, `ActClaim`, `IdentityType`.

Out of scope by design (architect verdict, `spec/SPEC_STUDY_39_MCP_LIBRARIZATION.md` §2/§10):
no issuer/signing logic, no PRM serving, **no MCP scope grammar** — those live in
`@sentropic/auth-hono` (issuance) and `@sentropic/mcp-auth` (resource-server profile).

## Scope

- **Framework-free**: zero Hono, zero zod, zero storage. Runs anywhere `fetch` + WebCrypto run
  (Node, workers, edge).
- `jose` is the only peer dependency.

## Install

```bash
npm install @sentropic/oauth-verify
```

`jose` is a peer dependency.

## Quickstart

### Verify an access token (in-process key source)

```ts
import { fromJwksPort, verifyAccessToken } from '@sentropic/oauth-verify';

// jwksProvider exposes findKeyByKid(kid) and getActiveKey() (e.g. auth-hono's JwksPort).
const keySource = fromJwksPort(jwksProvider);

const claims = await verifyAccessToken({
  token,
  keySource,
  issuer: 'https://api.example.com',
  audience: 'https://api.example.com',
  requiredScopes: ['service:ping'],
});
```

### Verify an access token (remote JWKS — external resource server)

```ts
import { fromRemoteJwks, verifyAccessToken } from '@sentropic/oauth-verify';

const keySource = fromRemoteJwks('https://api.example.com/.well-known/jwks.json', {
  cacheMaxAgeSec: 600,
});

const claims = await verifyAccessToken({
  token,
  keySource,
  issuer: 'https://api.example.com',
  audience: 'https://mcp.example.com',
});
```

### Verify a DPoP proof

```ts
import { verifyDpopProof } from '@sentropic/oauth-verify';

const { jkt, jti } = await verifyDpopProof({
  proof, // DPoP header value
  htm: request.method,
  htu: request.url,
  accessToken, // binds ath
  expectedJkt: claims.cnf?.jkt, // binds to the token's confirmation thumbprint
  replay: async (jti, expiresAt) => store.recordDpopJti(jti, expiresAt), // single-use guard
});
```

## API

| Export | Purpose |
| --- | --- |
| `verifyAccessToken(opts)` | Verify a signed access token → `AccessTokenClaims`, or throw `TokenVerifyError`. |
| `verifyDpopProof(opts)` | Verify a DPoP proof → `{ jkt, jti }`, or throw `DpopVerifyError`. |
| `fromRemoteJwks(jwksUri, opts?)` | `TokenKeySource` backed by a cached remote JWKS. |
| `fromJwksPort(jwksProvider)` | `TokenKeySource` backed by an in-process JWKS provider. |
| `parseScopes(scope)` | Split an OAuth `scope` string into tokens. |
| `AccessTokenClaims`, `ActClaim`, `IdentityType` | Canonical claim types. |
| `TokenVerifyError`, `DpopVerifyError` | Verification error classes. |

## License

MIT
