// RFC 6750 + RFC 9728 challenge semantics for an MCP resource server.
//
// 401 → WWW-Authenticate with `resource_metadata` (RFC 9728 §5.1) pointing at the PRM
//       document, plus optional `scope` (the scopes the client should obtain).
// 403 → `error="insufficient_scope"` with the missing scopes, for the MCP step-up flow.

export type AuthScheme = 'Bearer' | 'DPoP';

/**
 * A resource-server authorization failure. Carries the HTTP status, the RFC 6750
 * `error` code, the challenge scheme and (for 403) the scopes the token is missing.
 */
export class McpAuthError extends Error {
  readonly status: 401 | 403;
  readonly code: string;
  readonly scheme: AuthScheme;
  /** Scopes required but absent — surfaced in the 403 `scope` challenge param. */
  readonly requiredScopes?: string[];

  constructor(
    status: 401 | 403,
    code: string,
    message: string,
    options?: { scheme?: AuthScheme; requiredScopes?: string[] },
  ) {
    super(message);
    this.name = 'McpAuthError';
    this.status = status;
    this.code = code;
    this.scheme = options?.scheme ?? 'Bearer';
    this.requiredScopes = options?.requiredScopes;
  }
}

const quote = (value: string): string => `"${value.replace(/"/gu, '\\"')}"`;

export interface WwwAuthenticateInput {
  scheme: AuthScheme;
  error?: string;
  errorDescription?: string;
  /** RFC 6750 `scope` — space-delimited scopes the client should request. */
  scope?: string | string[];
  /** RFC 9728 §5.1 `resource_metadata` — absolute URL of the PRM document. */
  resourceMetadata?: string;
}

/**
 * Build a `WWW-Authenticate` header value (RFC 6750 §3 + RFC 9728 §5.1).
 * Example:
 *   Bearer error="insufficient_scope", error_description="...", scope="mcp:tools:invoke", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"
 */
export const buildWwwAuthenticate = (input: WwwAuthenticateInput): string => {
  const params: string[] = [];
  if (input.error) params.push(`error=${quote(input.error)}`);
  if (input.errorDescription) params.push(`error_description=${quote(input.errorDescription)}`);
  const scope = Array.isArray(input.scope) ? input.scope.join(' ') : input.scope;
  if (scope) params.push(`scope=${quote(scope)}`);
  if (input.resourceMetadata) params.push(`resource_metadata=${quote(input.resourceMetadata)}`);
  return params.length > 0 ? `${input.scheme} ${params.join(', ')}` : input.scheme;
};
