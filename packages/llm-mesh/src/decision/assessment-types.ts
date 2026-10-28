import type { DecisionOperatingPolicy, DecisionQualificationScope } from './qualification-scope.js';
import type { DecisionCriterion, DecisionRule } from './request.js';

export type DecisionAssessmentPopulation = 'tuning' | 'held-out' | 'injection' | 'invariance' | 'repeat' | 'smoke';
export interface DecisionAssessmentSample {
  id: string; family: string; inputDigest: string; criterionDigest: string; split: 'tuning' | 'held-out';
  gold: boolean; goldScore?: number; goldLabel?: string;
  source: string; rights: string; rationale: string; annotators: string[]; adjudication: string; slices: string[];
}
/** Recorded receipt projection. Receipt v1 remains unchanged; work/billable units live here. */
export interface DecisionAssessmentRow {
  policyDigest: string; startedAt: string;
  callId: string; sampleId: string; inputDigest: string; population: DecisionAssessmentPopulation; attempts: 0 | 1;
  outcome: 'verdict' | 'refusal' | 'malformed' | 'transport-failure';
  pass: boolean | null; score: number | null; label: string | null;
  internalWorkUnits: number; billableUnits: number; amountMicroUsd: string;
  pendingReconciliation: boolean; receiptRef: string;
  latencyMs?: number;
}
export interface DecisionAssessment {
  schemaVersion: 1; scope: DecisionQualificationScope; executionDigest: string; date: string; criterion: DecisionCriterion;
  evidenceKind: 'recorded' | 'fixture'; sourceRefs: string[]; access: 'verified' | 'unverified';
  dataset: { revision: string; splitRevision: string; samples: DecisionAssessmentSample[] };
  policy: DecisionOperatingPolicy;
  controls: { criterionRevision: string; criterionDigest: string; policyDigest: string; splitDigest: string;
    tuningCallIds: string[]; candidateRules: DecisionRule[]; frozenAt: string };
  authorizationRef: string; attemptCap: number; costCapMicroUsd: string;
  planned: Record<DecisionAssessmentPopulation, number>; rows: DecisionAssessmentRow[];
}
export interface DecisionAssessmentReport {
  schemaVersion: 1; status: 'passed' | 'failed' | 'blocked' | 'incomplete'; reasons: string[];
  recordDigest: string | null; scope: DecisionQualificationScope;
  totals: { calls: number; attempts: number; internalWorkUnits: number; billableUnits: number; amountMicroUsd: string };
  populations: Record<string, { count: number; verdicts: number; refusals: number; malformed: number; transportFailures: number }>;
  heldOut: { count: number; negatives: number; positives: number; falsePasses: number; falseFails: number;
    coverage: number; falsePassUpper95: number; falseFailUpper95: number };
  metrics: Record<string, number | number[][]>;
  labels: string[] | null;
  evidence: { date: string | null; sourceRefs: string[]; datasetDigest: string | null; splitDigest: string | null;
    p30: 'verified' | 'unverified' };
  slices: { tag: string; count: number; verdicts: number; falsePasses: number; falseFails: number; sufficientlySampled: boolean }[];
  latency: { status: 'measured' | 'unverified'; p50Ms: number | null; p95Ms: number | null };
}
