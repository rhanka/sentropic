/**
 * Budget admission port (spec SPEC_EVOL_LLM_DEPLOYABLE_PROCESS §5, §12.2).
 * OPT-IN: the gateway runs admission only when the host injects this port.
 * The host adapter owns pricing, holds and ledger storage; the gateway never
 * reads pricing and mesh never reads budgets. Reservation is `admit`,
 * settlement is the single `RouteMeteringSink.settleRoute` aggregate carrying
 * `holdRef`/`quoteRef`, and `release` frees a hold that dispatched nothing.
 */
import type { RouteQuote, RouteUsageCeiling } from '@sentropic/llm-mesh';
import type { SettleUsage } from '../flow.js';
import type { CostContext } from './cost-context.js';
import type { GatewayWire } from './dispatch.js';

/** The quote is always computed in-process by the gateway, never read from the request. */
export interface BudgetAdmissionRequest {
  /** Server request id (the gateway `X-Sentropic-Request-Id`); settlement idempotency key. */
  readonly requestId: string;
  readonly cost: CostContext;
  readonly wire: GatewayWire;
  readonly quote: RouteQuote;
}

export type BudgetAdmissionDecision =
  | { readonly kind: 'admitted'; readonly holdRef: string }
  /** `resetAtMs`: latest blocking reset or hold deadline, epoch milliseconds. */
  | { readonly kind: 'over-budget'; readonly resetAtMs: number }
  | { readonly kind: 'unavailable' };

export interface BudgetAdmissionPort {
  /**
   * Price every quoted candidate and atomically reserve
   * `quote.maxAttempts × max(candidate liability)`, or refuse. Candidate
   * identity carries no reasoning effort, so each candidate must be priced at
   * the maximum liability over its effort variants. Pricing or store failure
   * must resolve `unavailable` (or reject), never `over-budget` or a free hold.
   *
   * The allowance input side is an ESTIMATE, not an upper bound: the gateway
   * counts request bytes / 4 plus `BUDGET_ATTACHMENT_INPUT_TOKENS` (or more for
   * inline files) per attachment, and reports attachments as `imageUnits`.
   * Real tokenization can exceed it, so the adapter must apply its own input
   * margin when converting the quote into a liability. The output side is the
   * request (or default) ceiling, which the gateway sends to the provider.
   * For a candidate with `outputCeilingEnforced: false` (codex) the provider
   * may ignore that ceiling: the adapter must price its reservation at the
   * model's maximum output, not the allowance; an overrun is still charged in
   * full at settlement and listed in `overrun`.
   *
   * Every hold must carry a deadline and expire. When the settlement sink
   * fails after a dispatch, the adapter reconciles the hold by `requestId`
   * through the durable dispatch marker (charge at least the allowance).
   */
  admit(request: BudgetAdmissionRequest): Promise<BudgetAdmissionDecision>;
  /**
   * Durable dispatch-start marker, awaited before each provider call. A
   * rejection means the provider is not called; the marker may still have
   * been written (ambiguous failure).
   */
  markDispatched(holdRef: string, attemptIndex: number): Promise<void>;
  /**
   * Free the hold of an admitted request that dispatched nothing. Called at
   * most once, before that request's single zero-usage `settleRoute`. It may
   * follow an ambiguous `markDispatched` rejection: the adapter must be
   * idempotent and must not free a hold whose durable marker exists. A
   * rejection is ignored by the gateway (the hold expires at its deadline).
   *
   * Pre-admission refusals (400 ceiling, empty quote, 429, 503) never call
   * `release` nor `settleRoute`: unlike the opt-in OFF path, which settles a
   * zero-usage failure when planning fails, nothing was reserved.
   */
  release(holdRef: string): Promise<void>;
}

export interface GatewayBudgetOptions {
  readonly port: BudgetAdmissionPort;
  /**
   * Output ceiling for a request that carries no max tokens; it is reserved
   * and injected as the request `maxOutputTokens` sent to every attempt. When
   * omitted, such a request is refused as `bad-request` (no unbounded liability).
   */
  readonly defaultOutputTokens?: number;
  /** Clock for the quote instant and `Retry-After`; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Upper bound of the over-budget `Retry-After` hint, in seconds. */
export const MAX_BUDGET_RETRY_AFTER_SECONDS = 60;

export type BudgetConfigurationErrorCode =
  | 'budget-route-planner-required'
  | 'budget-quote-required'
  | 'budget-invalid-default-ceiling';

/** Raised at construction: a configured budget can never run without a quote. */
export class BudgetConfigurationError extends Error {
  constructor(message: string, readonly code: BudgetConfigurationErrorCode) {
    super(message);
    this.name = 'BudgetConfigurationError';
  }
}

/** A dispatched attempt whose usage exceeded its quoted allowance. */
export interface RouteBudgetOverrun {
  readonly candidateRef: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId: string;
  /** False when the transport may drop the output ceiling (codex). */
  readonly outputCeilingEnforced: boolean;
  readonly allowance: RouteUsageCeiling;
  readonly usage: SettleUsage;
}
