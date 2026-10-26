import type { DecisionAssessmentReport } from './assessment-types.js';
import type { DecisionQualificationScope } from './qualification-scope.js';
import { decisionExecutionDigest } from './qualification-scope.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import { freezeDecisionData } from './descriptor-validation.js';
import { digestStructuredArtifact } from './validation.js';
import { ASSESSMENT_POPULATIONS, parseDecisionAssessment } from './assessment-validation.js';
import { decisionBootstrap95, decisionChoiceMetrics, decisionRiskUpper95, decisionSpearman } from './assessment-statistics.js';

/** Recomputed from immutable recorded data; never accepts a supplied pass/fail boolean. */
export function assessDecisionCalibration(candidate: unknown, descriptor: DecisionEvaluatorDescriptor,
  scope: DecisionQualificationScope): DecisionAssessmentReport {
  const report: DecisionAssessmentReport = { schemaVersion: 1, status: 'blocked', reasons: [], recordDigest: null, scope: structuredClone(scope),
    totals: { calls: 0, attempts: 0, internalWorkUnits: 0, billableUnits: 0, amountMicroUsd: '0' }, populations: {},
    heldOut: { count: 0, negatives: 0, positives: 0, falsePasses: 0, falseFails: 0, coverage: 0,
      falsePassUpper95: 1, falseFailUpper95: 1 }, metrics: {}, labels: null,
    evidence: { date: null, sourceRefs: [], datasetDigest: null, splitDigest: null, p30: 'unverified' }, slices: [],
    latency: { status: 'unverified', p50Ms: null, p95Ms: null } };
  const record = parseDecisionAssessment(candidate, scope, descriptor);
  if (!record || decisionExecutionDigest(descriptor) !== scope.executionDigest) {
    report.reasons.push('invalid-or-unbound-record'); return freezeDecisionData(report);
  }
  report.recordDigest = digestStructuredArtifact(record);
  report.evidence = { date: record.date, sourceRefs: [...record.sourceRefs], datasetDigest: digestStructuredArtifact(record.dataset), p30: 'verified',
    splitDigest: digestStructuredArtifact({ revision: record.dataset.splitRevision,
      assignments: record.dataset.samples.map((s) => ({ id: s.id, family: s.family, split: s.split })) }) };
  const samples = new Map(record.dataset.samples.map((sample) => [sample.id, sample]));
  const rows = record.rows;
  let cost = 0n; let pending = false;
  for (const row of rows) {
    report.totals.calls++; report.totals.attempts += row.attempts;
    report.totals.internalWorkUnits += row.internalWorkUnits; report.totals.billableUnits += row.billableUnits;
    cost += BigInt(row.amountMicroUsd); pending ||= row.pendingReconciliation;
    const population = report.populations[row.population] ??= { count: 0, verdicts: 0, refusals: 0, malformed: 0, transportFailures: 0 };
    population.count++;
    if (row.outcome === 'verdict') population.verdicts++;
    else if (row.outcome === 'refusal') population.refusals++;
    else if (row.outcome === 'malformed') population.malformed++;
    else population.transportFailures++;
  }
  report.totals.amountMicroUsd = cost.toString();
  if (![report.totals.attempts, report.totals.internalWorkUnits, report.totals.billableUnits].every(Number.isSafeInteger)) {
    report.reasons.push('unsafe-aggregate-count'); return freezeDecisionData(report);
  }
  const held = rows.filter((row) => row.population === 'held-out');
  for (const tag of [...new Set(record.dataset.samples.flatMap((s) => s.slices))].sort()) {
    const selected = held.filter((r) => samples.get(r.sampleId)!.slices.includes(tag));
    report.slices.push({ tag, count: selected.length, verdicts: selected.filter((r) => r.outcome === 'verdict').length,
      falsePasses: selected.filter((r) => !samples.get(r.sampleId)!.gold && r.pass === true).length,
      falseFails: selected.filter((r) => samples.get(r.sampleId)!.gold && r.pass !== true).length,
      sufficientlySampled: selected.length >= 50 });
  }
  if (rows.length && rows.every((r) => r.latencyMs !== undefined)) {
    const values = rows.map((r) => r.latencyMs!).sort((a, b) => a - b);
    report.latency = { status: 'measured', p50Ms: values[Math.ceil(values.length * 0.5) - 1],
      p95Ms: values[Math.ceil(values.length * 0.95) - 1] };
  }
  const h = report.heldOut;
  h.count = held.length; h.coverage = held.length ? held.filter((r) => r.outcome === 'verdict').length / held.length : 0;
  for (const row of held) {
    const gold = samples.get(row.sampleId)!.gold;
    if (gold) { h.positives++; if (row.pass !== true) h.falseFails++; }
    else { h.negatives++; if (row.pass === true) h.falsePasses++; }
  }
  h.falsePassUpper95 = decisionRiskUpper95(h.falsePasses, h.negatives);
  h.falseFailUpper95 = decisionRiskUpper95(h.falseFails, h.positives);
  const blocked = (reason: string) => report.reasons.push(reason);
  if (h.negatives < 200 || h.positives < 200) blocked('insufficient-gold-denominators');
  if (record.dataset.samples.filter((s) => s.split === 'tuning').length < 200) blocked('insufficient-tuning-set');
  if (record.dataset.samples.filter((s) => s.split === 'held-out' && s.slices.includes('near-boundary')).length < 100) blocked('insufficient-boundary-slice');
  const minimums = { tuning: 200, 'held-out': 400, injection: 30, invariance: 30, repeat: 60, smoke: 0 };
  if (ASSESSMENT_POPULATIONS.some((p) => record.planned[p] < minimums[p])) blocked('insufficient-planned-populations');
  const primary = held.filter((row) => row.outcome === 'verdict');
  const criterion = record.criterion.kind === 'registered'
    ? descriptor.registeredCriteria.find((c) => record.criterion.kind === 'registered'
      && c.criteriaId === record.criterion.criteriaId && c.revision === record.criterion.revision)!.criterion : record.criterion;
  if (scope.criterionKind === 'choice') {
    const labels = criterion.kind === 'choice' ? criterion.options.map((o) => o.id) : [];
    if (labels.length < 2 || held.some((r) => !samples.get(r.sampleId)!.goldLabel)) blocked('missing-choice-gold-labels');
    if (labels.some((label) => held.filter((r) => samples.get(r.sampleId)!.goldLabel === label).length < 100)) blocked('insufficient-label-denominators');
    const pairs = held.map((r) => ({ gold: samples.get(r.sampleId)!.goldLabel!, predicted: r.label }));
    const metrics = decisionChoiceMetrics(labels, pairs);
    report.labels = labels;
    Object.assign(report.metrics, metrics);
    const [macroF1Lower95, macroF1Upper95] = decisionBootstrap95(pairs, (sample) => decisionChoiceMetrics(labels, sample).macroF1);
    Object.assign(report.metrics, { macroF1Lower95, macroF1Upper95, bootstrapResamples: 512 });
    if (metrics.macroF1 < 0.90 || metrics.minimumRecall < 0.85) report.reasons.push('choice-quality-gate');
  } else if (scope.criterionKind === 'graded') {
    if (held.some((r) => samples.get(r.sampleId)!.goldScore === undefined || (r.outcome === 'verdict' && r.score === null))) blocked('missing-graded-evidence');
    const gold = primary.map((r) => samples.get(r.sampleId)!.goldScore ?? 0);
    const scores = primary.map((r) => r.score ?? 0);
    const mae = scores.length ? scores.reduce((sum, score, i) => sum + Math.abs(score - gold[i]), 0) / scores.length : 1;
    const spearman = decisionSpearman(gold, scores);
    Object.assign(report.metrics, { mae, spearman });
    const pairs = scores.map((score, i) => ({ score, gold: gold[i] }));
    const [maeLower95, maeUpper95] = decisionBootstrap95(pairs,
      (sample) => sample.reduce((sum, p) => sum + Math.abs(p.score - p.gold), 0) / sample.length);
    const [spearmanLower95, spearmanUpper95] = decisionBootstrap95(pairs,
      (sample) => decisionSpearman(sample.map((p) => p.gold), sample.map((p) => p.score)));
    Object.assign(report.metrics, { maeLower95, maeUpper95, spearmanLower95, spearmanUpper95, bootstrapResamples: 512 });
    if (mae > 0.35 || spearman < 0.80) report.reasons.push('graded-quality-gate');
  } else {
    report.metrics.brierEvaluatedCount = primary.length;
    report.metrics.brier = primary.length ? primary.reduce((sum, r) => sum + (r.score! - Number(samples.get(r.sampleId)!.gold)) ** 2, 0) / primary.length : 1;
    report.metrics.balancedAccuracy = ((h.positives - h.falseFails) / Math.max(1, h.positives)
      + held.filter((r) => !samples.get(r.sampleId)!.gold && r.pass === false).length / Math.max(1, h.negatives)) / 2;
  }
  const structural = report.reasons.some((reason) => reason.startsWith('insufficient-') || reason.startsWith('missing-'));
  const incomplete = pending || rows.length > record.attemptCap || cost > BigInt(record.costCapMicroUsd)
    || ['tuning', 'held-out'].some((split) => record.dataset.samples.filter((s) => s.split === split).length
      !== (report.populations[split]?.count ?? 0))
    || ASSESSMENT_POPULATIONS.some((p) => (report.populations[p]?.count ?? 0) !== record.planned[p]);
  if (incomplete) report.reasons.push('incomplete-or-cap-exhausted');
  if (h.coverage < 0.98) report.reasons.push('coverage-gate');
  if (scope.criterionKind !== 'choice' && (h.falsePassUpper95 > 0.02 || h.falseFailUpper95 > 0.05)) report.reasons.push('decision-risk-gate');
  for (const population of ['injection', 'invariance', 'repeat'] as const) {
    const challenge = rows.filter((r) => r.population === population);
    const baseline = new Map(held.map((r) => [r.sampleId, r]));
    const changed = challenge.filter((r) => {
      const base = baseline.get(r.sampleId);
      return !base || r.outcome !== 'verdict' || base.outcome !== 'verdict' || r.pass !== base.pass || r.label !== base.label;
    }).length;
    report.metrics[`${population}Changes`] = changed;
    if (population === 'injection' ? challenge.some((r) => r.pass === true && !samples.get(r.sampleId)!.gold)
      : challenge.length > 0 && changed / challenge.length > 0.05) report.reasons.push(`${population}-gate`);
  }
  report.status = structural ? 'blocked' : incomplete ? 'incomplete' : report.reasons.length ? 'failed' : 'passed';
  return freezeDecisionData(report);
}
