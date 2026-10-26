import type { DecisionAssessment } from '../src/decision/assessment-types.js';
import { decisionExecutionDigest, decisionQualificationScope } from '../src/decision/qualification.js';
import { decisionRequest, qualifiedDescriptor } from './decision-fixtures.js';
import { digestStructuredArtifact } from '../src/decision/validation.js';

/** Fabricated records exercise validation only; no provider or semantic qualification. */
export function assessmentFixture() {
  const descriptor = qualifiedDescriptor();
  const request = decisionRequest({ decision: { kind: 'threshold', field: 'score', op: 'gte', value: 0.5 } });
  const policy = { revision: 'policy-1', language: 'en', domain: 'support', intendedUse: 'assistance',
    maxInputBytes: 4096, decision: request.decision! };
  const scope = decisionQualificationScope(descriptor, request, policy)!;
  const samples = Array.from({ length: 600 }, (_, i) => ({ id: `item-${i}`, family: `family-${i}`,
    inputDigest: digestStructuredArtifact({ i }), criterionDigest: scope.criterionDigest,
    split: i < 200 ? 'tuning' as const : 'held-out' as const, gold: i % 2 === 0,
    source: 'recorded:domain-corpus', rights: 'owner-permission', rationale: 'Evidence spans reviewed.',
    annotators: ['domain-a', 'domain-b'], adjudication: 'agreed', slices: ['near-boundary'] }));
  const rows = samples.map((sample, i) => ({ callId: `call-${i}`, sampleId: sample.id, inputDigest: sample.inputDigest,
    population: sample.split, attempts: 1 as const, outcome: 'verdict' as const, pass: sample.gold,
    score: sample.gold ? 1 : 0, label: null, internalWorkUnits: 1, billableUnits: 1000,
    amountMicroUsd: '42', pendingReconciliation: false, receiptRef: `recorded:receipt-${i}` }));
  for (let i = 0; i < 120; i++) rows.push({ ...rows[200 + i], callId: `extra-${i}`,
    inputDigest: i < 60 ? digestStructuredArtifact({ variant: i }) : rows[200 + i].inputDigest,
    population: i < 30 ? 'injection' : i < 60 ? 'invariance' : 'repeat' } as never);
  const assessment: DecisionAssessment = { schemaVersion: 1, scope, date: '2026-10-26',
    executionDigest: decisionExecutionDigest(descriptor), evidenceKind: 'recorded', criterion: request.criterion,
    sourceRefs: ['recorded:source', 'license:owner-permission'], access: 'verified',
    dataset: { revision: 'corpus-1', splitRevision: 'split-1', samples },
    policy, policyFrozenBeforeAssessment: true, thresholdSelectedOn: 'tuning',
    authorizationRef: 'approved:run-packet', attemptCap: 720, costCapMicroUsd: '40000',
    planned: { tuning: 200, 'held-out': 400, injection: 30, invariance: 30, repeat: 60, smoke: 0 }, rows };
  return { descriptor, request, policy, scope, assessment };
}
