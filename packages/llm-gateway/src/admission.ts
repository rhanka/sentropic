/**
 * Gateway budget admission (spec §5, §12.2). Order: caller auth → ingress →
 * finite ceiling → in-process quote → admit (reserve) → plan pinned to the
 * quote → attempts → one settlement. Refusals raised here are pre-acquisition:
 * no account is prepared and no byte is emitted before `admit` resolves.
 */
import {
  RoutePlanError, RouteQuoteError, type GenerateRequest, type QuotedRouteCandidate, type RoutePlanner,
  type RouteQuote, type RouteQuoteInput, type RouteUsageCeiling,
} from '@sentropic/llm-mesh';
import type { CanonicalIngressResult } from './canonical-ingress.js';
import { estimateAnthropicInputTokens } from './canonical-stream.js';
import type { GatewayWire } from './ports/dispatch.js';
import type { CostContext } from './ports/cost-context.js';
import {
  BudgetConfigurationError, MAX_BUDGET_RETRY_AFTER_SECONDS,
  type GatewayBudgetOptions, type RouteBudgetOverrun,
} from './ports/budget.js';
import type { SettleUsage } from './flow.js';
import { GatewayError } from './router/errors.js';

export interface AdmittedRoute {
  readonly requestId: string;
  readonly holdRef: string;
  readonly quote: RouteQuote;
  /** Candidate refs whose dispatch marker succeeded (provider call allowed). */
  readonly dispatched: Set<string>;
}

const isCount = (value: unknown, minimum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

/** Construction guard: a configured budget can never run without an in-process quote. */
export const assertBudgetRouteDeps = (
  routePlanner: RoutePlanner | undefined,
  hasMetering: boolean,
  budget: GatewayBudgetOptions | undefined,
): void => {
  if (!budget) return;
  if (!routePlanner || !hasMetering) {
    throw new BudgetConfigurationError(
      'budget admission requires routePlanner and routeMetering', 'budget-route-planner-required',
    );
  }
  if (typeof routePlanner.quote !== 'function') {
    throw new BudgetConfigurationError(
      'budget admission requires a RoutePlanner with quote()', 'budget-quote-required',
    );
  }
  if (budget.defaultOutputTokens !== undefined && !isCount(budget.defaultOutputTokens, 1)) {
    throw new BudgetConfigurationError(
      'defaultOutputTokens must be a finite integer >= 1', 'budget-invalid-default-ceiling',
    );
  }
};

/** `Retry-After = min(60, max(1, ceil((resetAtMs - nowMs) / 1000)))`. */
export const budgetRetryAfterSeconds = (resetAtMs: number, nowMs: number): number =>
  Number.isFinite(resetAtMs) && Number.isFinite(nowMs)
    ? Math.min(MAX_BUDGET_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)))
    : MAX_BUDGET_RETRY_AFTER_SECONDS;

/**
 * Budget path only: a request without max tokens is sent with the host default
 * output ceiling, so the provider enforces exactly what the hold reserved.
 */
export const boundRouteOutputCeiling = (
  canonical: CanonicalIngressResult,
  budget: GatewayBudgetOptions,
): CanonicalIngressResult => canonical.request.maxOutputTokens !== undefined
  || budget.defaultOutputTokens === undefined
  ? canonical
  : { ...canonical, request: { ...canonical.request, maxOutputTokens: budget.defaultOutputTokens } };

/** Minimum input-token allowance per image, file or tool-result media attachment. */
export const BUDGET_ATTACHMENT_INPUT_TOKENS = 4_096;

interface AttachmentLike { readonly type: string; readonly data?: string; readonly url?: string }

const attachmentTokens = (part: AttachmentLike): number => {
  const inline = part.data ?? (part.url?.startsWith('data:') ? part.url : undefined);
  const bytes = inline && part.type !== 'image' ? Math.ceil((inline.length * 3) / 4) : 0;
  return Math.max(BUDGET_ATTACHMENT_INPUT_TOKENS, Math.ceil(bytes / 4));
};

/** Attachments the byte estimate projects out (binary data replaced by a marker). */
const routeAttachments = (request: GenerateRequest): AttachmentLike[] => request.messages.flatMap((message) => [
  ...(typeof message.content === 'string' ? [] : message.content
    .filter((part) => part.type === 'image' || part.type === 'file') as AttachmentLike[]),
  ...('toolResult' in message ? (message.toolResult.content ?? []).flatMap((part): AttachmentLike[] =>
    part.type === 'media' ? [part]
      : part.type === 'embedded-resource' && part.resource.data !== undefined
        ? [{ type: 'file', data: part.resource.data }] : []) : []),
]);

/**
 * Finite per-attempt ceiling: estimated input and the request (or default)
 * output limit. Attachments count as `imageUnits` and add a conservative
 * per-attachment input allowance; the input side stays an estimate.
 */
export const routeUsageCeiling = (
  canonical: CanonicalIngressResult,
  budget: GatewayBudgetOptions,
): RouteUsageCeiling => {
  const outputTokens = canonical.request.maxOutputTokens ?? budget.defaultOutputTokens;
  if (!isCount(outputTokens, 1)) {
    throw new GatewayError('bad-request', 'a finite output token ceiling is required');
  }
  const attachments = routeAttachments(canonical.request);
  const inputTokens = estimateAnthropicInputTokens(canonical.request)
    + attachments.reduce((total, part) => total + attachmentTokens(part), 0);
  return { inputTokens, outputTokens, ...(attachments.length > 0 ? { imageUnits: attachments.length } : {}) };
};

type QuoteRouteFields = Omit<RouteQuoteInput, 'requestedModel' | 'requiredCapabilities' | 'ceiling' | 'now'>;

export const admitRoute = async (input: {
  readonly budget: GatewayBudgetOptions;
  readonly routePlanner: RoutePlanner;
  readonly requestId: string;
  readonly cost: CostContext;
  readonly wire: GatewayWire;
  readonly requestedModel: string;
  readonly canonical: CanonicalIngressResult;
  readonly route: QuoteRouteFields;
}): Promise<AdmittedRoute> => {
  const { budget, routePlanner } = input;
  const clock = budget.now ?? Date.now;
  const ceiling = routeUsageCeiling(input.canonical, budget);
  let quote: RouteQuote;
  try {
    quote = routePlanner.quote!({
      ...input.route,
      requestedModel: input.requestedModel,
      requiredCapabilities: input.canonical.requiredCapabilities,
      ceiling, now: new Date(clock()),
    });
  } catch (error) {
    if (error instanceof RouteQuoteError && error.code === 'invalid-ceiling') {
      throw new GatewayError('bad-request', 'usage ceiling refused by the route quote');
    }
    throw error;
  }
  // Nothing is quotable: reserve nothing and refuse exactly like an empty route.
  if (quote.candidates.length === 0) throw new RoutePlanError('Route quote has no candidates', 'no-route');
  let decision: Awaited<ReturnType<GatewayBudgetOptions['port']['admit']>> | undefined;
  try {
    decision = await budget.port.admit({
      requestId: input.requestId, cost: input.cost, wire: input.wire, quote,
    });
  } catch {
    throw new GatewayError('budget-unavailable', 'budget admission unavailable');
  }
  if (decision?.kind === 'admitted' && typeof decision.holdRef === 'string' && decision.holdRef) {
    return { requestId: input.requestId, holdRef: decision.holdRef, quote, dispatched: new Set() };
  }
  if (decision?.kind === 'over-budget') {
    throw new GatewayError('over-budget', 'budget cap reached',
      budgetRetryAfterSeconds(decision.resetAtMs, clock()));
  }
  throw new GatewayError('budget-unavailable', 'budget admission unavailable');
};

/** Raised when the durable dispatch marker fails: the provider is never called. */
export class BudgetDispatchMarkError extends Error {
  constructor() {
    super('budget dispatch marker unavailable');
    this.name = 'BudgetDispatchMarkError';
  }
}

export const markRouteDispatched = async (
  budget: GatewayBudgetOptions | undefined,
  admission: AdmittedRoute | undefined,
  candidateRef: string,
  attemptIndex: number,
): Promise<void> => {
  if (!budget || !admission) return;
  try {
    await budget.port.markDispatched(admission.holdRef, attemptIndex);
  } catch {
    throw new BudgetDispatchMarkError();
  }
  admission.dispatched.add(candidateRef);
};

interface AttemptView {
  readonly candidateRef: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId: string;
  readonly usage: SettleUsage;
}

/** Quoted candidates covering a served attempt (same rule as mesh plan pinning). */
const coveringCandidates = (quote: RouteQuote, attempt: AttemptView): readonly QuotedRouteCandidate[] => {
  const covering = quote.candidates.filter((candidate) => candidate.providerId === attempt.providerId
    && candidate.modelId === attempt.modelId
    && (candidate.transportProviderId === undefined
      || candidate.transportProviderId === attempt.transportProviderId));
  return covering.length > 0 ? covering : quote.candidates;
};

const allowanceFor = (candidates: readonly QuotedRouteCandidate[]): RouteUsageCeiling => ({
  inputTokens: Math.max(...candidates.map((candidate) => candidate.allowance.inputTokens)),
  outputTokens: Math.max(...candidates.map((candidate) => candidate.allowance.outputTokens)),
});

/**
 * Measured means both counts are finite and non-zero. Empty (`{}`), partial
 * (`{ totalTokens }`) or zero-filled provider usage is no billing evidence.
 */
const isMeasured = (usage: SettleUsage): boolean => !usage.estimated
  && isCount(usage.inputTokens, 1) && isCount(usage.outputTokens, 1);

const countOrZero = (value: number): number => (isCount(value, 0) ? value : 0);

/**
 * Charged usage per attempt: a dispatched attempt without measured usage is
 * charged at least its quoted allowance, never an estimated zero. Overruns
 * record dispatched attempts whose measured usage exceeded the allowance.
 */
export const chargeAdmittedAttempts = <T extends AttemptView>(
  admission: AdmittedRoute,
  attempts: readonly T[],
): { readonly attempts: T[]; readonly overrun: RouteBudgetOverrun[] } => {
  const overrun: RouteBudgetOverrun[] = [];
  const charged = attempts.map((attempt): T => {
    if (!admission.dispatched.has(attempt.candidateRef)) return attempt;
    const candidates = coveringCandidates(admission.quote, attempt);
    const allowance = allowanceFor(candidates);
    if (!isMeasured(attempt.usage)) {
      return { ...attempt, usage: {
        inputTokens: Math.max(countOrZero(attempt.usage.inputTokens), allowance.inputTokens),
        outputTokens: Math.max(countOrZero(attempt.usage.outputTokens), allowance.outputTokens),
        estimated: true,
      } };
    }
    if (attempt.usage.inputTokens > allowance.inputTokens
      || attempt.usage.outputTokens > allowance.outputTokens) {
      overrun.push({
        candidateRef: attempt.candidateRef, providerId: attempt.providerId,
        modelId: attempt.modelId, transportProviderId: attempt.transportProviderId,
        outputCeilingEnforced: candidates.every((candidate) => candidate.outputCeilingEnforced),
        allowance, usage: attempt.usage,
      });
    }
    return attempt;
  });
  return { attempts: charged, overrun };
};
