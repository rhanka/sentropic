import { describe, expect, it } from 'vitest';
import { assessDecisionCalibration } from '../src/decision/assessment.js';
import { discoverDecisionEvaluator } from '../src/decision/qualification.js';
import { assessmentFixture } from './decision-assessment-fixtures.js';
import { decisionPrice } from './decision-fixtures.js';

describe('deterministic recorded calibration assessment', () => {
  it('should reproduce a passing report for one exact recorded scope', () => {
    const f = assessmentFixture();
    const report = assessDecisionCalibration(f.assessment, f.descriptor, f.scope);
    expect(report).toMatchObject({ status: 'passed', totals: { calls: 720, attempts: 720,
      internalWorkUnits: 720, billableUnits: 720000, amountMicroUsd: '30240' },
      heldOut: { count: 400, negatives: 200, positives: 200, falsePasses: 0, falseFails: 0, coverage: 1 } });
    expect(report).toEqual(assessDecisionCalibration(JSON.parse(JSON.stringify(f.assessment)), f.descriptor, f.scope));
  });
  it.each(['family-leakage', 'input-leakage', 'missing-labels', 'held-out-tuning', 'missing-revision', 'fixture'])
    ('should block %s without accepting claimed success', (mutation) => {
      const f = assessmentFixture();
      const a = f.assessment;
      if (mutation === 'family-leakage') a.dataset.samples[200].family = a.dataset.samples[0].family;
      if (mutation === 'input-leakage') a.dataset.samples[200].inputDigest = a.dataset.samples[0].inputDigest;
      if (mutation === 'missing-labels') a.dataset.samples[200].annotators = [];
      if (mutation === 'held-out-tuning') a.thresholdSelectedOn = 'held-out' as never;
      if (mutation === 'missing-revision') a.dataset.splitRevision = '';
      if (mutation === 'fixture') a.evidenceKind = 'fixture';
      expect(assessDecisionCalibration(a, f.descriptor, f.scope).status).toBe('blocked');
    });
  it('should count refusals in held-out coverage and valid-class false failures', () => {
    const f = assessmentFixture();
    for (const row of f.assessment.rows.filter((r) => r.population === 'held-out').slice(0, 20)) {
      row.outcome = 'refusal'; row.pass = null; row.score = null;
    }
    const report = assessDecisionCalibration(f.assessment, f.descriptor, f.scope);
    expect(report).toMatchObject({ status: 'failed', heldOut: { coverage: 0.95, falseFails: 10 },
      totals: { attempts: 720, amountMicroUsd: '30240' } });
  });
  it('should stop at caps and reject retries or duplicated held-out samples', () => {
    const f = assessmentFixture();
    f.assessment.rows.pop();
    expect(assessDecisionCalibration(f.assessment, f.descriptor, f.scope).status).toBe('incomplete');
    f.assessment.attemptCap = 719;
    expect(assessDecisionCalibration(f.assessment, f.descriptor, f.scope).status).toBe('incomplete');
    f.assessment.rows[0].attempts = 2 as never;
    expect(assessDecisionCalibration(f.assessment, f.descriptor, f.scope).status).toBe('blocked');
  });
  it('should never transfer passing calibration to another criterion or policy', () => {
    const f = assessmentFixture();
    delete f.descriptor.executionProfile;
    const evidence = { contractConformance: true, transportAccessible: true, policy: f.policy,
      assessments: [f.assessment], price: decisionPrice() };
    expect(discoverDecisionEvaluator(f.descriptor, evidence, f.request).productionReady).toBe(true);
    f.request.criterion = { kind: 'binary', instructions: 'Unseen arbitrary rubric.' };
    expect(discoverDecisionEvaluator(f.descriptor, evidence, f.request).productionReady).toBe(false);
  });
});
