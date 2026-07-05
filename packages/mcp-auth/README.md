# @sentropic/mcp-auth

Framework-agnostic **MCP resource-server** kit. Everything an MCP server (ours or a third
party's) needs to be Model Context Protocol authorization-draft compliant against any
spec-compliant OAuth 2.1 authorization server (the Sentropic IdP included):

- **RFC 9728** Protected Resource Metadata (`/.well-known/oauth-protected-resource`)
- MCP-profile **audience-bound access-token validation** (`aud` = resource URI, single-audience model)
- **RFC 9449 DPoP** proof verification for sender-constrained tokens
- a **tenant (`tid`) hook**
- **RFC 6750 / RFC 9728** `WWW-Authenticate` challenge semantics (401 with `resource_metadata` + `scope`, 403 `insufficient_scope`)
- the **MCP scope grammar** (`mcp:discover`, `mcp:resources:read`, `mcp:tools:invoke`)

It consumes [`@sentropic/oauth-verify`](../oauth-verify) for the actual token + DPoP
verification primitives (the verification core sits *below* both the issuer `auth-hono` and
this resource-server kit). BYO host: the root export is fetch-style (`Request` → `Response`);
framework adapters live in subpaths (`./hono`).

## Install

```sh
npm install @sentropic/mcp-auth @sentropic/oauth-verify jose
# + hono, only if you use the ./hono adapter
```

`jose` is a peer dependency; `hono` is an **optional** peer (needed only for `./hono`).

## Usage — framework-agnostic (fetch style)

```ts
import { createMcpAuth, MCP_SCOPES } from '@sentropic/mcp-auth';

const mcp = createMcpAuth({
  resource: 'https://mcp.example.com',
  authorizationServers: ['https://auth.sent-tech.ca'],
  scopesSupported: [MCP_SCOPES.TOOLS_INVOKE],
});

export async function fetchHandler(req: Request): Promise<Response> {
  // RFC 9728 PRM document at /.well-known/oauth-protected-resource
  const wellKnown = await mcp.handle(req);
  if (wellKnown) return wellKnown;

  try {
    const auth = await mcp.verify(req, { requiredScopes: [MCP_SCOPES.TOOLS_INVOKE] });
    return serveMcp(req, auth); // auth.sub / auth.tid / auth.act / auth.claims available
  } catch (err) {
    return mcp.challenge(err); // 401/403 with WWW-Authenticate (resource_metadata + scope)
  }
}
```

## Usage — Hono adapter

```ts
import { mcpAuthRoutes, requireMcpAuth, getMcpAuthContext } from '@sentropic/mcp-auth/hono';

app.route('/', mcpAuthRoutes(mcp)); // serves the PRM well-known
app.use('/mcp/*', requireMcpAuth(mcp, { requiredScopes: ['mcp:tools:invoke'] }));
app.post('/mcp/invoke', (c) => {
  const auth = getMcpAuthContext(c); // { sub, clientId, scopes, tid, jkt, act, claims }
  // ...
});
```

`requireMcpAuth` is the successor of `auth-hono`'s `createRequireServiceAuth`: it delegates
to `@sentropic/oauth-verify` and adds the PRM-pointer challenges and remote-JWKS key source
an external resource server needs.

## Key sources

By default `createMcpAuth` resolves keys from the first authorization server's
`<as>/.well-known/jwks.json` (remote JWKS — the external resource-server posture). An
IdP-colocated server may inject an in-process key source:

```ts
import { fromJwksPort } from '@sentropic/oauth-verify';

const mcp = createMcpAuth({
  resource,
  authorizationServers,
  keySource: fromJwksPort(myDbBackedJwksProvider),
});
```

## RFC 9728 Protected Resource Metadata

`mcp.metadata()` / the well-known route returns:

```json
{
  "resource": "https://mcp.example.com",
  "authorization_servers": ["https://auth.sent-tech.ca"],
  "scopes_supported": ["mcp:tools:invoke"],
  "bearer_methods_supported": ["header"],
  "dpop_signing_alg_values_supported": ["EdDSA"]
}
```

## Configuration

| Option | Description |
| --- | --- |
| `resource` | Canonical resource URI = token audience (single-audience model). |
| `authorizationServers` | PRM `authorization_servers`; first one's JWKS is the default key source. |
| `scopesSupported` | Scopes advertised in the PRM document. |
| `keySource` | Override the default remote JWKS key source (e.g. `fromJwksPort`). |
| `requireDpop` | Require the DPoP scheme + proof even for non-bound tokens (NHI-grade servers). |
| `requireTid` | `true` to require any `tid`, or a `(tid, claims) => boolean` predicate. |
| `resourceDocumentation` | Optional `resource_documentation` URL in the PRM document. |
| `dpopIatSkewSeconds` | DPoP proof `iat` acceptance window (default 60). |

## Scope grammar

The MCP scope grammar lives in this package (not in `oauth-verify`, which stays a generic
verify core):

```ts
import { MCP_SCOPES, ALL_MCP_SCOPES, isMcpScope } from '@sentropic/mcp-auth';
// MCP_SCOPES.DISCOVER        === 'mcp:discover'
// MCP_SCOPES.RESOURCES_READ  === 'mcp:resources:read'
// MCP_SCOPES.TOOLS_INVOKE    === 'mcp:tools:invoke'
```

## License

MIT
