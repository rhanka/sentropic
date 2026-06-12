// @sentropic/mcp-auth — framework-agnostic MCP resource-server kit.
//
// Root export = fetch-style core. Framework adapters live in subpaths (./hono).
// Consumes @sentropic/oauth-verify for token/DPoP verification primitives; owns the MCP
// scope grammar, RFC 9728 PRM serving, and RFC 6750/9728 challenge semantics.
//
// NOTE (Lot 1 contract dependency): @sentropic/oauth-verify is currently a SKELETON whose
// verify functions throw "not implemented" — Lot 1 implements them in parallel. This package
// is complete and unit-tested in isolation (its tests MOCK oauth-verify's verify functions);
// the real end-to-end token round-trip activates when Lot 1 merges.

export {
  createMcpAuth,
  type McpAuth,
  type McpAuthConfig,
  type McpAuthContext,
  type McpVerifyOptions,
} from './core.js';

export {
  McpAuthError,
  buildWwwAuthenticate,
  type AuthScheme,
  type WwwAuthenticateInput,
} from './challenge.js';

export {
  buildProtectedResourceMetadata,
  protectedResourceMetadataUrl,
  PROTECTED_RESOURCE_METADATA_PATH,
  type ProtectedResourceMetadata,
  type BuildProtectedResourceMetadataInput,
} from './prm.js';

export {
  MCP_SCOPES,
  MCP_SCOPE_DISCOVER,
  MCP_SCOPE_RESOURCES_READ,
  MCP_SCOPE_TOOLS_INVOKE,
  ALL_MCP_SCOPES,
  isMcpScope,
  type McpScope,
} from './scopes.js';

// Re-export the canonical claim types consumers commonly need alongside an McpAuthContext,
// so they need not also depend on @sentropic/oauth-verify just for the types.
export type { AccessTokenClaims, ActClaim, IdentityType } from '@sentropic/oauth-verify';
