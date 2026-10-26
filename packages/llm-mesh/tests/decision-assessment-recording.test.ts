import { describe, expect, it } from 'vitest';
import { recordDecisionAssessmentRow, decisionAssessmentCapacity } from '../src/decision/assessment-recording.js';
import { createDecisionService } from '../src/decision/service.js';
import { decisionRequest, decisionServiceFixture, trustedNativeContext } from './decision-fixtures.js';
import { validateDecisionResult } from '../src/decision/validate-result.js';
import { digestStructuredArtifact } from '../src/decision/validation.js';
import { assessmentFixture } from './decision-assessment-fixtures.js';
import { productionFixture } from './decision-production-fixtures.js';

describe('recording validated v1 results without replay', () => {
  it('should project one validated result and retain independent work counters', async () => {
    const f = productionFixture();
    const request = decisionRequest({ correlationId: 'record-1', decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } });
    const result = await createDecisionService(f.options).decide(request);
    const input = { request, context: trustedNativeContext(request), result, sampleId: 'item-1', policyDigest: f.scope.policyDigest,
      population: 'held-out' as const, internalWorkUnits: 3, billableUnits: 1000 };
    expect(recordDecisionAssessmentRow(input)).toMatchObject({ attempts: 1, internalWorkUnits: 3,
      billableUnits: 1000, amountMicroUsd: '42', pass: false, outcome: 'verdict' });
    const forged = structuredClone(result);
    if (forged.ok) forged.verdict.decision!.pass = true;
    expect(recordDecisionAssessmentRow({ ...input, result: forged })).toBeNull();
    expect(f.transport.send).toHaveBeenCalledTimes(1);
  });
  it('should stop before another dispatch at either cap and never replenish failures', () => {
    const f = assessmentFixture();
    expect(decisionAssessmentCapacity(f.assessment, '42')).toEqual({ allowed: false, reason: 'attempt-cap' });
    f.assessment.rows.pop();
    expect(decisionAssessmentCapacity(f.assessment, '42')).toEqual({ allowed: true });
    f.assessment.costCapMicroUsd = '30200';
    expect(decisionAssessmentCapacity(f.assessment, '42')).toEqual({ allowed: false, reason: 'cost-cap' });
    f.assessment.rows[0].pendingReconciliation = true;
    expect(decisionAssessmentCapacity(f.assessment, '42')).toEqual({ allowed: false, reason: 'pending-reconciliation' });
  });
  it('should record experimental evidence without making it consumable as production', async () => {
    const f = decisionServiceFixture();
    const request = decisionRequest({ correlationId: 'experimental-record', decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } });
    const result = await createDecisionService(f.options).decide(request);
    const context = trustedNativeContext(request);
    const input = { request, context, result, policyDigest: assessmentFixture().scope.policyDigest,
      sampleId: 'item-1', population: 'held-out' as const, internalWorkUnits: 1, billableUnits: 1000 };
    expect(validateDecisionResult(request, context, result)).toBeNull();
    expect(recordDecisionAssessmentRow(input)).toMatchObject({ outcome: 'verdict', pass: false,
      receiptRef: `sha256:${digestStructuredArtifact(result.receipt)}` });
    expect(recordDecisionAssessmentRow({ ...input, result: { ...result, canary: 'undeclared' } })).toBeNull();
    const forged = structuredClone(result);
    if (forged.ok) forged.verdict.decision!.pass = true;
    expect(recordDecisionAssessmentRow({ ...input, result: forged })).toBeNull();
  });
});
