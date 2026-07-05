// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
//
// The MCP authorization draft makes this MANDATORY for MCP servers ("MCP servers MUST
// implement OAuth 2.0 Protected Resource Metadata (RFC 9728). MCP clients MUST use it for
// authorization server discovery"). The document is served at
//   /.well-known/oauth-protected-resource
// and is the URL the 401 `WWW-Authenticate: ... resource_metadata="..."` challenge points at.

/** The canonical well-known path for the PRM document (RFC 9728 §3). */
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/** RFC 9728 Protected Resource Metadata document. */
export interface ProtectedResourceMetadata {
  /** Canonical resource identifier (the token audience). */
  resource: string;
  /** Authorization servers that can issue tokens for this resource. */
  authorization_servers: string[];
  /** Scopes this resource recognizes. */
  scopes_supported?: string[];
  /** Methods the client may use to present the token (RFC 6750). */
  bearer_methods_supported: string[];
  /** DPoP signing algorithms the resource accepts (RFC 9449). */
  dpop_signing_alg_values_supported?: string[];
  /** Optional human-readable documentation URL. */
  resource_documentation?: string;
}

export interface BuildProtectedResourceMetadataInput {
  resource: string;
  authorizationServers: string[];
  scopesSupported?: string[];
  dpopSigningAlgValuesSupported?: string[];
  resourceDocumentation?: string;
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');

/**
 * The absolute URL of the PRM document for a given resource, per RFC 9728 §3.1: the
 * `/.well-known/oauth-protected-resource` path is inserted BETWEEN the host and the resource's
 * own path — it is NOT appended after it. For a path-less resource the two are identical.
 *
 *   `https://mcp.example.com`      → `https://mcp.example.com/.well-known/oauth-protected-resource`
 *   `https://immo.sent-tech.ca/mcp`→ `https://immo.sent-tech.ca/.well-known/oauth-protected-resource/mcp`
 *
 * Spec-strict clients (e.g. claude.ai) compute and probe this exact URL from the resource
 * identifier; the previous appended form (`legacyProtectedResourceMetadataUrl`) 404s them.
 */
export const protectedResourceMetadataUrl = (resource: string): string => {
  const url = new URL(trimTrailingSlash(resource));
  const resourcePath = url.pathname === '/' ? '' : url.pathname;
  return `${url.origin}${PROTECTED_RESOURCE_METADATA_PATH}${resourcePath}`;
};

/** The pathname (no origin) a host serves the RFC 9728 §3.1 PRM document at. */
export const protectedResourceMetadataPath = (resource: string): string =>
  new URL(protectedResourceMetadataUrl(resource)).pathname;

/**
 * The pre-RFC (appended) PRM URL: `<resource>/.well-known/oauth-protected-resource`. Kept so a
 * host can serve a one-minor 308 redirect shim from this suffix to the RFC-correct URL, so
 * clients pinned to the old advertised location keep working during the transition.
 */
export const legacyProtectedResourceMetadataUrl = (resource: string): string =>
  `${trimTrailingSlash(resource)}${PROTECTED_RESOURCE_METADATA_PATH}`;

/** The pathname (no origin) of the pre-RFC appended PRM location (redirect-shim source). */
export const legacyProtectedResourceMetadataPath = (resource: string): string =>
  new URL(legacyProtectedResourceMetadataUrl(resource)).pathname;

/** Build the RFC 9728 PRM document from an MCP resource-server config. */
export const buildProtectedResourceMetadata = (
  input: BuildProtectedResourceMetadataInput,
): ProtectedResourceMetadata => {
  const metadata: ProtectedResourceMetadata = {
    resource: trimTrailingSlash(input.resource),
    authorization_servers: input.authorizationServers,
    bearer_methods_supported: ['header'],
    dpop_signing_alg_values_supported: input.dpopSigningAlgValuesSupported ?? ['EdDSA'],
  };
  if (input.scopesSupported && input.scopesSupported.length > 0) {
    metadata.scopes_supported = input.scopesSupported;
  }
  if (input.resourceDocumentation) {
    metadata.resource_documentation = input.resourceDocumentation;
  }
  return metadata;
};
