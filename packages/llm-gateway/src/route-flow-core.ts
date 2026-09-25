import type {
  PreparedRouteAttempt, RouteAttemptUsage, RouteFailureClassification, RoutePlan, RoutePlanInput,
  RoutePlanner, VerifiedRoutingSubject,
} from '@sentropic/llm-mesh';
import type { GatewayConfig } from './config.js';
import { normalizeGatewayIngress, type CanonicalIngressResult } from './canonical-ingress.js';
import type { GatewayFlowRequest, ResolvedTarget, SettleUsage } from './flow.js';
import type { CostContext } from './ports/cost-context.js';
import { GatewayError } from './router/errors.js';
import { authenticateCaller } from './internal/caller-auth.js';
import type { RouteAttemptDispatchPort } from './ports/dispatch.js';
import type { GatewayBudgetOptions, RouteBudgetOverrun } from './ports/budget.js';
import { admitRoute, assertBudgetRouteDeps, chargeAdmittedAttempts, type AdmittedRoute } from './admission.js';

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
  }) => Omit<RoutePlanInput, 'requestedModel' | 'requiredCapabilities'>;
  /** Opt-in budget admission; absent means no quote and no reservation. */
  readonly budget?: GatewayBudgetOptions;
}

export interface PreparedRouteFlow {
  readonly cost: CostContext;
  readonly subject: VerifiedRoutingSubject;
  readonly canonical: CanonicalIngressResult;
  readonly plan: RoutePlan;
  /** Present only when budget admission admitted the request. */
  readonly admission?: AdmittedRoute;
}

export const routingSubjectForCost = (cost: CostContext): VerifiedRoutingSubject => ({
  principalRef: cost.principalId,
  ownerScopeRef: cost.ownerScopeRef ?? `${cost.tenantId}:${cost.principalId}`,
});

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? value as Record<string, unknown> : undefined;

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
  const subject = routingSubjectForCost(auth.cost);
  if (deps.budget) return prepareAdmittedRouteFlow(deps, request, auth.cost, subject, canonical);
  try {
    const routeInput = deps.routeInput?.({ cost: auth.cost, request, canonical });
    const plan = await deps.routePlanner.plan(subject, {
      ...routeInput,
      requestedModel: request.model,
      requiredCapabilities: canonical.requiredCapabilities,
      workspaceId: routeInput?.workspaceId ?? auth.cost.workspaceId,
      affinityKey: routeInput?.affinityKey ?? auth.cost.correlationId,
    });
    return { cost: auth.cost, subject, canonical, plan };
  } catch (error) {
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
    });
    return { cost, subject, canonical, plan, admission };
  } catch (error) {
    // The admitted request's one zero-usage settlement, with hold release.
    await settleRouteRequest(deps, { cost, admission }, request, 'failed', []);
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
  try {
    if (admission.dispatched.size === 0) await deps.budget.port.release(admission.holdRef);
  } finally {
    await deps.metering.settleRoute({
      ...base, usage: aggregateUsage(charged.attempts), attempts: charged.attempts,
      requestId: admission.requestId, holdRef: admission.holdRef, quoteRef: admission.quote.quoteRef,
      ...(charged.overrun.length > 0 ? { overrun: charged.overrun } : {}),
    });
  }
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

export const classifyRouteError = (
  error: unknown,
  aborted = false,
): RouteFailureClassification => {
  if (aborted) return { reason: 'cancelled', retryable: false, healthScope: 'route' };
  const record = asRecord(error);
  const status = typeof record?.statusCode === 'number' ? record.statusCode
    : typeof record?.status === 'number' ? record.status : undefined;
  const code = typeof record?.code === 'string' ? record.code.toLowerCase() : '';
  const retryAfterMs = typeof record?.retryAfterMs === 'number' ? record.retryAfterMs : undefined;
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
  if (status === 404 || code.includes('unsupported_model')) {
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
 * not pool exhaustion: it surfaces as bad-request (400). Terminal upstream
 * auth/quota refusals keep their class (401/429 + Retry-After) instead of
 * collapsing into pooled-account-unavailable (503). Only genuine
 * unavailability falls back to the pooled 503.
 */
export const terminalGatewayError = (
  classification: RouteFailureClassification,
  target: ResolvedTarget,
  fallbackMessage: string,
): GatewayError => {
  if (classification.reason === 'invalid-request') {
    return new GatewayError(
      'bad-request', 'upstream refused the request as invalid', undefined, target,
    );
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
