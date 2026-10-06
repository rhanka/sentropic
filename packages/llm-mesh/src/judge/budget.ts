import type { EvaluatorRef } from './request.js';
import type { JudgeQuote } from './pricing.js';
import type { JudgeReceipt } from './receipt.js';

export interface JudgeAdmission {
  callId: string; correlationId: string; evaluator: EvaluatorRef; quote: JudgeQuote; deadlineAt: number;
}
export type JudgeAdmissionResult = { ok: true; holdId: string }
  | { ok: false; code: 'BUDGET_EXHAUSTED' | 'BUDGET_UNAVAILABLE' | 'PROVIDER_UNAVAILABLE' };
export type JudgeDispatchResult = { ok: true }
  | { ok: false; code: 'BUDGET_UNAVAILABLE' | 'PROVIDER_UNAVAILABLE'; provenUnsent: boolean };
export interface JudgeSettlement {
  holdId: string; receipt: JudgeReceipt; boundViolated: boolean;
}

/** Required host authority, closed over the verified owner and all existing budget buckets.
 * No in-memory production fallback. Every method must be bounded by host I/O deadlines.
 * Admission and final marking check the durable evaluator-revision disable predicate under
 * the same evaluator lock, acquired before hold/budget locks. A rejected admission creates
 * no hold; thrown admission/marking can be ambiguous and must be reconciled by callId.
 * Settlement atomically charges the full amount, releases the hold, writes ledger/outbox
 * and this redacted receipt, and retains boundViolated disable evidence across restart.
 * Pending reconciliation retains liability; retries reconcile accounting, never evaluate.
 */
export interface JudgeBudgetPort {
  admit(input: JudgeAdmission): Promise<JudgeAdmissionResult>;
  markDispatched(input: { holdId: string; callId: string; evaluator: EvaluatorRef; deadlineAt: number }): Promise<JudgeDispatchResult>;
  release(input: { holdId: string; callId: string }): Promise<void>;
  settle(input: JudgeSettlement): Promise<void>;
}

/** Acknowledges durable metadata persistence. No verdict or request content crosses this port.
 * For admitted calls, financial settlement owns the atomic ledger receipt projection;
 * this sink acknowledges its durable publication (or uses the same durable authority).
 */
export interface JudgeReceiptSink { persist(receipt: JudgeReceipt): Promise<void> }
