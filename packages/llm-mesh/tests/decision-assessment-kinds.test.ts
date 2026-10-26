import { describe, expect, it } from 'vitest';
import { assessDecisionCalibration } from '../src/decision/assessment.js';
import { decisionQualificationScope } from '../src/decision/qualification.js';
import type { DecisionCriterion, DecisionRule } from '../src/decision/request.js';
import { assessmentFixture, freezeAssessmentFixture } from './decision-assessment-fixtures.js';

describe('criterion-specific native quality gates', () => {
  it.each(['graded', 'choice'] as const)('should assess native %s evidence without borrowing a binary result', (kind) => {
    const f = assessmentFixture();
    const criterion: DecisionCriterion = kind === 'graded'
      ? { kind, instructions: 'Grade four levels.', direction: 'higher-is-better',
        levels: ['A', 'B', 'C', 'D'].map((label) => ({ label, description: label })) }
      : { kind, instructions: 'Route four labels.', options: ['A', 'B', 'C', 'D'].map((id) => ({ id, description: id })) };
    const decision: DecisionRule = kind === 'graded' ? { kind: 'threshold', field: 'score', op: 'gte', value: 2 }
      : { kind: 'labels', passing: ['A', 'B'] };
    const policy = { ...f.policy, decision };
    const scope = decisionQualificationScope(f.descriptor, { ...f.request, criterion, decision }, policy)!;
    f.assessment.scope = scope; f.assessment.criterion = criterion; f.assessment.policy = policy;
    for (const [i, sample] of f.assessment.dataset.samples.entries()) {
      sample.criterionDigest = scope.criterionDigest;
      sample.gold = kind === 'graded' ? i % 4 >= 2 : i % 4 < 2;
      if (kind === 'graded') sample.goldScore = i % 4;
      else sample.goldLabel = ['A', 'B', 'C', 'D'][i % 4];
    }
    const samples = new Map(f.assessment.dataset.samples.map((s) => [s.id, s]));
    for (const row of f.assessment.rows) {
      const sample = samples.get(row.sampleId)!;
      row.pass = sample.gold; row.score = sample.goldScore ?? null; row.label = sample.goldLabel ?? null;
    }
    freezeAssessmentFixture(f.assessment);
    const report = assessDecisionCalibration(f.assessment, f.descriptor, scope);
    expect(report.status).toBe('passed');
    expect(report.metrics).toMatchObject(kind === 'graded' ? { mae: 0, spearman: 1 } : { macroF1: 1, minimumRecall: 1 });
    expect(report.metrics).toMatchObject(kind === 'graded' ? { maeLower95: 0, maeUpper95: 0 }
      : { macroF1Lower95: 1, macroF1Upper95: 1 });
    for (const row of f.assessment.rows.filter((r) => r.population === 'held-out').slice(0, 100)) {
      if (kind === 'graded') { row.score = 3; row.pass = true; }
      else { row.label = 'A'; row.pass = true; }
    }
    expect(assessDecisionCalibration(f.assessment, f.descriptor, scope).status).toBe('failed');
  });
});
