/**
 * Lot L-3policy/4a — shared guarded dispatch (pure policy part).
 *
 * Exact-name resolve against the compiled registry, then the principal's
 * scopes/claims against the compiled effective policy. Refusals carry stable
 * codes and never invoke the adapter. Transport envelopes (Streamable HTTP,
 * stdio) and the result codec live in sibling modules.
 */

import type { CompiledMcpRegistry } from '../registry.js';
import type { StpConnectorContext } from '../runtime.js';
import { projectMemoryContext, requireTrustedInvocationContext } from '../memory/invocation-context.js';

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

// ---------------------------------------------------------------------------
// Memory dispatch (L5 Lot 1)
// ---------------------------------------------------------------------------

export type AuthorizeMemoryDispatchInput = AuthorizeDispatchInput & {
  /**
   * Literal-true verdict from the verified-context guard (M4): only the
   * Boolean literal `true` admits a memory call to plan resolution. Any
   * other value refuses before resource acquisition or effect.
   */
  contextVerified: unknown;
};

export type MemoryDispatchDecision =
  | DispatchDecision
  | { allowed: false; code: 'unverified_context' };

/**
 * Authorize one memory tool call: require the verified-context verdict,
 * then exact-name resolve plus scope/claim coverage of the effective
 * policy. Pure and synchronous.
 */
export function authorizeMemoryDispatch(input: AuthorizeMemoryDispatchInput): MemoryDispatchDecision {
  if (input.contextVerified !== true) {
    return { allowed: false, code: 'unverified_context' };
  }
  return authorizeDispatch(input);
}

/** Full-context transport policy; a literal verdict alone never supplies identity or source authority. */
export function authorizeVerifiedMemoryDispatch(input: {
  registry: CompiledMcpRegistry; toolName: string; context: StpConnectorContext;
}): DispatchDecision | { allowed: false; code: 'source_binding_mismatch' } {
  const ctx = requireTrustedInvocationContext(input.context);
  projectMemoryContext(ctx, ctx.memory!.binding.purpose_ref);
  const decision = authorizeDispatch({ registry: input.registry, toolName: input.toolName, principal: {
    sub: ctx.principal.sub, clientId: ctx.mcpClient!.clientId,
    scopes: [...ctx.principal.scopes], claims: Object.keys(ctx.principal.claims),
  } });
  if (decision.allowed && decision.providerId !== 'sentropic.engram.memory') {
    return { allowed: false, code: 'source_binding_mismatch' };
  }
  return decision;
}
