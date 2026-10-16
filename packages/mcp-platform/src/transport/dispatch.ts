/**
 * Lot L-3policy/4a — shared guarded dispatch (pure policy part).
 *
 * Exact-name resolve against the compiled registry, then the principal's
 * scopes/claims against the compiled effective policy. Refusals carry stable
 * codes and never invoke the adapter. Transport envelopes (Streamable HTTP,
 * stdio) and the result codec live in sibling modules.
 */

import type { CompiledMcpRegistry } from '../registry.js';

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/** Principal identity presented at the dispatch boundary. */
export type DispatchPrincipal = {
  sub: string;
  clientId: string;
  scopes: string[];
  claims: string[];
};

export type AuthorizeDispatchInput = {
  registry: CompiledMcpRegistry;
  toolName: string;
  principal: DispatchPrincipal;
};

export type DispatchDecision =
  | { allowed: true; providerId: string; capabilityName: string }
  | { allowed: false; code: 'unknown_tool' | 'insufficient_scope' | 'insufficient_claims' };

/**
 * Authorize one tool call against the compiled plan. Pure and synchronous:
 * exact-name resolve, then scope/claim coverage of the effective policy.
 */
export function authorizeDispatch(input: AuthorizeDispatchInput): DispatchDecision {
  const hit = input.registry.resolveTool(input.toolName);
  if (hit === undefined) {
    return { allowed: false, code: 'unknown_tool' };
  }
  const scopes = new Set(input.principal.scopes);
  for (const required of hit.requiredScopes) {
    if (!scopes.has(required)) {
      return { allowed: false, code: 'insufficient_scope' };
    }
  }
  const claims = new Set(input.principal.claims);
  for (const required of hit.requiredClaims) {
    if (!claims.has(required)) {
      return { allowed: false, code: 'insufficient_claims' };
    }
  }
  return { allowed: true, providerId: hit.providerId, capabilityName: hit.capabilityName };
}
