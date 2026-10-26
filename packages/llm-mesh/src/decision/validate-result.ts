import type { DecisionRequest } from './request.js';
import type { DecisionReceipt, DecisionResult } from './receipt.js';
import type { DecisionError } from './errors.js';
import { createDecisionError } from './errors.js';
import type { DecisionVerdict } from './verdict.js';
import type { DecisionValidationContext } from './validation-context.js';
import { has, hasOnlyKeys, isRecord } from './validation.js';
import { isValidDecisionReceipt, isValidDecisionVerdict } from './client.js';
import { isDecisionErrorCode } from './errors.js';

/** Rebuild a wire error from code/phase/liability evidence; never carries wording. */
function rebuildWireError(error: unknown, receipt: DecisionReceipt): DecisionError | null {
  if (!isRecord(error) || !hasOnlyKeys(error, ['code', 'message', 'phase', 'retryable', 'retryAfterMs'])
    || !isDecisionErrorCode(error.code)
    || !['preflight', 'admission', 'dispatch', 'parse', 'settlement'].includes(error.phase as string)) return null;
  const unresolved = receipt.budget.state !== 'not-admitted' && receipt.budget.state !== 'released';
  const nonRetryable = unresolved || error.retryable === false;
  const rebuilt = createDecisionError(error.code, error.phase as DecisionError['phase'],
    { retryAfterMs: !nonRetryable && has(error, 'retryAfterMs') && typeof error.retryAfterMs === 'number'
      ? error.retryAfterMs : undefined });
  if (nonRetryable) {
    rebuilt.retryable = false;
    delete rebuilt.retryAfterMs;
  }
  return rebuilt;
}

const rebuildVerdict = (verdict: DecisionVerdict): DecisionVerdict => {
  const rebuilt: Record<string, unknown> = {
    criterionKind: verdict.criterionKind,
    resolvedCriterionKind: verdict.resolvedCriterionKind,
    score: structuredClone(verdict.score),
    decision: structuredClone(verdict.decision),
    label: structuredClone(verdict.label),
    rationale: structuredClone(verdict.rationale),
    confidence: structuredClone(verdict.confidence),
    distribution: structuredClone(verdict.distribution),
  };
  if (Object.hasOwn(verdict, 'providerRaw')) rebuilt.providerRaw = structuredClone(verdict.providerRaw);
  return rebuilt as unknown as DecisionVerdict;
};

const rebuildReceipt = (receipt: DecisionReceipt): DecisionReceipt => {
  const rebuilt: Record<string, unknown> = {
    schemaVersion: receipt.schemaVersion,
    callId: receipt.callId,
    correlationId: receipt.correlationId,
    evaluator: receipt.evaluator === null ? null : { providerId: receipt.evaluator.providerId,
      evaluatorId: receipt.evaluator.evaluatorId, revision: receipt.evaluator.revision },
    servedEvaluator: receipt.servedEvaluator === null ? null : { providerId: receipt.servedEvaluator.providerId,
      evaluatorId: receipt.servedEvaluator.evaluatorId, revision: receipt.servedEvaluator.revision },
    servedModelId: receipt.servedModelId,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt,
    latencyMs: receipt.latencyMs,
    dispatch: receipt.dispatch,
    attempts: receipt.attempts,
    usage: structuredClone(receipt.usage),
    cost: structuredClone(receipt.cost),
    retention: structuredClone(receipt.retention),
    budget: structuredClone(receipt.budget),
    outcome: receipt.outcome,
  };
  if (has(receipt, 'providerRequestId')) rebuilt.providerRequestId = receipt.providerRequestId;
  if (has(receipt, 'providerLatencyMs')) rebuilt.providerLatencyMs = receipt.providerLatencyMs;
  if (has(receipt, 'errorCode')) rebuilt.errorCode = receipt.errorCode;
  return rebuilt as unknown as DecisionReceipt;
};

/** Pure wire-result validator: no network, provider imports, env reads or credentials.
 * Validates a detached wire envelope against the transmitted request snapshot
 * and trusted context snapshot, rebuilding both branches field by field. */
export function validateDecisionResult(requestSnapshot: DecisionRequest,
  contextSnapshot: DecisionValidationContext | null, wireValue: unknown): DecisionResult | null {
  if (!isRecord(wireValue) || typeof requestSnapshot.correlationId !== 'string') return null;
  const expectedCorrelationId = requestSnapshot.correlationId;
  if (hasOnlyKeys(wireValue, ['kind', 'ok', 'verdict', 'receipt'])
    && wireValue.kind === 'verdict' && wireValue.ok === true
    && isValidDecisionReceipt(wireValue.receipt, requestSnapshot, expectedCorrelationId, contextSnapshot)
    && (wireValue.receipt as DecisionReceipt).outcome === 'verdict'
    && isValidDecisionVerdict(wireValue.verdict, requestSnapshot, contextSnapshot)) {
    return { kind: 'verdict', ok: true, verdict: rebuildVerdict(wireValue.verdict as DecisionVerdict),
      receipt: rebuildReceipt(wireValue.receipt as DecisionReceipt) };
  }
  if (hasOnlyKeys(wireValue, ['kind', 'ok', 'error', 'receipt'])
    && wireValue.kind === 'error' && wireValue.ok === false
    && isValidDecisionReceipt(wireValue.receipt, requestSnapshot, expectedCorrelationId, contextSnapshot)
    && (wireValue.receipt as DecisionReceipt).outcome === 'error') {
    const error = rebuildWireError(wireValue.error, wireValue.receipt as DecisionReceipt);
    if (error && (wireValue.receipt as DecisionReceipt).errorCode === error.code) {
      return { kind: 'error', ok: false, error, receipt: rebuildReceipt(wireValue.receipt as DecisionReceipt) };
    }
  }
  return null;
}
