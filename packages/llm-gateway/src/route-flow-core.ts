import type {
  PreparedRouteAttempt, RouteAttemptUsage, RouteFailureClassification, RoutePlan, RoutePlanInput,
  RoutePlanner, VerifiedRoutingSubject,
} from '@sentropic/llm-mesh';
import type { GatewayConfig } from './config.js';
import { normalizeGatewayIngress, type CanonicalIngressResult } from './canonical-ingress.js';
import { classifyNativeFeatures, type NativeFeatureSelection } from './native-features.js';
import { requestTooLargeDetail } from '@sentropic/llm-mesh';
import { gatewayRequestTooLargeError } from './router/errors.js';
import type { GatewayFlowRequest, ResolvedTarget, SettleUsage } from './flow.js';
import type { CostContext } from './ports/cost-context.js';
import { GatewayError } from './router/errors.js';
import { isRoutePlanError, isRouteQuoteError } from './internal/mesh-routing-error.js';
import { authenticateCaller } from './internal/caller-auth.js';
import type { RouteAttemptDispatchPort } from './ports/dispatch.js';
import type { GatewayBudgetOptions, RouteBudgetOverrun } from './ports/budget.js';
import {
  admitRoute, assertBudgetRouteDeps, boundRouteOutputCeiling, chargeAdmittedAttempts, type AdmittedRoute,
} from './admission.js';

export interface RouteAttemptSettlement {
  readonly candidateRef: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId: string;
  readonly outcome: RouteFailureClassification['reason'];
  readonly usage: SettleUsage;
}

export interface RouteRequestSettlement {
  readonly cost: CostContext;
  readonly wire: GatewayFlowRequest['wire'];
  readonly requestedModel: string;
  readonly outcome: 'success' | 'failed' | 'cancelled';
  readonly usage: SettleUsage;
  readonly attempts: readonly RouteAttemptSettlement[];
  /** Budget admission only: server request id, the settlement idempotency key. */
  readonly requestId?: string;
  /** Budget admission only: hold settled (debited and released) by this aggregate. */
  readonly holdRef?: string;
  /** Budget admission only: the in-process quote the hold was priced from. */
  readonly quoteRef?: string;
  /** Budget admission only: dispatched attempts whose usage exceeded their allowance. */
  readonly overrun?: readonly RouteBudgetOverrun[];
}

export interface RouteMeteringSink {
  settleRoute(context: RouteRequestSettlement): Promise<void> | void;
}

export interface RouteFlowDeps {
  readonly dispatch?: RouteAttemptDispatchPort;
  readonly config: GatewayConfig;
  readonly routePlanner: RoutePlanner;
  readonly metering: RouteMeteringSink;
  readonly routeInput?: (input: {
    readonly cost: CostContext;
    readonly request: GatewayFlowRequest;
    readonly canonical: CanonicalIngressResult;
  }) => Omit<RoutePlanInput, 'requestedModel' | 'requiredCapabilities' | 'nativeMessages'>;
  /** Opt-in budget admission; absent means no quote and no reservation. */
  readonly budget?: GatewayBudgetOptions;
  readonly nativeMessagesEnabled?: boolean;
}

export interface PreparedRouteFlow {
  readonly cost: CostContext;
  readonly subject: VerifiedRoutingSubject;
  canonical: CanonicalIngressResult;
  readonly plan: RoutePlan;
  readonly nativeFeatures: NativeFeatureSelection;
  /** Present only when budget admission admitted the request. */
  readonly admission?: AdmittedRoute;
}

/** Retry projection is detached only when native upload/commit or terminal SDK cleanup permits it. */
export const retainRouteBody = (prepared: PreparedRouteFlow, request: GatewayFlowRequest): void => {
  request.bodyLease?.trackDetach(() => {
    prepared.canonical = { request: { model: prepared.canonical.request.model, messages: [] }, requiredCapabilities: [] };
  });
};

export const routingSubjectForCost = (cost: CostContext): VerifiedRoutingSubject => ({
  principalRef: cost.principalId,
  ownerScopeRef: cost.ownerScopeRef ?? `${cost.tenantId}:${cost.principalId}`,
});

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? value as Record<string, unknown> : undefined;

const isEnrollmentDiagnostic = (error: unknown): boolean => {
  const diagnostic = asRecord(error)?.diagnostic;
  const code = asRecord(diagnostic)?.code;
  return code === 'reenrollment-required' || code === 'reauth-required';
};

/**
 * Recognized non-budget planning refusals (Lot 1 404, 400, Q7/enrollment
 * 503). A rejecting zero-dispatch notification must never replace one of
 * these: the generic mapper would turn the sink error into overloaded_error.
 */
const isRecognizedPlanningRefusal = (error: unknown): boolean => {
  if (error instanceof GatewayError) {
    return error.kind === 'unknown-model' || error.kind === 'no-route' || error.kind === 'native-unavailable';
  }
  return isEnrollmentDiagnostic(error)
    || isRoutePlanError(error, 'unknown-model') || isRouteQuoteError(error, 'unknown-model')
    || isRoutePlanError(error, 'native-unavailable') || isRouteQuoteError(error, 'native-unavailable')
    || isRoutePlanError(error, 'capabilities-unmet') || isRouteQuoteError(error, 'capabilities-unmet')
    || isRoutePlanError(error, 'no-route') || isRouteQuoteError(error, 'no-route');
};

export const prepareRouteFlow = async (
  deps: RouteFlowDeps,
  request: GatewayFlowRequest,
): Promise<PreparedRouteFlow> => {
  if (deps.config.mode === 'cross-user-pool' && !deps.config.crossUserPoolEnabled) {
    throw new GatewayError('cross-user-disabled', 'cross-user pooling is disabled');
  }
  const auth = await authenticateCaller(deps.config.callerAuth, request.headers, request.authContext);
  request.signal?.throwIfAborted();
  if (!auth.ok || !auth.cost) {
    throw new GatewayError('caller-auth-failed', auth.reason ?? 'caller-auth failed');
  }
  const canonical = normalizeGatewayIngress(request.wire, request.body);
  const nativeFeatures = classifyNativeFeatures(request.wire, request.headers, request.body, canonical, {
    budget: deps.budget, nativeMessagesEnabled: deps.nativeMessagesEnabled,
  });
  const subject = routingSubjectForCost(auth.cost);
  if (deps.budget) {
    // The reserved output ceiling is the one sent to every attempt (both wires, both flows).
    const bounded = boundRouteOutputCeiling(canonical, deps.budget);
    return prepareAdmittedRouteFlow(deps, request, auth.cost, subject, bounded, nativeFeatures);
  }
  try {
    const routeInput = deps.routeInput?.({ cost: auth.cost, request, canonical });
    const plan = await deps.routePlanner.plan(subject, {
      ...routeInput,
      requestedModel: request.model,
      requiredCapabilities: canonical.requiredCapabilities,
      workspaceId: routeInput?.workspaceId ?? auth.cost.workspaceId,
      affinityKey: routeInput?.affinityKey ?? auth.cost.correlationId,
      ...(nativeFeatures.kind === 'required' ? { nativeMessages: true } : { nativeMessages: undefined }),
    });
    return { cost: auth.cost, subject, canonical, plan, nativeFeatures };
  } catch (error) {
    if (isRecognizedPlanningRefusal(error)) {
      try {
        await deps.metering.settleRoute({
          cost: auth.cost,
          wire: request.wire,
          requestedModel: request.model,
          outcome: 'failed',
          usage: { inputTokens: 0, outputTokens: 0, estimated: true },
          attempts: [],
        });
      } catch { /* The original recognized refusal wins. */ }
      throw error;
    }
    await deps.metering.settleRoute({
      cost: auth.cost,
      wire: request.wire,
      requestedModel: request.model,
      outcome: 'failed',
      usage: { inputTokens: 0, outputTokens: 0, estimated: true },
      attempts: [],
    });
    throw error;
  }
};

const prepareAdmittedRouteFlow = async (
  deps: RouteFlowDeps,
  request: GatewayFlowRequest,
  cost: CostContext,
  subject: VerifiedRoutingSubject,
  canonical: CanonicalIngressResult,
  nativeFeatures: NativeFeatureSelection,
): Promise<PreparedRouteFlow> => {
  assertBudgetRouteDeps(deps.routePlanner, true, deps.budget);
  const routeInput = deps.routeInput?.({ cost, request, canonical });
  const admission = await admitRoute({
    budget: deps.budget!, routePlanner: deps.routePlanner,
    requestId: request.authContext.requestId, cost, wire: request.wire,
    requestedModel: request.model, canonical,
    route: {
      ...(routeInput?.targetCandidatesOverride ? { targetCandidatesOverride: routeInput.targetCandidatesOverride } : {}),
      ...(routeInput?.intent ? { intent: routeInput.intent } : {}),
      ...(routeInput?.policyProfile ? { policyProfile: routeInput.policyProfile } : {}),
      ...(routeInput?.policyOverride ? { policyOverride: routeInput.policyOverride } : {}),
      ...(routeInput?.explicit ? { explicit: routeInput.explicit } : {}),
      ...(nativeFeatures.kind === 'required' ? { nativeMessages: true } : {}),
    },
  });
  try {
    const plan = await deps.routePlanner.plan(subject, {
      ...routeInput,
      requestedModel: request.model,
      requiredCapabilities: canonical.requiredCapabilities,
      workspaceId: routeInput?.workspaceId ?? cost.workspaceId,
      affinityKey: routeInput?.affinityKey ?? cost.correlationId,
      quote: admission.quote,
      ...(nativeFeatures.kind === 'required' ? { nativeMessages: true } : { nativeMessages: undefined }),
    });
    return { cost, subject, canonical, plan, admission, nativeFeatures };
  } catch (error) {
    // The admitted request's one zero-usage settlement, with hold release
    // (release-before-metering inside settleRouteRequest). A ledger failure
    // must never replace the typed refusal: attempt once, swallow, throw the
    // original. The host already observes its own ledger rejection.
    try {
      await settleRouteRequest(deps, { cost, admission }, request, 'failed', []);
    } catch { /* The typed refusal wins. */ }
    throw error;
  }
};

/**
 * The single aggregate settlement of a routed request. With budget admission
 * it releases the hold first when nothing was dispatched, charges missing
 * usage of dispatched attempts at their allowance and records overruns.
 */
export const settleRouteRequest = async (
  deps: RouteFlowDeps,
  prepared: Pick<PreparedRouteFlow, 'cost' | 'admission'>,
  request: GatewayFlowRequest,
  outcome: RouteRequestSettlement['outcome'],
  attempts: readonly RouteAttemptSettlement[],
): Promise<void> => {
  const { admission } = prepared;
  const base = { cost: prepared.cost, wire: request.wire, requestedModel: request.model, outcome };
  if (!admission || !deps.budget) {
    await deps.metering.settleRoute({ ...base, usage: aggregateUsage(attempts), attempts });
    return;
  }
  const charged = chargeAdmittedAttempts(admission, attempts);
  if (admission.dispatched.size === 0) {
    // A failed release never changes the response nor skips settlement: the
    // hold expires at its deadline and the host reconciles it by requestId.
    try { await deps.budget.port.release(admission.holdRef); } catch { /* settle below */ }
  }
  await deps.metering.settleRoute({
    ...base, usage: aggregateUsage(charged.attempts), attempts: charged.attempts,
    requestId: admission.requestId, holdRef: admission.holdRef, quoteRef: admission.quote.quoteRef,
    ...(charged.overrun.length > 0 ? { overrun: charged.overrun } : {}),
  });
};

/**
 * The dispatch marker failed: the provider was never called. Release the
 * prepared attempt without health penalty, settle once, sanitized 503.
 */
export const refuseUnmarkedDispatch = async (
  attempt: PreparedRouteAttempt | undefined,
  settle: () => Promise<void>,
): Promise<GatewayError> => {
  try { await attempt?.releaseCancelled(); } catch { /* The budget refusal wins. */ }
  await settle();
  return new GatewayError('budget-unavailable', 'budget dispatch marker unavailable');
};

/**
 * Required native capability unavailable: release attempt without health penalty,
 * settle once with failed outcome, return native-required refusal.
 */
export const refuseNativeAttempt = async (
  attempt: PreparedRouteAttempt | undefined,
  settle: () => Promise<void>,
): Promise<GatewayError> => {
  try { await attempt?.releaseCancelled(); } catch { /* The refusal wins. */ }
  try { await settle(); } catch { /* Rejected settlement never replaces the refusal. */ }
  return new GatewayError('native-required', 'native capability unavailable for required request');
};

export const classifyRouteError = (
  error: unknown,
  aborted = false,
): RouteFailureClassification => {
  if (aborted) return { reason: 'cancelled', retryable: false, healthScope: 'route' };
  if (requestTooLargeDetail(error)) return { reason: 'invalid-request', retryable: false, healthScope: 'route' };
  const record = asRecord(error);
  const status = typeof record?.statusCode === 'number' ? record.statusCode
    : typeof record?.status === 'number' ? record.status : undefined;
  const code = typeof record?.code === 'string' ? record.code.toLowerCase() : '';
  const retryAfterMs = typeof record?.retryAfterMs === 'number' ? record.retryAfterMs : undefined;
  if (code === 'native_protocol_error') return { reason: 'provider-5xx', retryable: false, healthScope: 'route' };
  if (status === 429 || code.includes('rate')) {
    return {
      reason: 'rate-limited', retryable: true, healthScope: 'provider-model',
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }
  if (status === 401 || status === 403 || code.includes('auth')) {
    return { reason: 'auth-failed', retryable: false, healthScope: 'account' };
  }
  if (status === 400) return { reason: 'invalid-request', retryable: false, healthScope: 'route' };
  // A pre-content provider failure event (e.g. Codex `response.failed`) has
  // no HTTP status: its code alone must still classify an invalid refusal
  // as invalid-request, never as provider-5xx. `invalid_api_key` is
  // deliberately excluded — without a 401 status it stays unclassified here.
  if (code.includes('invalid_request') || code === 'invalid-request' || code === 'bad_request') {
    return { reason: 'invalid-request', retryable: false, healthScope: 'route' };
  }
  // Mesh normalizes Anthropic `not_found_error` and OpenAI `model_not_found`
  // into `code`, so a status-less transport error with those codes is still an
  // unsupported model — never a provider-5xx.
  if (status === 404 || code.includes('unsupported_model')
    || code.includes('model_not_found') || code.includes('not_found')) {
    return { reason: 'unsupported-model', retryable: false, healthScope: 'provider-model' };
  }
  if ((status !== undefined && status >= 500) || code.includes('overload')) {
    return { reason: 'provider-5xx', retryable: true, healthScope: 'provider-model' };
  }
  if (code.includes('network') || code.includes('timeout') || error instanceof TypeError) {
    return { reason: 'network-unavailable', retryable: true, healthScope: 'transport' };
  }
  return { reason: 'provider-5xx', retryable: false, healthScope: 'route' };
};

/**
 * Map a terminal (no more candidates) route classification to the public
 * GatewayError. A terminal upstream invalid refusal is the caller's request,
 * not pool exhaustion: it surfaces as bad-request (400). A terminal upstream
 * unsupported-model becomes the Lot 1 unknown-model 404 with the fixed
 * internal detail; the served target is preserved so the router keeps the
 * `X-Sentropic-Served` actual-model header. Terminal upstream auth/quota
 * refusals keep their class (401/429 + Retry-After) instead of collapsing
 * into pooled-account-unavailable (503). Only genuine unavailability falls
 * back to the pooled 503.
 */
export const terminalGatewayError = (
  classification: RouteFailureClassification,
  target: ResolvedTarget,
  fallbackMessage: string,
  originalError?: unknown,
): GatewayError => {
  const tooLarge = gatewayRequestTooLargeError(originalError, target);
  if (classification.reason !== 'cancelled' && tooLarge) return tooLarge;
  if (classification.reason === 'invalid-request') {
    return new GatewayError(
      'bad-request', 'upstream refused the request as invalid', undefined, target,
    );
  }
  if (classification.reason === 'unsupported-model') {
    return new GatewayError('unknown-model', 'unknown model', undefined, target);
  }
  if (classification.reason === 'auth-failed') {
    return new GatewayError(
      'upstream-auth-failed', 'upstream account authentication failed', undefined, target,
    );
  }
  if (classification.reason === 'rate-limited') {
    return new GatewayError(
      'upstream-rate-limited', 'upstream rate limit exceeded',
      classification.retryAfterMs !== undefined ? classification.retryAfterMs / 1000 : undefined,
      target,
    );
  }
  return new GatewayError('pooled-account-unavailable', fallbackMessage, undefined, target);
};

export const routeUsage = (usage?: {
  readonly inputTokens?: number; readonly outputTokens?: number;
}): SettleUsage => ({
  inputTokens: usage?.inputTokens ?? 0,
  outputTokens: usage?.outputTokens ?? 0,
  estimated: !usage,
});

export const attemptUsage = (usage: SettleUsage): RouteAttemptUsage => usage;

export const aggregateUsage = (attempts: readonly RouteAttemptSettlement[]): SettleUsage => ({
  inputTokens: attempts.reduce((total, attempt) => total + attempt.usage.inputTokens, 0),
  outputTokens: attempts.reduce((total, attempt) => total + attempt.usage.outputTokens, 0),
  estimated: attempts.some((attempt) => attempt.usage.estimated),
});
