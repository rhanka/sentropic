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
const PROTOCOLS = new Set(['jev-native', 'openai-decisions', 'systemone-local', 'structured-llm']);
export function parseDecisionEvaluatorDescriptor(candidate: unknown): DecisionEvaluatorDescriptor | null {
  const snapshot = snapshotBoundedJson(candidate);
  if (!snapshot.ok || !isRecord(snapshot.value)) return null;
  const value = snapshot.value;
  if (!hasOnlyKeys(value, ['evaluator', 'protocol', 'wireModel', 'acceptedServedModelIds', 'qualification', 'maxBillableInputTokens',
    'maxRequestBytes', 'maxStateQuestionBytes', 'probabilityTolerance', 'scoreNativeKeys', 'nativeDecision', 'confidence', 'compilation', 'priceProtocol', 'registeredCriteria', 'retention'])
    || !isRecord(value.evaluator) || !hasOnlyKeys(value.evaluator, ['providerId', 'evaluatorId', 'revision'])
    || (value.protocol !== undefined && (!isRecord(value) || !PROTOCOLS.has(value.protocol as string)))
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
    || (value.protocol === undefined || value.protocol === 'jev-native'
      ? (value.evaluator.providerId !== 'typesafe' || typeof value.wireModel !== 'string'
        || !/^jev-\d+\.\d+\.\d+$/.test(value.wireModel) || value.evaluator.evaluatorId !== value.wireModel
        || value.scoreNativeKeys !== 'index-string' || value.nativeDecision !== false
        || !isRecord(value.confidence) || !hasOnlyKeys(value.confidence, ['meaning', 'meaningRef', 'min', 'max'])
        || value.confidence.meaning !== 'provider-confidence' || !isText(value.confidence.meaningRef)
        || value.confidence.min !== 0 || value.confidence.max !== 1)
      : (typeof value.evaluator.providerId !== 'string' || !isText(value.evaluator.providerId)
        || typeof value.evaluator.evaluatorId !== 'string' || !isText(value.evaluator.evaluatorId)
        || typeof value.wireModel !== 'string' || sanitizeJevId(value.wireModel) === null
        || (value.scoreNativeKeys !== 'index-string' && value.scoreNativeKeys !== 'scalar')
        || typeof value.nativeDecision !== 'boolean'
        || !isRecord(value.confidence) || !hasOnlyKeys(value.confidence, ['meaning', 'meaningRef', 'min', 'max'])
        || !isText(value.confidence.meaning) || !isText(value.confidence.meaningRef)
        || typeof value.confidence.min !== 'number' || typeof value.confidence.max !== 'number'
        || !Number.isFinite(value.confidence.min) || !Number.isFinite(value.confidence.max)
        || value.confidence.max < value.confidence.min))
    || !isRecord(value.compilation) || !hasOnlyKeys(value.compilation, ['templateDigest', 'schemaDigest', 'readout'])
    || typeof value.compilation.templateDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.compilation.templateDigest)
    || typeof value.compilation.schemaDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.compilation.schemaDigest)
    || !isText(value.compilation.readout)
    || !isRecord(value.priceProtocol) || !hasOnlyKeys(value.priceProtocol, ['authority', 'revision'])
    || !isText(value.priceProtocol.authority) || !isText(value.priceProtocol.revision)
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
