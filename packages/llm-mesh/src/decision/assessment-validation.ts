import type { DecisionAssessment, DecisionAssessmentRow, DecisionAssessmentSample } from './assessment-types.js';
import type { DecisionQualificationScope } from './qualification-scope.js';
import { decisionQualificationScope } from './qualification-scope.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import { digestStructuredArtifact, hasOnlyKeys, isMicroUsd, isRecord, isText, snapshotBoundedJson } from './validation.js';

export const ASSESSMENT_POPULATIONS = ['tuning', 'held-out', 'injection', 'invariance', 'repeat', 'smoke'] as const;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isText);
function isSample(v: unknown, scope: DecisionQualificationScope): v is DecisionAssessmentSample {
  return isRecord(v) && hasOnlyKeys(v, ['id', 'family', 'inputDigest', 'criterionDigest', 'split', 'gold',
    'goldScore', 'goldLabel', 'source', 'rights', 'rationale', 'annotators', 'adjudication', 'slices'])
    && [v.id, v.family, v.source, v.rights, v.rationale, v.adjudication].every(isText)
    && v.adjudication !== 'unresolved' && digest(v.inputDigest) && v.criterionDigest === scope.criterionDigest
    && (v.split === 'tuning' || v.split === 'held-out') && typeof v.gold === 'boolean'
    && texts(v.annotators) && new Set(v.annotators).size >= 2 && texts(v.slices)
    && (v.goldScore === undefined || (typeof v.goldScore === 'number' && Number.isFinite(v.goldScore)))
    && (v.goldLabel === undefined || isText(v.goldLabel));
}
function isRow(v: unknown): v is DecisionAssessmentRow {
  return isRecord(v) && hasOnlyKeys(v, ['callId', 'sampleId', 'inputDigest', 'population', 'attempts', 'outcome',
    'pass', 'score', 'label', 'internalWorkUnits', 'billableUnits', 'amountMicroUsd', 'pendingReconciliation', 'receiptRef', 'latencyMs'])
    && [v.callId, v.sampleId, v.receiptRef].every(isText)
    && digest(v.inputDigest)
    && ASSESSMENT_POPULATIONS.some((p) => p === v.population) && (v.attempts === 0 || v.attempts === 1)
    && ['verdict', 'refusal', 'malformed', 'transport-failure'].includes(v.outcome as string)
    && (v.outcome === 'verdict' ? v.attempts === 1 && typeof v.pass === 'boolean' : v.pass === null)
    && (v.score === null || (typeof v.score === 'number' && Number.isFinite(v.score)))
    && (v.label === null || isText(v.label))
    && (v.outcome === 'verdict' || (v.score === null && v.label === null))
    && count(v.internalWorkUnits) && count(v.billableUnits) && isMicroUsd(v.amountMicroUsd)
    && typeof v.pendingReconciliation === 'boolean'
    && (v.latencyMs === undefined || (typeof v.latencyMs === 'number' && Number.isFinite(v.latencyMs) && v.latencyMs >= 0))
    && (v.attempts === 1 || (v.internalWorkUnits === 0 && v.billableUnits === 0));
}

/** Parse detached recorded data only. A claimed report status has no authority. */
export function parseDecisionAssessment(candidate: unknown, scope: DecisionQualificationScope,
  descriptor: DecisionEvaluatorDescriptor): DecisionAssessment | null {
  const snapshot = snapshotBoundedJson(candidate, 16 * 1024 * 1024);
  const v = snapshot.ok ? snapshot.value : null;
  if (!isRecord(v) || !hasOnlyKeys(v, ['schemaVersion', 'scope', 'executionDigest', 'criterion', 'date', 'evidenceKind', 'sourceRefs',
    'access', 'dataset', 'policy', 'policyFrozenBeforeAssessment', 'thresholdSelectedOn', 'authorizationRef',
    'attemptCap', 'costCapMicroUsd', 'planned', 'rows']) || v.schemaVersion !== 1
    || digestStructuredArtifact(v.scope) !== digestStructuredArtifact(scope) || v.executionDigest !== scope.executionDigest
    || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !Number.isFinite(Date.parse(v.date))
    || v.evidenceKind !== 'recorded' || v.access !== 'verified' || !texts(v.sourceRefs)
    || !isText(v.authorizationRef) || v.policyFrozenBeforeAssessment !== true || v.thresholdSelectedOn !== 'tuning'
    || digestStructuredArtifact(v.policy) !== scope.policyDigest
    || !count(v.attemptCap) || v.attemptCap < 1 || !isMicroUsd(v.costCapMicroUsd)
    || !isRecord(v.dataset) || !hasOnlyKeys(v.dataset, ['revision', 'splitRevision', 'samples'])
    || !isText(v.dataset.revision) || !isText(v.dataset.splitRevision)
    || !Array.isArray(v.dataset.samples) || v.dataset.samples.length > 10000
    || !v.dataset.samples.every((sample) => isSample(sample, scope))
    || !isRecord(v.planned) || !hasOnlyKeys(v.planned, ASSESSMENT_POPULATIONS)
    || !ASSESSMENT_POPULATIONS.every((p) => count((v.planned as Record<string, unknown>)[p]))
    || !Array.isArray(v.rows) || v.rows.length > 30000 || !v.rows.every(isRow)) return null;
  const record = v as unknown as DecisionAssessment;
  const expectedScope = decisionQualificationScope(descriptor, { schemaVersion: 1, evaluator: descriptor.evaluator,
    criterion: record.criterion, inputs: { output: 'scope' }, decision: record.policy.decision ?? undefined }, record.policy);
  if (!expectedScope || digestStructuredArtifact(expectedScope) !== digestStructuredArtifact(scope)) return null;
  const criterion = record.criterion.kind === 'registered'
    ? descriptor.registeredCriteria.find((c) => record.criterion.kind === 'registered'
      && c.criteriaId === record.criterion.criteriaId && c.revision === record.criterion.revision)!.criterion : record.criterion;
  const rule = record.policy.decision;
  if (!rule || rule.kind === 'provider' || (criterion.kind === 'choice' ? rule.kind !== 'labels' : rule.kind !== 'threshold')) return null;
  const validScore = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
    && value >= 0 && value <= (criterion.kind === 'graded' ? criterion.levels.length - 1 : 1);
  const validLabel = (value: string | null | undefined) => criterion.kind === 'choice' && criterion.options.some((c) => c.id === value);
  const pass = (score: number | undefined | null, label: string | undefined | null) => rule.kind === 'labels'
    ? rule.passing.includes(label ?? '') : rule.op === 'gte' ? score! >= rule.value : score! <= rule.value;
  const ids = new Set<string>(); const inputs = new Set<string>(); const families = new Map<string, string>();
  for (const sample of record.dataset.samples) {
    if (criterion.kind === 'choice' && (!validLabel(sample.goldLabel) || sample.gold !== pass(null, sample.goldLabel))) return null;
    if (criterion.kind === 'graded' && (!validScore(sample.goldScore) || sample.gold !== pass(sample.goldScore, null))) return null;
    if (ids.has(sample.id) || inputs.has(sample.inputDigest)
      || (families.has(sample.family) && families.get(sample.family) !== sample.split)) return null;
    ids.add(sample.id); inputs.add(sample.inputDigest); families.set(sample.family, sample.split);
  }
  const calls = new Set<string>(); const base = new Set<string>(); const pairs = new Set<string>();
  const samples = new Map(record.dataset.samples.map((sample) => [sample.id, sample]));
  for (const row of record.rows) {
    const sample = samples.get(row.sampleId);
    if (!sample || calls.has(row.callId)) return null;
    const pair = JSON.stringify([row.population, row.sampleId]);
    if (pairs.has(pair)) return null;
    pairs.add(pair);
    if (row.population === 'injection' || row.population === 'invariance') {
      if (row.inputDigest === sample.inputDigest) return null;
    } else if (row.inputDigest !== sample.inputDigest) return null;
    if (row.outcome === 'verdict' && (criterion.kind === 'choice'
      ? !validLabel(row.label) || row.score !== null || row.pass !== pass(null, row.label)
      : !validScore(row.score) || row.label !== null || row.pass !== pass(row.score, null))) return null;
    calls.add(row.callId);
    if (row.population === 'tuning' || row.population === 'held-out') {
      if (sample.split !== row.population || base.has(row.sampleId)) return null;
      base.add(row.sampleId);
    } else if (row.population !== 'smoke' && sample.split !== 'held-out') return null;
  }
  return record;
}
