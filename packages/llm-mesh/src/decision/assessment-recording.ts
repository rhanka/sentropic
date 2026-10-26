import type { DecisionAssessment, DecisionAssessmentPopulation, DecisionAssessmentRow } from './assessment-types.js';
import type { DecisionRequest } from './request.js';
import type { DecisionValidationContext } from './validation-context.js';
import { validateDecisionResult } from './validate-result.js';
import { parseDecisionValidationContext } from './validation-context.js';
import { digestStructuredArtifact, isMicroUsd, isRecord, isText, snapshotBoundedJson } from './validation.js';
import { freezeDecisionData } from './descriptor-validation.js';
import { ASSESSMENT_POPULATIONS } from './assessment-validation.js';

/** Pure projection of a validated v1 result. No dispatch, retry, token estimate or receipt extension. */
export function recordDecisionAssessmentRow(input: { request: DecisionRequest; context: DecisionValidationContext;
  policyDigest: string;
  result: unknown; sampleId: string; population: DecisionAssessmentPopulation; internalWorkUnits: number;
  billableUnits: number; nowMs?: number }): DecisionAssessmentRow | null {
  const snapshot = snapshotBoundedJson(input);
  if (!snapshot.ok || !isRecord(snapshot.value)) return null;
  const value = snapshot.value as unknown as typeof input;
  if (!isText(value.sampleId) || !/^[a-f0-9]{64}$/.test(value.policyDigest) || !ASSESSMENT_POPULATIONS.includes(value.population)
    || ![value.internalWorkUnits, value.billableUnits].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const context = parseDecisionValidationContext(value.context, value.request, value.nowMs ?? Date.now());
  if (!context) return null;
  const result = validateDecisionResult(value.request, context, value.result);
  if (!result || (result.receipt.attempts === 0 && (value.internalWorkUnits !== 0 || value.billableUnits !== 0))) return null;
  const receipt = result.receipt;
  return freezeDecisionData({ callId: receipt.callId, sampleId: value.sampleId, inputDigest: digestStructuredArtifact(value.request.inputs),
    policyDigest: value.policyDigest, startedAt: receipt.startedAt,
    population: value.population, attempts: receipt.attempts,
    outcome: result.ok ? 'verdict' : result.error.code === 'PROVIDER_REJECTED' ? 'refusal'
      : ['VERDICT_INVALID', 'USAGE_INVALID', 'RESPONSE_TOO_LARGE'].includes(result.error.code) ? 'malformed' : 'transport-failure',
    pass: result.ok ? result.verdict.decision?.pass ?? null : null,
    score: result.ok ? result.verdict.score?.value ?? null : null, label: result.ok ? result.verdict.label?.value ?? null : null,
    internalWorkUnits: value.internalWorkUnits, billableUnits: value.billableUnits, amountMicroUsd: receipt.cost.amountMicroUsd,
    pendingReconciliation: receipt.budget.state === 'pending-reconciliation',
    receiptRef: `sha256:${digestStructuredArtifact(receipt)}`, latencyMs: receipt.latencyMs });
}

/** Consult before each planned experiment call using its conservative quote. Failures consume slots. */
export function decisionAssessmentCapacity(candidate: DecisionAssessment, nextReservedMicroUsd: string):
  { allowed: true } | { allowed: false; reason: string } {
  const snapshot = snapshotBoundedJson(candidate, 16 * 1024 * 1024);
  const value = snapshot.ok && isRecord(snapshot.value) ? snapshot.value : null;
  if (!value || !Array.isArray(value.rows) || !Number.isSafeInteger(value.attemptCap)
    || !isMicroUsd(value.costCapMicroUsd) || !isMicroUsd(nextReservedMicroUsd)
    || !value.rows.every((r) => isRecord(r) && isMicroUsd(r.amountMicroUsd)
      && (r.attempts === 0 || r.attempts === 1) && typeof r.pendingReconciliation === 'boolean')) {
    return { allowed: false, reason: 'invalid-record' };
  }
  const rows = value.rows as DecisionAssessmentRow[];
  if (rows.some((r) => r.pendingReconciliation)) return { allowed: false, reason: 'pending-reconciliation' };
  if (rows.length >= (value.attemptCap as number)) return { allowed: false, reason: 'attempt-cap' };
  const cost = rows.reduce((sum, r) => sum + BigInt(r.amountMicroUsd), 0n);
  return cost + BigInt(nextReservedMicroUsd) > BigInt(value.costCapMicroUsd)
    ? { allowed: false, reason: 'cost-cap' } : { allowed: true };
}
