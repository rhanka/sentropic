import type { GenerateResponse, NativeMessagesRequest, PreparedRouteAttempt, RouteAttemptUsage } from '@sentropic/llm-mesh';
import { estimateAnthropicInputTokens } from './canonical-stream.js';
import { encodeGatewayResponse, type CanonicalGatewayResponse } from './canonical-egress.js';
import type { GatewayFlowRequest, ResolvedTarget, SettleUsage } from './flow.js';
import {
  attemptUsage, classifyRouteError, prepareRouteFlow, refuseNativeAttempt, refuseUnmarkedDispatch, routeUsage,
  settleRouteRequest, terminalGatewayError, retainRouteBody, type RouteAttemptSettlement, type RouteFlowDeps,
} from './route-flow-core.js';
import { BudgetDispatchMarkError, markRouteDispatched } from './admission.js';
import { GatewayError, gatewayRequestTooLargeError } from './router/errors.js';
import { RouteAttemptDispatch } from './route-attempt-dispatch.js';
import { dispatchNativeMessages } from './route-attempt-dispatch.js';
import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';
import { assertNativeMessagesResult, buildNativeMessagesRequest, NativeAttemptRefusal, nativeResponseReader, prepareNativeMessages } from './route-native.js';
import { nativeDefaultTtlEligible, NativeUsageObserver, nativeSnapshotUsage } from './native-usage.js';
import { nativeLifecycle } from './native-lifecycle.js';
const defaultDispatch = new RouteAttemptDispatch();

const errorUsage = (error: unknown, fallback: SettleUsage): SettleUsage => {
  if (!error || typeof error !== 'object') return fallback;
  const usage = (error as { usage?: RouteAttemptUsage }).usage;
  return usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimated: usage.estimated } : fallback;
};

export interface RouteGatewayJsonResult extends CanonicalGatewayResponse {
  readonly servedTarget: ResolvedTarget;
  readonly relay?: 'native';
  readonly nativeServedModelId?: string;
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
  retainRouteBody(prepared, request);
  const attempts: RouteAttemptSettlement[] = [];
  const signal = request.signal ?? request.authContext.signal;
  const estimate = (output = ''): SettleUsage => ({
    inputTokens: Math.min(1_000_000, estimateAnthropicInputTokens(prepared.canonical.request)),
    outputTokens: Math.min(1_000_000, Math.ceil(output.length / 4)), estimated: true,
  });
  let settled = false;
  let nativeInvoked = false;
  const settle = async (outcome: 'success' | 'failed' | 'cancelled') => {
    if (settled) return;
    settled = true;
    await settleRouteRequest(deps, prepared, request, outcome, attempts);
  };
  for (let index = 0; index < prepared.plan.candidateRefs.length; index += 1) {
    const candidateRef = prepared.plan.candidateRefs[index]!;
    const diagnostic = prepared.plan.diagnostics[index]!;
    let attempt: PreparedRouteAttempt | undefined;
    let response: GenerateResponse | undefined;
    let encoded: CanonicalGatewayResponse;
    let invoked = false;
    let observedUsage: SettleUsage | undefined;
    let nativeObserver: NativeUsageObserver | undefined;
    let lifecycle: ReturnType<typeof nativeLifecycle> | undefined;
    let nativeReader: ReturnType<typeof nativeResponseReader>;
    let nativeServedModelId: string | undefined;
    try {
      signal?.throwIfAborted();
      attempt = await deps.routePlanner.prepareAttempt(
        prepared.subject, prepared.plan.planRef, candidateRef, prepared.cost.correlationId, index,
      );
      signal?.throwIfAborted();
      const native = prepareNativeMessages(prepared.nativeFeatures, attempt, servedTargetFor(diagnostic));
      if (nativeInvoked && !native) throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
      signal?.throwIfAborted();
      await markRouteDispatched(deps.budget, prepared.admission, candidateRef, index);
      invoked = true;
      if (native) {
        let nativeRequest: NativeMessagesRequest | undefined = buildNativeMessagesRequest(prepared, request, native, signal ?? new AbortController().signal);
        nativeObserver = new NativeUsageObserver(diagnostic.actualModelId, nativeDefaultTtlEligible(nativeRequest.body));
        lifecycle = nativeLifecycle(nativeObserver, nativeRequest.finalize,
          { requestId: nativeRequest.requestId, attemptRef: attempt.attemptRef });
        nativeInvoked = true;
        const result = await dispatchNativeMessages(deps.dispatch, { capability: native.capability, request: nativeRequest });
        nativeRequest = undefined;
        nativeReader = nativeResponseReader(result);
        assertNativeMessagesResult(result, 'json');
        if (result.kind !== 'json') throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
        nativeObserver.observeJson(result.body);
        signal?.throwIfAborted();
        const snapshot = lifecycle.finish('completed');
        observedUsage = nativeSnapshotUsage(snapshot);
        if (!snapshot.fallbackPresent && !snapshot.iterationsPresent) nativeServedModelId = snapshot.nativeServedModelId;
        encoded = result;
      } else {
        response = await (deps.dispatch ?? defaultDispatch).generate({ attempt, request: {
          ...prepared.canonical.request, ...(signal ? { signal } : {}),
        } });
        if (response.usage) observedUsage = routeUsage(response.usage);
        signal?.throwIfAborted();
        encoded = encodeGatewayResponse(request.wire, response);
      }
    } catch (error) {
      if (error instanceof BudgetDispatchMarkError) {
        throw await refuseUnmarkedDispatch(attempt, () => settle('failed'));
      }
      if (error instanceof NativeAttemptRefusal) {
        throw await refuseNativeAttempt(attempt, () => settle('failed'));
      }
      const classification = classifyRouteError(error, signal?.aborted);
      const termination = signal?.aborted ? 'cancelled' : error instanceof NativeMessagesUpstreamError
        && error.code === 'native_protocol_error' ? 'protocol_error'
        : error instanceof NativeMessagesUpstreamError && error.code === 'timeout' ? 'timeout' : 'upstream_error';
      const usage = lifecycle ? lifecycle.usage(termination)
        : errorUsage(error, observedUsage ?? (invoked ? estimate() : routeUsage()));
      if (nativeReader) {
        try { await nativeReader.return?.(); } catch { /* Preserve the claimed native contract refusal. */ }
      }
      attempts.push({
        candidateRef, providerId: diagnostic.actualProviderId,
        modelId: diagnostic.actualModelId,
        transportProviderId: diagnostic.actualTransportProviderId,
        outcome: classification.reason, usage,
      });
      const terminal = () => gatewayRequestTooLargeError(error, nativeObserver ? undefined : servedTargetFor(diagnostic))
        ?? (error instanceof NativeMessagesUpstreamError ? error
        : nativeObserver ? new NativeMessagesUpstreamError({ status: 503 }) : terminalGatewayError(
        classification, servedTargetFor(diagnostic), 'all planned routes failed', error,
      ));
      try {
        if (attempt) {
          if (classification.reason === 'cancelled') await attempt.releaseCancelled();
          else await attempt.recordOutcome(classification, attemptUsage(usage));
        }
      } catch {
        // A post-dispatch callback failure must never mask the terminal
        // refusal — the generic mapper would turn the callback error into
        // overloaded_error. Settle once (guarded), swallow, no retry. This
        // holds on the admitted path too: the host already observes its own
        // hook rejection, only the client-facing wire keeps the terminal.
        try {
          await settle(classification.reason === 'cancelled' ? 'cancelled' : 'failed');
        } catch { /* The terminal refusal wins. */ }
        throw terminal();
      }
      const hasNext = index + 1 < prepared.plan.candidateRefs.length;
      if (classification.retryable && hasNext) continue;
      const outcome = classification.reason === 'cancelled' ? 'cancelled' : 'failed';
      try {
        await settle(outcome);
      } catch {
        // Same preservation for the settlement sink: a ledger failure must
        // never replace the terminal refusal (admitted or not). One attempt,
        // swallowed, no retry.
      }
      // Terminal refusal keeps its upstream class (400/401/429) instead of
      // collapsing into pooled-account-unavailable (503).
      throw terminal();
    }
    const usage = observedUsage ?? estimate(response?.text);
    // A successful JSON operation cannot retry; its host upload/SDK references are now gone.
    request.bodyLease?.detach();
    attempts.push({ candidateRef, providerId: diagnostic.actualProviderId,
      modelId: diagnostic.actualModelId, transportProviderId: diagnostic.actualTransportProviderId,
      outcome: 'success', usage });
    // Operational and financial callbacks are outside provider retry handling.
    try { await attempt.complete(attemptUsage(usage)); }
    finally { await settle('success'); }
    return { ...encoded, servedTarget: servedTargetFor(diagnostic),
      ...(nativeObserver ? { relay: 'native', nativeServedModelId } : {}) };
  }
  try {
    await settle('failed');
  } catch {
    // A sink failure must never mask the Q7 no-route refusal (same
    // preservation as the planning-refusal path in route-flow-core).
  }
  throw new GatewayError('no-route', 'route plan has no candidates');
};
