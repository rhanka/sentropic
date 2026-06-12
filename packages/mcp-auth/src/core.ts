// @sentropic/mcp-auth core — framework-agnostic MCP resource-server kit.
//
// BYO host: the core is fetch-style (Request -> Response). Adapters per framework live in
// subpaths (./hono). It consumes @sentropic/oauth-verify for the actual token + DPoP
// verification (architect verdict §10: verification core sits BELOW the resource server);
// mcp-auth adds what an MCP RS needs on top: RFC 9728 PRM serving, audience=resource binding,
// the `tid` tenant hook, and RFC 6750/9728 challenge semantics.

import {
  fromRemoteJwks,
  verifyAccessToken,
  verifyDpopProof,
  TokenVerifyError,
  DpopVerifyError,
  type AccessTokenClaims,
  type ActClaim,
  type TokenKeySource,
} from '@sentropic/oauth-verify';

import { McpAuthError, buildWwwAuthenticate } from './challenge.js';
import {
  buildProtectedResourceMetadata,
  protectedResourceMetadataUrl,
  PROTECTED_RESOURCE_METADATA_PATH,
  type ProtectedResourceMetadata,
} from './prm.js';

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');

const parseScopes = (scope: unknown): string[] =>
  typeof scope === 'string' ? scope.split(/\s+/u).filter(Boolean) : [];

export interface McpAuthConfig {
  /** Canonical resource URI = the token audience (single-audience model). */
  resource: string;
  /** Authorization servers (PRM `authorization_servers`). */
  authorizationServers: string[];
  /** Scopes advertised in the PRM document. */
  scopesSupported?: string[];
  /**
   * Verification key source. Defaults to a remote JWKS off the first authorization
   * server's `<as>/.well-known/jwks.json` (external RS posture). In-process servers
   * may inject `fromJwksPort(...)` from @sentropic/oauth-verify.
   */
  keySource?: TokenKeySource;
  /** Require a DPoP scheme + proof even for non-bound tokens (NHI-grade servers). */
  requireDpop?: boolean;
  /** Tenant enforcement: require a `tid`, or a predicate over `(tid, claims)`. */
  requireTid?:
    | boolean
    | ((tid: string | undefined, claims: AccessTokenClaims) => boolean | Promise<boolean>);
  /** Optional `resource_documentation` URL in the PRM document. */
  resourceDocumentation?: string;
  /** DPoP proof iat acceptance window in seconds (default 60). */
  dpopIatSkewSeconds?: number;
}

/** Per-request verified MCP authorization context. */
export interface McpAuthContext {
  sub: string;
  clientId: string;
  scopes: string[];
  tid: string | null;
  jkt: string | null;
  act: ActClaim | null;
  claims: AccessTokenClaims;
}

export interface McpVerifyOptions {
  requiredScopes?: string[];
}

export interface McpAuth {
  /** The RFC 9728 PRM document. */
  metadata(): ProtectedResourceMetadata;
  /**
   * Serve `/.well-known/oauth-protected-resource` when the request targets it; otherwise
   * return `null` to let the host continue to the protected handler.
   */
  handle(req: Request): Promise<Response | null>;
  /** Verify a request's access token (+DPoP, +tid, +scopes); throws McpAuthError on failure. */
  verify(req: Request, opts?: McpVerifyOptions): Promise<McpAuthContext>;
  /** Turn a verification error into a 401/403 Response with the proper WWW-Authenticate. */
  challenge(error: unknown): Response;
}

interface ParsedAuthorization {
  scheme: 'Bearer' | 'DPoP';
  token: string;
}

const parseAuthorization = (header: string | null): ParsedAuthorization => {
  if (!header) {
    throw new McpAuthError(401, 'invalid_token', 'Authorization header is required.');
  }
  const [scheme, token] = header.split(/\s+/u, 2);
  if (!token) {
    throw new McpAuthError(401, 'invalid_token', 'Authorization header is malformed.');
  }
  if (scheme === 'Bearer') return { scheme: 'Bearer', token };
  if (scheme === 'DPoP') return { scheme: 'DPoP', token };
  throw new McpAuthError(401, 'invalid_token', 'Unsupported authorization scheme.');
};

export const createMcpAuth = (config: McpAuthConfig): McpAuth => {
  const resource = trimTrailingSlash(config.resource);
  const authorizationServers = config.authorizationServers.map(trimTrailingSlash);
  if (authorizationServers.length === 0) {
    throw new Error('@sentropic/mcp-auth: at least one authorizationServer is required.');
  }
  const prmUrl = protectedResourceMetadataUrl(resource);
  const keySource =
    config.keySource ?? fromRemoteJwks(`${authorizationServers[0]}/.well-known/jwks.json`);

  const metadata = (): ProtectedResourceMetadata =>
    buildProtectedResourceMetadata({
      resource,
      authorizationServers,
      scopesSupported: config.scopesSupported,
      resourceDocumentation: config.resourceDocumentation,
    });

  const handle = async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    if (url.pathname === PROTECTED_RESOURCE_METADATA_PATH) {
      return Response.json(metadata(), {
        headers: { 'Cache-Control': 'public, max-age=300' },
      });
    }
    return null;
  };

  const verify = async (req: Request, opts?: McpVerifyOptions): Promise<McpAuthContext> => {
    const { scheme, token } = parseAuthorization(req.headers.get('authorization'));

    let claims: AccessTokenClaims;
    try {
      claims = await verifyAccessToken({
        token,
        keySource,
        issuer: authorizationServers,
        audience: resource,
        requiredScopes: opts?.requiredScopes,
      });
    } catch (error) {
      if (error instanceof TokenVerifyError) {
        throw new McpAuthError(401, 'invalid_token', error.message, { scheme });
      }
      throw error;
    }

    const scopes = parseScopes(claims.scope);
    // Re-assert scopes locally so callers get a 403 (insufficient_scope) challenge with the
    // missing scopes echoed, independent of how oauth-verify surfaced requiredScopes.
    if (opts?.requiredScopes && opts.requiredScopes.length > 0) {
      const granted = new Set(scopes);
      const missing = opts.requiredScopes.filter((s) => !granted.has(s));
      if (missing.length > 0) {
        throw new McpAuthError(403, 'insufficient_scope', `Missing required scope: ${missing.join(' ')}.`, {
          scheme,
          requiredScopes: missing,
        });
      }
    }

    const jkt = await enforceDpop(req, claims, token, scheme, config, keySource);

    const tid = typeof claims.tid === 'string' ? claims.tid : null;
    await enforceTid(tid, claims, config);

    return {
      sub: String(claims.sub ?? ''),
      clientId: typeof claims.client_id === 'string' ? claims.client_id : String(claims.sub ?? ''),
      scopes,
      tid,
      jkt,
      act: claims.act ?? null,
      claims,
    };
  };

  const challenge = (error: unknown): Response => challengeFor(error, prmUrl);

  return { metadata, handle, verify, challenge };
};

const enforceDpop = async (
  req: Request,
  claims: AccessTokenClaims,
  accessToken: string,
  scheme: 'Bearer' | 'DPoP',
  config: McpAuthConfig,
  _keySource: TokenKeySource,
): Promise<string | null> => {
  const boundJkt = claims.cnf?.jkt;
  if (!boundJkt && !config.requireDpop) return null;

  if (scheme !== 'DPoP') {
    throw new McpAuthError(401, 'invalid_token', 'DPoP-bound resource requires the DPoP authorization scheme.', {
      scheme: 'DPoP',
    });
  }
  const proof = req.headers.get('dpop');
  if (!proof) {
    throw new McpAuthError(401, 'invalid_dpop_proof', 'DPoP proof is required.', { scheme: 'DPoP' });
  }

  try {
    const verified = await verifyDpopProof({
      proof,
      htm: req.method,
      htu: req.url,
      accessToken,
      expectedJkt: boundJkt,
      iatSkewSec: config.dpopIatSkewSeconds,
    });
    return verified.jkt;
  } catch (error) {
    if (error instanceof DpopVerifyError) {
      throw new McpAuthError(401, 'invalid_dpop_proof', error.message, { scheme: 'DPoP' });
    }
    throw error;
  }
};

const enforceTid = async (
  tid: string | null,
  claims: AccessTokenClaims,
  config: McpAuthConfig,
): Promise<void> => {
  const requirement = config.requireTid;
  if (!requirement) return;
  if (requirement === true) {
    if (!tid) {
      throw new McpAuthError(403, 'invalid_token', 'A tenant (tid) claim is required.');
    }
    return;
  }
  const ok = await requirement(tid ?? undefined, claims);
  if (!ok) {
    throw new McpAuthError(403, 'invalid_token', 'Tenant (tid) is not permitted for this resource.');
  }
};

const challengeFor = (error: unknown, resourceMetadata: string): Response => {
  if (error instanceof McpAuthError) {
    const www = buildWwwAuthenticate({
      scheme: error.scheme,
      error: error.code,
      errorDescription: error.message,
      scope: error.requiredScopes && error.requiredScopes.length > 0 ? error.requiredScopes : undefined,
      resourceMetadata,
    });
    return Response.json({ error: { code: error.code, message: error.message } }, {
      status: error.status,
      headers: { 'WWW-Authenticate': www },
    });
  }
  // Unknown error: do not leak; emit a generic 401 invalid_token challenge.
  const www = buildWwwAuthenticate({ scheme: 'Bearer', error: 'invalid_token', resourceMetadata });
  return Response.json({ error: { code: 'invalid_token', message: 'Authorization failed.' } }, {
    status: 401,
    headers: { 'WWW-Authenticate': www },
  });
};
