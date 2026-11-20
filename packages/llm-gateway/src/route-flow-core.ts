import type {
  PreparedRouteAttempt, RouteAttemptUsage, RouteFailureClassification, RoutePlan, RoutePlanInput,
  RoutePlanner, VerifiedRoutingSubject,
} from '@sentropic/llm-mesh';
import { requestTooLargeDetail } from '@sentropic/llm-mesh';
import type { GatewayConfig } from './config.js';
import { normalizeGatewayIngress, type CanonicalIngressResult } from './canonical-ingress.js';
import { classifyNativeFeatures, type NativeFeatureSelection } from './native-features.js';
import type { GatewayFlowRequest, ResolvedTarget, SettleUsage } from './flow.js';
import type { CostContext } from './ports/cost-context.js';
import { GatewayError, gatewayRequestTooLargeError } from './router/errors.js';
import { ResponsesBoundError } from './responses-egress.js';
import { isRoutePlanError, isRouteQuoteError } from './internal/mesh-routing-error.js';
import { authenticateCaller } from './internal/caller-auth.js';
import type { RouteAttemptDispatchPort } from './ports/dispatch.js';
import type { GatewayBudgetOptions, RouteBudgetOverrun } from './ports/budget.js';
import {
  admitRoute, assertBudgetRouteDeps, boundRouteOutputCeiling, chargeAdmittedAttempts, type AdmittedRoute,
} from './admission.js';
import type { StageRewritePort, StageRewriteTrace } from './rewrite/stage-rewrite.js';
import type { GuardPort, GuardVerdict, MaskedCapturePayload } from './ports/guards.js';
import type { GuardedTurnCaptureRecord } from './guards/sse-guard-tee.js';
import type { ReceiptIntegrity } from './ports/gateway-state.js';
import {
  captureCanonicalProtectedProjection, captureProtectedIdentification,
  type CanonicalProtectedSnapshot, type ProtectedIdentificationSnapshot,
} from './guards/protected-identification.js';

export interface RequestAuditRefuseDetail {
  readonly integrity?: ReceiptIntegrity;
  readonly reason?: string;
}

export interface RouteAttemptSettlement {
  readonly reportedUsage?: boolean;
  readonly observedServedModel?: string;
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
  readonly requestAudit?: {
    admit(input: {
      cost: CostContext; requestId: string; model: string;
      originModel?: string; stageRewrites?: readonly StageRewriteTrace[]; guardVerdict?: GuardVerdict;
    }): Promise<{ receiptId: string }>;
    refuse?(receiptId: string, detail?: RequestAuditRefuseDetail): Promise<void>;
    beginAttempt?(input: { cost: CostContext; attemptRef: string; diagnostic: RoutePlan['diagnostics'][number] }): Promise<void>;
  };
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
  /** Trusted construction-time switch; absent hosts rely on capability gates. */
  readonly nativeMessagesEnabled?: boolean;
  /** Optional catalog-validated single-step stage rewrite port (D4 B, L1.2). */
  readonly stageRewrite?: StageRewritePort;
  /** Optional decoded-JSON PII + technical-secret guard (D6a/D6d, L1.3b). */
  readonly guard?: GuardPort;
  /** Body capture persistence flag — strictly OFF (`false`) by default. */
  readonly captureEnabled?: boolean;
  /** Masked turn capture sink — invoked only when `captureEnabled === true`. */
  readonly onCapture?: (record: GuardedTurnCaptureRecord) => Promise<void> | void;
}

export interface PreparedRouteFlow {
  readonly cost: CostContext;
  readonly subject: VerifiedRoutingSubject;
  canonical: CanonicalIngressResult;
  readonly plan: RoutePlan;
  readonly nativeFeatures: NativeFeatureSelection;
  /** Present only when budget admission admitted the request. */
  readonly admission?: AdmittedRoute;
  readonly originModel?: string;
  readonly stageRewrites?: readonly StageRewriteTrace[];
  readonly guardVerdict?: GuardVerdict;
  readonly requestCapture?: MaskedCapturePayload;
  readonly effectiveBody?: unknown;
  readonly protectedIngress: ProtectedIdentificationSnapshot;
  readonly canonicalProtectedIngress: CanonicalProtectedSnapshot;
}
export class RequestAuditError extends Error {}
export const markDurableAttempt = async (deps: RouteFlowDeps, cost: CostContext,
  attemptRef: string, diagnostic: RoutePlan['diagnostics'][number]): Promise<void> => {
  try { await deps.requestAudit?.beginAttempt?.({ cost, attemptRef, diagnostic }); }
  catch { throw new RequestAuditError('durable attempt acknowledgement unavailable'); }
};

/** Retry projection is detached only when upload/commit or terminal SDK cleanup permits it. */
export const retainRouteBody = (prepared: PreparedRouteFlow, request: GatewayFlowRequest): void => {
  request.bodyLease?.trackDetach(() => {
    const { providerId, modelId } = prepared.canonical.request;
    prepared.canonical = { request: { messages: [],
      ...(providerId ? { providerId } : {}), ...(modelId ? { modelId } : {}) }, requiredCapabilities: [] };
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
  const protectedIngress = captureProtectedIdentification(request.wire, request.body, request.headers);
  let canonical = normalizeGatewayIngress(request.wire, request.body, request.responsesLimits);
  const canonicalProtectedIngress = captureCanonicalProtectedProjection(request.wire, canonical.request);
  let cost = auth.cost;
  const subject = routingSubjectForCost(cost);
  // Pre-rewrite contract validation runs on the caller's original (originModel, originEffort).
  let precheckedRouteInput: ReturnType<NonNullable<RouteFlowDeps['routeInput']>> | undefined;
  let effectiveModel = request.model;
  let effectiveBody = request.body;
  let originModel: string | undefined;
  let stageRewrites: readonly StageRewriteTrace[] | undefined;
  if (deps.stageRewrite) {
    precheckedRouteInput = deps.routeInput?.({ cost, request, canonical });
    const rewritten = deps.stageRewrite.rewrite({
      wire: request.wire, body: request.body, model: request.model,
      effort: canonical.request.reasoning?.effort, stageRewriteCount: 0,
    });
    if (rewritten.rewritten && rewritten.trace) {
      originModel = rewritten.originModel;
      stageRewrites = [rewritten.trace];
      effectiveModel = rewritten.model;
      effectiveBody = rewritten.body;
      canonical = normalizeGatewayIngress(request.wire, effectiveBody, request.responsesLimits);
      if (precheckedRouteInput?.launchRoutingContract
        && !precheckedRouteInput.launchRoutingContract.exactModels.includes(effectiveModel)) {
        const c = precheckedRouteInput.launchRoutingContract;
        precheckedRouteInput = {
          ...precheckedRouteInput,
          launchRoutingContract: { ...c, exactModels: [...c.exactModels, effectiveModel] },
        };
      }
    }
  }
  let guardVerdict: GuardVerdict | undefined;
  let requestCapture: MaskedCapturePayload | undefined;
  if (deps.guard) {
    const scan = deps.guard.inspectRequest(effectiveBody);
    guardVerdict = scan.verdict;
    if (scan.verdict === 'blocked') {
      if (deps.requestAudit) {
        try {
          if (!request.receiptId) {
            const receipt = await deps.requestAudit.admit({
              cost: auth.cost, requestId: request.authContext.requestId, model: effectiveModel,
              ...(originModel ? { originModel } : {}),
              ...(stageRewrites ? { stageRewrites } : {}),
              guardVerdict,
            });
            request.receiptId = receipt.receiptId;
          }
          if (!request.receiptRefused) {
            request.receiptRefused = true;
            await deps.requestAudit.refuse?.(request.receiptId, {
              ...(scan.protectedViolation ? { integrity: 'protected_identification_violation' as const } : {}),
              reason: scan.protectedViolation ? 'guard-mask-in-flight-protected-set' : 'guard-blocked',
            });
          }
        } catch { /* Refusal audit sink errors never mask the 400 refusal. */ }
      }
      throw new GatewayError('guard-blocked', 'request blocked by gateway guard policy');
    }
    if (scan.inFlightPayload !== effectiveBody) {
      effectiveBody = scan.inFlightPayload;
      canonical = normalizeGatewayIngress(request.wire, effectiveBody, request.responsesLimits);
    }
    if (deps.captureEnabled === true) requestCapture = scan.maskedCapture;
  }
  const nativeFeatures = classifyNativeFeatures(request.wire, request.headers, effectiveBody, canonical, {
    budget: deps.budget, nativeMessagesEnabled: deps.nativeMessagesEnabled,
  });
  if (deps.requestAudit) {
    const receipt = await deps.requestAudit.admit({
      cost: auth.cost, requestId: request.authContext.requestId, model: effectiveModel,
      ...(originModel ? { originModel } : {}),
      ...(stageRewrites ? { stageRewrites } : {}),
      ...(guardVerdict ? { guardVerdict } : {}),
    });
    request.receiptId = receipt.receiptId;
    cost = { ...cost, gatewayReceiptId: receipt.receiptId };
  }
  const effectiveRequest = effectiveModel === request.model && effectiveBody === request.body ? request
    : { ...request, model: effectiveModel, body: effectiveBody };
  const bodyOverride = effectiveBody !== request.body ? { effectiveBody } : {};
  if (deps.budget) {
    // The reserved output ceiling is the one sent to every attempt (both wires, both flows).
    const bounded = boundRouteOutputCeiling(canonical, deps.budget);
    const admitted = await prepareAdmittedRouteFlow(
      deps, effectiveRequest, cost, subject, bounded, nativeFeatures, protectedIngress, canonicalProtectedIngress, precheckedRouteInput,
    );
    return {
      ...admitted,
      ...(originModel ? { originModel } : {}),
      ...(stageRewrites ? { stageRewrites } : {}),
      ...(guardVerdict ? { guardVerdict } : {}),
      ...(requestCapture ? { requestCapture } : {}),
      ...bodyOverride,
    };
  }
  try {
    const routeInput = precheckedRouteInput ?? deps.routeInput?.({ cost, request: effectiveRequest, canonical });
    const plan = await deps.routePlanner.plan(subject, {
      ...routeInput,
      requestedModel: effectiveModel,
      requiredCapabilities: canonical.requiredCapabilities,
      // Spec §16.3: forward codec-derived execution features — no gateway
      // table. Present for Messages/Chat only when tool controls require
      // them (R4-MAJ-4); the conditional spread keeps other plan inputs
      // byte-identical.
      ...(canonical.requiredExecutionFeatures
        ? { requiredExecutionFeatures: canonical.requiredExecutionFeatures } : {}),
      workspaceId: routeInput?.workspaceId ?? cost.workspaceId,
      affinityKey: routeInput?.affinityKey ?? cost.correlationId,
      ...(nativeFeatures.kind === 'required' ? { nativeMessages: true } : { nativeMessages: undefined }),
    });
    return {
      cost, subject, canonical, plan, nativeFeatures, protectedIngress, canonicalProtectedIngress,
      ...(originModel ? { originModel } : {}),
      ...(stageRewrites ? { stageRewrites } : {}),
      ...(guardVerdict ? { guardVerdict } : {}),
      ...(requestCapture ? { requestCapture } : {}),
      ...bodyOverride,
    };
  } catch (error) {
    if (isRecognizedPlanningRefusal(error)) {
      try {
        await deps.metering.settleRoute({
          cost,
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
      cost,
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
  protectedIngress: ProtectedIdentificationSnapshot,
  canonicalProtectedIngress: CanonicalProtectedSnapshot,
  precheckedRouteInput?: ReturnType<NonNullable<RouteFlowDeps['routeInput']>>,
): Promise<PreparedRouteFlow> => {
  assertBudgetRouteDeps(deps.routePlanner, true, deps.budget);
  const routeInput = precheckedRouteInput ?? deps.routeInput?.({ cost, request, canonical });
  const admission = await admitRoute({
    budget: deps.budget!, routePlanner: deps.routePlanner,
    requestId: request.authContext.requestId, cost, subject, wire: request.wire,
    requestedModel: request.model, canonical,
    route: {
      ...(routeInput?.launchRoutingContract ? { launchRoutingContract: routeInput.launchRoutingContract } : {}),
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
      ...(canonical.requiredExecutionFeatures
        ? { requiredExecutionFeatures: canonical.requiredExecutionFeatures } : {}),
      workspaceId: routeInput?.workspaceId ?? cost.workspaceId,
      affinityKey: routeInput?.affinityKey ?? cost.correlationId,
      quote: admission.quote,
      ...(nativeFeatures.kind === 'required' ? { nativeMessages: true } : { nativeMessages: undefined }),
    });
    return { cost, subject, canonical, plan, admission, nativeFeatures, protectedIngress, canonicalProtectedIngress };
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

/**
 * Egress Protected Identification invariant violation (L1.5, r8-F1): release attempt
 * without health penalty, record durable refusal audit receipt, settle failed
 * (releasing budget hold because dispatched.size === 0), and rethrow the 400 error.
 */
export const refuseProtectedIdentification = async (
  deps: RouteFlowDeps,
  attempt: PreparedRouteAttempt | undefined,
  request: GatewayFlowRequest,
  error: GatewayError,
  settle: () => Promise<void>,
): Promise<GatewayError> => {
  try { await attempt?.releaseCancelled(); } catch { /* The refusal wins. */ }
  if (request.receiptId && !request.receiptRefused) {
    request.receiptRefused = true;
    try {
      await deps.requestAudit?.refuse?.(request.receiptId, {
        integrity: 'protected_identification_violation',
        reason: error.message,
      });
    } catch { /* Retain pending evidence for recovery. */ }
  }
  try { await settle(); } catch { /* Rejected settlement never replaces the refusal. */ }
  return error;
};

export const classifyRouteError = (
  error: unknown,
  aborted = false,
): RouteFailureClassification => {
  if (aborted) return { reason: 'cancelled', retryable: false, healthScope: 'route' };
  // N02: terminal 413 classifies before auth/rate/overload; local size
  // failures never become provider-auth/rate evidence. Full pre-byte
  // mapping and propagation land in N09.
  if (requestTooLargeDetail(error)) return { reason: 'invalid-request', retryable: false, healthScope: 'route' };
  // R4-MIN-2: local Responses bound failures are neutral by construction —
  // non-retryable (the health layer records no suppression entry) and never
  // account-scoped (no auth/cooldown outcome). Pinned deliberately instead of
  // falling through to the generic default below.
  if (error instanceof ResponsesBoundError) {
    return { reason: 'provider-5xx', retryable: false, healthScope: 'route' };
  }
  const record = asRecord(error);
  const status = typeof record?.statusCode === 'number' ? record.statusCode
    : typeof record?.status === 'number' ? record.status : undefined;
  const code = typeof record?.code === 'string' ? record.code.toLowerCase() : '';
  if (code === 'model_identity_mismatch') return { reason: 'unsupported-model', retryable: false, healthScope: 'route' };
  const retryAfterMs = typeof record?.retryAfterMs === 'number' ? record.retryAfterMs : undefined;
  if (code === 'native_protocol_error') return { reason: 'provider-5xx', retryable: false, healthScope: 'route' };
  if (status === 413) return { reason: 'invalid-request', retryable: false, healthScope: 'route' };
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
  // N09: typed 413 evidence survives wrapping and keeps its terminal class
  // instead of collapsing into bad-request or pooled-account-unavailable.
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
