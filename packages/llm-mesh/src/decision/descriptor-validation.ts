import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import { isDecisionCriterion } from './criterion.js';
import { sanitizeJevId } from './jev-response.js';
import { hasOnlyKeys, isCorrelationId, isRecord, isText, snapshotBoundedJson } from './validation.js';

/** Freeze only detached parser output, never the caller's object. */
export function freezeDecisionData<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDecisionData(child);
    Object.freeze(value);
  }
  return value;
}
export function parseDecisionEvaluatorDescriptor(candidate: unknown): DecisionEvaluatorDescriptor | null {
  const snapshot = snapshotBoundedJson(candidate);
  if (!snapshot.ok || !isRecord(snapshot.value)) return null;
  const value = snapshot.value;
  if (!hasOnlyKeys(value, ['evaluator', 'wireModel', 'acceptedServedModelIds', 'qualification', 'maxBillableInputTokens',
    'maxRequestBytes', 'maxStateQuestionBytes', 'probabilityTolerance', 'scoreNativeKeys', 'nativeDecision', 'confidence', 'registeredCriteria', 'retention'])
    || !isRecord(value.evaluator) || !hasOnlyKeys(value.evaluator, ['providerId', 'evaluatorId', 'revision'])
    || value.evaluator.providerId !== 'typesafe' || typeof value.wireModel !== 'string'
    || !/^jev-\d+\.\d+\.\d+$/.test(value.wireModel) || value.evaluator.evaluatorId !== value.wireModel
    || !isCorrelationId(value.evaluator.revision) || !isRecord(value.qualification)
    || !hasOnlyKeys(value.qualification, ['servedIdentity', 'billingBound', 'evidenceRefs'])
    || (value.qualification.servedIdentity !== 'qualified' && value.qualification.servedIdentity !== 'unqualified')
    || (value.qualification.billingBound !== 'qualified' && value.qualification.billingBound !== 'unqualified')
    || !Array.isArray(value.qualification.evidenceRefs) || !value.qualification.evidenceRefs.every(isText)
    || !Array.isArray(value.acceptedServedModelIds) || !value.acceptedServedModelIds.every((id) => sanitizeJevId(id) !== null)
    || new Set(value.acceptedServedModelIds).size !== value.acceptedServedModelIds.length
    || (value.qualification.servedIdentity === 'qualified' ? value.acceptedServedModelIds.length === 0 : value.acceptedServedModelIds.length !== 0)
    || ((value.qualification.servedIdentity === 'qualified' || value.qualification.billingBound === 'qualified') && !value.qualification.evidenceRefs.length)
    || typeof value.maxBillableInputTokens !== 'number' || !Number.isSafeInteger(value.maxBillableInputTokens) || value.maxBillableInputTokens < 1
    || typeof value.maxRequestBytes !== 'number' || !Number.isSafeInteger(value.maxRequestBytes) || value.maxRequestBytes < 1 || value.maxRequestBytes > 256 * 1024
    || typeof value.maxStateQuestionBytes !== 'number' || !Number.isSafeInteger(value.maxStateQuestionBytes) || value.maxStateQuestionBytes < 1 || value.maxStateQuestionBytes > value.maxRequestBytes
    || typeof value.probabilityTolerance !== 'number' || !Number.isFinite(value.probabilityTolerance) || value.probabilityTolerance < 0 || value.probabilityTolerance > 1e-4
    || value.scoreNativeKeys !== 'index-string' || value.nativeDecision !== false
    || !isRecord(value.confidence) || !hasOnlyKeys(value.confidence, ['meaning', 'meaningRef', 'min', 'max'])
    || value.confidence.meaning !== 'provider-confidence' || !isText(value.confidence.meaningRef) || value.confidence.min !== 0 || value.confidence.max !== 1
    || !Array.isArray(value.registeredCriteria) || !isRecord(value.retention)
    || !hasOnlyKeys(value.retention, ['status', 'basis', 'evidenceRefs', 'retentionDays', 'gap'])
    || (value.retention.status !== 'unknown' && value.retention.status !== 'non-zdr' && value.retention.status !== 'not-evaluated')
    || (value.retention.basis !== 'published-policy' && value.retention.basis !== 'none')
    || !Array.isArray(value.retention.evidenceRefs) || !value.retention.evidenceRefs.every(isText)
    || (value.retention.gap !== undefined && value.retention.gap !== 'unknown (source-gap)')
    || (value.retention.retentionDays !== null && (typeof value.retention.retentionDays !== 'number'
      || !Number.isSafeInteger(value.retention.retentionDays) || value.retention.retentionDays < 0))) return null;
  const refs = new Set<string>();
  for (const entry of value.registeredCriteria) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['criteriaId', 'revision', 'criterion'])
      || !isCorrelationId(entry.criteriaId) || !isCorrelationId(entry.revision)
      || !isDecisionCriterion(entry.criterion) || entry.criterion.kind === 'registered') return null;
    const key = JSON.stringify([entry.criteriaId, entry.revision]);
    if (refs.has(key)) return null;
    refs.add(key);
  }
  return freezeDecisionData(value as unknown as DecisionEvaluatorDescriptor);
}
