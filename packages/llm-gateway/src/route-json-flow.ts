import type { GenerateResponse, PreparedRouteAttempt, RouteAttemptUsage } from '@sentropic/llm-mesh';
import { estimateAnthropicInputTokens } from './canonical-stream.js';
import { encodeGatewayResponse, type CanonicalGatewayResponse } from './canonical-egress.js';
import type { GatewayFlowRequest, ResolvedTarget, SettleUsage } from './flow.js';
import {
  aggregateUsage, attemptUsage, classifyRouteError, prepareRouteFlow, routeUsage, terminalGatewayError,
  type RouteAttemptSettlement, type RouteFlowDeps,
} from './route-flow-core.js';
import { GatewayError } from './router/errors.js';
import { RouteAttemptDispatch } from './route-attempt-dispatch.js';
const defaultDispatch = new RouteAttemptDispatch();

const errorUsage = (error: unknown, fallback: SettleUsage): SettleUsage => {
  if (!error || typeof error !== 'object') return fallback;
  const usage = (error as { usage?: RouteAttemptUsage }).usage;
  return usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimated: usage.estimated } : fallback;
};

export interface RouteGatewayJsonResult extends CanonicalGatewayResponse {
  readonly servedTarget: ResolvedTarget;
}

const servedTargetFor = (diagnostic: {
  readonly actualProviderId: string;
  readonly actualTransportProviderId: string;
  readonly actualModelId: string;
}): ResolvedTarget => ({
  providerId: diagnostic.actualProviderId,
  transportProviderId: diagnostic.actualTransportProviderId,
  model: diagnostic.actualModelId,
});

export const runRouteJsonFlow = async (
  deps: RouteFlowDeps,
  request: GatewayFlowRequest,
): Promise<RouteGatewayJsonResult> => {
  const prepared = await prepareRouteFlow(deps, request);
  const attempts: RouteAttemptSettlement[] = [];
  const signal = request.signal ?? request.authContext.signal;
  const estimate = (output = ''): SettleUsage => ({
    inputTokens: Math.min(1_000_000, estimateAnthropicInputTokens(prepared.canonical.request)),
    outputTokens: Math.min(1_000_000, Math.ceil(output.length / 4)), estimated: true,
  });
  const settle = (outcome: 'success' | 'failed' | 'cancelled') => deps.metering.settleRoute({
    cost: prepared.cost, wire: request.wire, requestedModel: request.model,
    outcome, usage: aggregateUsage(attempts), attempts,
  });
  for (let index = 0; index < prepared.plan.candidateRefs.length; index += 1) {
    const candidateRef = prepared.plan.candidateRefs[index]!;
    const diagnostic = prepared.plan.diagnostics[index]!;
    let attempt: PreparedRouteAttempt | undefined;
    let response: GenerateResponse;
    let encoded: CanonicalGatewayResponse;
    let invoked = false;
    let observedUsage: SettleUsage | undefined;
    try {
      signal?.throwIfAborted();
      attempt = await deps.routePlanner.prepareAttempt(
        prepared.subject, prepared.plan.planRef, candidateRef, prepared.cost.correlationId, index,
      );
      signal?.throwIfAborted();
      invoked = true;
      response = await (deps.dispatch ?? defaultDispatch).generate({ attempt, request: {
        ...prepared.canonical.request,
        ...(signal ? { signal } : {}),
      } });
      if (response.usage) observedUsage = routeUsage(response.usage);
      signal?.throwIfAborted();
      encoded = encodeGatewayResponse(request.wire, response);
    } catch (error) {
      const classification = classifyRouteError(error, signal?.aborted);
      const usage = errorUsage(error, observedUsage ?? (invoked ? estimate() : routeUsage()));
      attempts.push({
        candidateRef, providerId: diagnostic.actualProviderId,
        modelId: diagnostic.actualModelId,
        transportProviderId: diagnostic.actualTransportProviderId,
        outcome: classification.reason, usage,
      });
      try {
        if (attempt) {
          if (classification.reason === 'cancelled') await attempt.releaseCancelled();
          else await attempt.recordOutcome(classification, attemptUsage(usage));
        }
      } catch (hookError) {
        await settle(classification.reason === 'cancelled' ? 'cancelled' : 'failed');
        throw hookError;
      }
      const hasNext = index + 1 < prepared.plan.candidateRefs.length;
      if (classification.retryable && hasNext) continue;
      const outcome = classification.reason === 'cancelled' ? 'cancelled' : 'failed';
      await settle(outcome);
      // Terminal refusal keeps its upstream class (400/401/429) instead of
      // collapsing into pooled-account-unavailable (503).
      throw terminalGatewayError(
        classification, servedTargetFor(diagnostic), 'all planned routes failed',
      );
    }
    const usage = response.usage ? routeUsage(response.usage) : estimate(response.text);
    attempts.push({ candidateRef, providerId: diagnostic.actualProviderId,
      modelId: diagnostic.actualModelId, transportProviderId: diagnostic.actualTransportProviderId,
      outcome: 'success', usage });
    // Operational and financial callbacks are outside provider retry handling.
    try { await attempt.complete(attemptUsage(usage)); }
    finally { await settle('success'); }
    return { ...encoded, servedTarget: servedTargetFor(diagnostic) };
  }
  await settle('failed');
  throw new GatewayError('no-eligible-account', 'route plan has no candidates');
};
