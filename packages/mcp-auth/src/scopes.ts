// MCP scope grammar — the canonical home (architect verdict §10 OVERRIDE of study F3:
// MCP scope-grammar constants do NOT belong in @sentropic/oauth-verify — that would
// leak MCP semantics into the generic OAuth verify core. They live HERE in mcp-auth.
//
// Aligned with the Resource-Plane catalog verbs (RF §3.2 discover/read/invoke) and the
// MCP authorization draft. Exact strings are auth-lane-decidable (owner naming check at
// publication, per the durable-naming rule); they are exported as constants so the issuer
// (auth-hono), the resource server (this package's PRM + validator) and consumers all
// reference ONE spelling, never a free-form literal.

/** Discover the tools/resources an MCP server exposes (catalog `discover`). */
export const MCP_SCOPE_DISCOVER = 'mcp:discover';

/** Read MCP resources (catalog `read`). */
export const MCP_SCOPE_RESOURCES_READ = 'mcp:resources:read';

/** Invoke MCP tools (catalog `invoke`). */
export const MCP_SCOPE_TOOLS_INVOKE = 'mcp:tools:invoke';

/** The full MCP scope grammar, keyed by capability. */
export const MCP_SCOPES = {
  DISCOVER: MCP_SCOPE_DISCOVER,
  RESOURCES_READ: MCP_SCOPE_RESOURCES_READ,
  TOOLS_INVOKE: MCP_SCOPE_TOOLS_INVOKE,
} as const;

export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];

/** Every MCP scope, for `scopes_supported` defaults / validation. */
export const ALL_MCP_SCOPES: readonly string[] = Object.freeze(Object.values(MCP_SCOPES));

/** True if every string in `scopes` is a known MCP scope. */
export const isMcpScope = (scope: string): scope is McpScope =>
  (ALL_MCP_SCOPES as readonly string[]).includes(scope);
