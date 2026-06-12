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

/** The absolute URL of the PRM document for a given resource. */
export const protectedResourceMetadataUrl = (resource: string): string =>
  `${trimTrailingSlash(resource)}${PROTECTED_RESOURCE_METADATA_PATH}`;

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
