import type { EvaluatorRef, DecisionCriterion } from './request.js';
import type { RetentionReceipt } from './receipt.js';

export type ResolvedDecisionCriterion = Exclude<DecisionCriterion, { kind: 'registered' }>;
export type DecisionBackendProtocol = 'jev-native' | 'openai-decisions' | 'systemone-local' | 'structured-llm';
export interface DecisionEvaluatorDescriptor {
  evaluator: EvaluatorRef;
  protocol?: DecisionBackendProtocol;
  wireModel: string;
  acceptedServedModelIds: readonly string[];
  qualification: { servedIdentity: 'qualified' | 'unqualified';
    billingBound: 'qualified' | 'unqualified'; evidenceRefs: readonly string[] };
  maxBillableInputTokens: number;
  maxRequestBytes: number;
  maxStateQuestionBytes: number;
  probabilityTolerance: number;
  scoreNativeKeys: 'index-string' | 'scalar';
  nativeDecision: boolean;
  confidence: { meaning: string; meaningRef: string; min: number; max: number };
  /** Compilation (§3.2): revisioned instruction template and closed output
   * schema digests plus the sampling/readout identity. */
  compilation: { templateDigest: string; schemaDigest: string; readout: string };
  /** Accounting (§3.2): price authority reference and protocol-specific pricing revision. */
  priceProtocol: { authority: string; revision: string };
  registeredCriteria: readonly { criteriaId: string; revision: string; criterion: ResolvedDecisionCriterion }[];
  retention: RetentionReceipt;
}

/** Byte limits are local admission limits, not claims about provider tokenization. */
export const jevDescriptor: DecisionEvaluatorDescriptor = {
  evaluator: { providerId: 'typesafe', evaluatorId: 'jev-1.13.0', revision: 'jev-1.13.0-mesh-v1-unqualified' },
  wireModel: 'jev-1.13.0', acceptedServedModelIds: [],
  qualification: { servedIdentity: 'unqualified', billingBound: 'unqualified', evidenceRefs: [] },
  // JEV-BOUND-01 candidate only; qualification is required before financial admission.
  maxBillableInputTokens: 65_536, maxRequestBytes: 256 * 1024, maxStateQuestionBytes: 32 * 1024,
  probabilityTolerance: 1e-4, scoreNativeKeys: 'index-string', nativeDecision: false,
  confidence: { meaning: 'provider-confidence', meaningRef: 'https://docs.typesafe.ai/confidence.md', min: 0, max: 1 },
  compilation: { templateDigest: '0'.repeat(64), schemaDigest: '1'.repeat(64), readout: 'jev-native-v1' },
  priceProtocol: { authority: 'fixture:synthetic-tariff', revision: 'fixture-price-v1' },
  registeredCriteria: [],
  retention: { status: 'unknown', basis: 'published-policy', retentionDays: null,
    gap: 'unknown (source-gap)', evidenceRefs: ['https://docs.typesafe.ai/legal.md',
      'https://typesafe.ai/legal/data-processing', 'https://typesafe.ai/legal/privacy-policy'] },
};
