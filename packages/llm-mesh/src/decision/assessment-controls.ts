import type { DecisionAssessment } from './assessment-types.js';
import { isDecisionRule } from './criterion.js';
import { digestStructuredArtifact, hasOnlyKeys, isRecord, isText } from './validation.js';

export const assessmentSplitDigest = (record: DecisionAssessment): string => digestStructuredArtifact({
  revision: record.dataset.splitRevision,
  assignments: record.dataset.samples.map((s) => ({ id: s.id, family: s.family, split: s.split })),
});

/** Replay selection exclusively on tuning calls and bind every later call to the frozen policy.
 * Authenticity of imported timestamps/receipts remains the trusted recorder's responsibility. */
export function verifyAssessmentControls(record: DecisionAssessment): boolean {
  const c = record.controls;
  if (!isRecord(c) || !hasOnlyKeys(c, ['criterionRevision', 'criterionDigest', 'policyDigest', 'splitDigest',
    'tuningCallIds', 'candidateRules', 'frozenAt']) || !isText(c.criterionRevision)
    || c.criterionRevision !== (record.criterion.kind === 'registered' ? record.criterion.revision : record.scope.criterionDigest)
    || c.criterionDigest !== record.scope.criterionDigest || c.policyDigest !== record.scope.policyDigest
    || c.splitDigest !== assessmentSplitDigest(record)
    || !Array.isArray(c.tuningCallIds) || !c.tuningCallIds.every(isText)
    || !Array.isArray(c.candidateRules) || c.candidateRules.length < 1 || c.candidateRules.length > 64
    || !c.candidateRules.every((r) => isDecisionRule(r) && r.kind !== 'provider')
    || typeof c.frozenAt !== 'string' || !Number.isFinite(Date.parse(c.frozenAt))) return false;
  const frozen = Date.parse(c.frozenAt);
  const tuning = record.rows.filter((r) => r.population === 'tuning');
  const selected = new Set(c.tuningCallIds);
  if (!tuning.length || selected.size !== c.tuningCallIds.length || selected.size !== tuning.length
    || tuning.some((r) => !selected.has(r.callId))) return false;
  for (const row of record.rows) {
    const started = Date.parse(row.startedAt);
    if (!Number.isFinite(started) || row.policyDigest !== c.policyDigest
      || (row.population === 'tuning' ? started >= frozen : started <= frozen)) return false;
  }
  const samples = new Map(record.dataset.samples.map((s) => [s.id, s]));
  const errors = c.candidateRules.map((rule) => tuning.reduce((sum, row) => {
    if (row.outcome !== 'verdict') return sum + 1;
    const pass = rule.kind === 'labels' ? rule.passing.includes(row.label ?? '')
      : rule.kind === 'threshold' && row.score !== null
        && (rule.op === 'gte' ? row.score >= rule.value : row.score <= rule.value);
    return sum + Number(pass !== samples.get(row.sampleId)!.gold);
  }, 0));
  const winner = c.candidateRules[errors.indexOf(Math.min(...errors))];
  return digestStructuredArtifact(winner) === digestStructuredArtifact(record.policy.decision);
}
