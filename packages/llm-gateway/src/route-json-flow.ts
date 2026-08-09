import type { PreparedRouteAttempt, RouteAttemptUsage } from '@sentropic/llm-mesh';
import { encodeGatewayResponse, type CanonicalGatewayResponse } from './canonical-egress.js';
import type { GatewayFlowRequest, SettleUsage } from './flow.js';
import {
  aggregateUsage, attemptUsage, classifyRouteError, prepareRouteFlow, routeUsage,
  type RouteAttemptSettlement, type RouteFlowDeps,
} from './route-flow-core.js';
import { GatewayError } from './router/errors.js';

const errorUsage = (error: unknown): SettleUsage => {
  if (!error || typeof error !== 'object') return routeUsage();
  const usage = (error as { usage?: RouteAttemptUsage }).usage;
  return usage ? { ...usage } : routeUsage();
};

export const runRouteJsonFlow = async (
  deps: RouteFlowDeps,
  request: GatewayFlowRequest,
): Promise<CanonicalGatewayResponse> => {
  const prepared = await prepareRouteFlow(deps, request);
  const attempts: RouteAttemptSettlement[] = [];
  for (let index = 0; index < prepared.plan.candidateRefs.length; index += 1) {
    const candidateRef = prepared.plan.candidateRefs[index]!;
    const diagnostic = prepared.plan.diagnostics[index]!;
    let attempt: PreparedRouteAttempt | undefined;
    try {
      attempt = await deps.routePlanner.prepareAttempt(
        prepared.subject, prepared.plan.planRef, candidateRef, prepared.cost.correlationId, index,
      );
      const response = await attempt.generate({
        ...prepared.canonical.request,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      const usage = routeUsage(response.usage);
      await attempt.complete(attemptUsage(usage));
      attempts.push({
        candidateRef, providerId: diagnostic.actualProviderId,
        modelId: diagnostic.actualModelId,
        transportProviderId: diagnostic.actualTransportProviderId,
        outcome: 'success', usage,
      });
      await deps.metering.settleRoute({
        cost: prepared.cost, wire: request.wire, requestedModel: request.model,
        outcome: 'success', usage: aggregateUsage(attempts), attempts,
      });
      return encodeGatewayResponse(request.wire, response);
    } catch (error) {
      const classification = classifyRouteError(error, request.signal?.aborted);
      const usage = errorUsage(error);
      if (attempt) {
        if (classification.reason === 'cancelled') await attempt.releaseCancelled();
        else await attempt.recordOutcome(classification, attemptUsage(usage));
      }
      attempts.push({
        candidateRef, providerId: diagnostic.actualProviderId,
        modelId: diagnostic.actualModelId,
        transportProviderId: diagnostic.actualTransportProviderId,
        outcome: classification.reason, usage,
      });
      const hasNext = index + 1 < prepared.plan.candidateRefs.length;
      if (classification.retryable && hasNext) continue;
      const outcome = classification.reason === 'cancelled' ? 'cancelled' : 'failed';
      await deps.metering.settleRoute({
        cost: prepared.cost, wire: request.wire, requestedModel: request.model,
        outcome, usage: aggregateUsage(attempts), attempts,
      });
      throw new GatewayError('pooled-account-unavailable', 'all planned routes failed');
    }
  }
  throw new GatewayError('no-eligible-account', 'route plan has no candidates');
};
