import type { CostContext, CostContextResolver } from './ports/cost-context.js';
import type { CallerAuthRequestContext } from './ports/caller-auth.js';
import type { VerifiedPrincipal } from './personal-passthrough/caller-auth.js';

export class VerifiedCostContextResolver implements CostContextResolver {
  resolve(principal: VerifiedPrincipal, context: CallerAuthRequestContext): CostContext | undefined {
    const required = [principal?.tenantId, principal?.principalId, principal?.source,
      principal?.ownerScopeRef, context?.requestId];
    if (required.some(value => typeof value !== 'string' || !value.trim())) return undefined;
    return {
      tenantId: principal.tenantId, principalId: principal.principalId,
      ownerScopeRef: principal.ownerScopeRef, source: principal.source,
      ...(principal.workspaceId !== undefined ? { workspaceId: principal.workspaceId } : {}),
      ...(principal.budgetScope !== undefined ? { budgetScope: principal.budgetScope } : {}),
      correlationId: context.requestId, callSite: 'llm-gateway',
    };
  }
}
