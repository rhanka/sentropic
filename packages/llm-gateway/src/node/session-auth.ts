import type { CallerAuthPort, CallerAuthRequestContext } from '../ports/caller-auth.js';
import type { CostContext } from '../ports/cost-context.js';
import { parseCallerCredential } from '../internal/auth-bridge.js';
import { GatewaySessionError, type CallerContext, type GatewaySessionService } from '../session-service.js';

export const createSessionAuth = (options: {
  service: GatewaySessionService;
  ownerScopeRef: string;
  ready(): Promise<boolean>;
  resolveOwner(caller: CallerContext, context: CallerAuthRequestContext): Promise<CostContext> | CostContext;
}): CallerAuthPort => ({
  async verify(headers, context) {
    if (!await options.ready()) throw new Error('gateway host unavailable');
    const parsed = parseCallerCredential(headers);
    if (!parsed || parsed.scheme === 'DPoP') return { ok: false, reason: 'session key refused' };
    let caller: CallerContext;
    try { caller = await options.service.resolveBearer(parsed.token); }
    catch (error) {
      if (error instanceof GatewaySessionError && ['INVALID-KEY', 'EXPIRED', 'REVOKED'].includes(error.code)) {
        return { ok: false, reason: 'session key refused' };
      }
      throw error;
    }
    if (caller.ownerScopeRef !== options.ownerScopeRef || !caller.routingContract) return { ok: false, reason: 'session policy refused' };
    const cost = await options.resolveOwner(caller, context);
    if (cost.ownerScopeRef !== caller.ownerScopeRef || cost.workspaceId !== caller.workspaceRef) return { ok: false, reason: 'session scope refused' };
    return { ok: true, cost: { ...cost, correlationId: context.requestId, gatewaySessionRef: caller.sessionRef,
      gatewayClientSessionRef: caller.clientSessionRef, launchRoutingContract: caller.routingContract } };
  },
});
