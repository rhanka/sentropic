import type {
  RouteAttemptUsage, RouteFailureClassification, RoutePlan, RoutePlanInput,
  RoutePlanner, VerifiedRoutingSubject,
} from '@sentropic/llm-mesh';
import type { GatewayConfig } from './config.js';
import { normalizeGatewayIngress, type CanonicalIngressResult } from './canonical-ingress.js';
import type { GatewayFlowRequest, SettleUsage } from './flow.js';
import type { CostContext } from './ports/cost-context.js';
import { GatewayError } from './router/errors.js';

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
}

export interface RouteMeteringSink {
  settleRoute(context: RouteRequestSettlement): Promise<void> | void;
}

export interface RouteFlowDeps {
  readonly config: GatewayConfig;
  readonly routePlanner: RoutePlanner;
  readonly metering: RouteMeteringSink;
  readonly routeInput?: (input: {
    readonly cost: CostContext;
    readonly request: GatewayFlowRequest;
    readonly canonical: CanonicalIngressResult;
  }) => Omit<RoutePlanInput, 'requestedModel' | 'requiredCapabilities'>;
}

export interface PreparedRouteFlow {
  readonly cost: CostContext;
  readonly subject: VerifiedRoutingSubject;
  readonly canonical: CanonicalIngressResult;
  readonly plan: RoutePlan;
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
  const auth = await deps.config.callerAuth.verify(request.headers);
  if (!auth.ok || !auth.cost) {
    throw new GatewayError('caller-auth-failed', auth.reason ?? 'caller-auth failed');
  }
  const canonical = normalizeGatewayIngress(request.wire, request.body);
  const subject = routingSubjectForCost(auth.cost);
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
