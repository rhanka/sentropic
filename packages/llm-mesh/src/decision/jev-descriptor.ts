import type { EvaluatorRef, JudgeCriterion } from './request.js';
import type { RetentionReceipt } from './receipt.js';

export type ResolvedJudgeCriterion = Exclude<JudgeCriterion, { kind: 'registered' }>;
export interface EvaluatorDescriptor {
  evaluator: EvaluatorRef;
  wireModel: string;
  acceptedServedModelIds: readonly string[];
  qualification: { servedIdentity: 'qualified' | 'unqualified';
    billingBound: 'qualified' | 'unqualified'; evidenceRefs: readonly string[] };
  maxBillableInputTokens: number;
  maxRequestBytes: number;
  maxStateQuestionBytes: number;
  probabilityTolerance: number;
  scoreNativeKeys: 'index-string';
  nativeDecision: false;
  confidence: { meaning: 'provider-confidence'; meaningRef: string; min: 0; max: 1 };
  registeredCriteria: readonly { criteriaId: string; revision: string; criterion: ResolvedJudgeCriterion }[];
  retention: RetentionReceipt;
}

/** Byte limits are local admission limits, not claims about provider tokenization. */
export const jevDescriptor: EvaluatorDescriptor = {
  evaluator: { providerId: 'typesafe', evaluatorId: 'jev-1.13.0', revision: 'jev-1.13.0-mesh-v1-unqualified' },
  wireModel: 'jev-1.13.0', acceptedServedModelIds: [],
  qualification: { servedIdentity: 'unqualified', billingBound: 'unqualified', evidenceRefs: [] },
  // JEV-BOUND-01 candidate only; qualification is required before financial admission.
  maxBillableInputTokens: 65_536, maxRequestBytes: 256 * 1024, maxStateQuestionBytes: 32 * 1024,
  probabilityTolerance: 1e-4, scoreNativeKeys: 'index-string', nativeDecision: false,
  confidence: { meaning: 'provider-confidence', meaningRef: 'https://docs.typesafe.ai/confidence.md', min: 0, max: 1 },
  registeredCriteria: [],
  retention: { status: 'unknown', basis: 'published-policy', retentionDays: null,
    gap: 'unknown (source-gap)', evidenceRefs: ['https://docs.typesafe.ai/legal.md',
      'https://typesafe.ai/legal/data-processing', 'https://typesafe.ai/legal/privacy-policy'] },
};
