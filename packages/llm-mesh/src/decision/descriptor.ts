import type { EvaluatorRef, DecisionCriterion } from './request.js';
import type { RetentionReceipt } from './receipt.js';
import { digestStructuredArtifact } from './validation.js';

export type ResolvedDecisionCriterion = Exclude<DecisionCriterion, { kind: 'registered' }>;
export type DecisionBackendProtocol = 'jev-native' | 'openai-decisions' | 'systemone-local' | 'structured-llm';
export interface DecisionEvaluatorDescriptor {
  /**
   * Complete definition binding (§3.2): the versioned validation profile the
   * implementation enforces, the criterion kinds covered with their per-kind
   * closed-schema digests, the evidence every envelope must carry, and the
   * execution/bundle digests recomputed from the artifacts actually dispatched.
   */
  definition: {
    validationProfile: { profile: string; version: string };
    kinds: readonly { kind: string; schemaDigest: string }[];
    evidenceRequirements: readonly string[];
    executionDigest: string;
    bundleDigest: string;
  };
  evaluator: EvaluatorRef;
  /** Absent means production. Qualification is an explicit experimental composition. */
  executionProfile?: 'production' | 'qualification';
  protocol?: DecisionBackendProtocol;
  wireModel: string;
  acceptedServedModelIds: readonly string[];
  qualification: { servedIdentity: 'qualified' | 'unqualified';
    billingBound: 'qualified' | 'unqualified'; evidenceRefs: readonly string[] };
  maxBillableInputTokens: number;
  /** Enforced protocol output/reasoning bound (§3.2 Execution). Zero means
   * the descriptor admits no billable output; output-priced quoting requires a
   * positive bound and the structured transport transmits it as the
   * execution cap. */
  maxBillableOutputTokens: number;
  /** Score meaning/scale rules (§3.2 Validation, §3.4 scalar-label-v1).
   * The host binds structured scalar meaning to this declaration, falling
   * back to the protocol default only when the descriptor omits it. */
  scoreSemantics?: { meaning: string; meaningRef: string };
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

/**
 * JEV-meaningful definition digests, minted at module load from the stated
 * values: JEV carries no closed schema (native verdict per kind), no output
 * budget and the jev-native readout. The structured adapter additionally
 * requires the structured validation profile, so this block never admits
 * JEV rows into the structured contract.
 */
const jevKindDigest = (kind: string): string => digestStructuredArtifact({ contract: 'jev-native', kind });
/** Byte limits are local admission limits, not claims about provider tokenization. */
export const jevDescriptor: DecisionEvaluatorDescriptor = {
  definition: {
    validationProfile: { profile: 'jev-native-v1', version: 'v1' },
    kinds: [{ kind: 'binary', schemaDigest: jevKindDigest('binary') },
      { kind: 'graded', schemaDigest: jevKindDigest('graded') },
      { kind: 'choice', schemaDigest: jevKindDigest('choice') }],
    evidenceRequirements: ['served-identity', 'reported-usage'],
    executionDigest: digestStructuredArtifact({ maxOutputTokens: 0 }),
    bundleDigest: digestStructuredArtifact({ contract: 'jev-native', readout: 'jev-native-v1' }),
  },
  evaluator: { providerId: 'typesafe', evaluatorId: 'jev-1.13.0', revision: 'jev-1.13.0-mesh-v1-unqualified' },
  wireModel: 'jev-1.13.0', acceptedServedModelIds: [],
  qualification: { servedIdentity: 'unqualified', billingBound: 'unqualified', evidenceRefs: [] },
  // JEV-BOUND-01 candidate only; qualification is required before financial admission.
  // JEV admits no billable output: the output rate must be zero, so the bound is 0.
  maxBillableInputTokens: 65_536, maxBillableOutputTokens: 0, maxRequestBytes: 256 * 1024, maxStateQuestionBytes: 32 * 1024,
  probabilityTolerance: 1e-4, scoreNativeKeys: 'index-string', nativeDecision: false,
  confidence: { meaning: 'provider-confidence', meaningRef: 'https://docs.typesafe.ai/confidence.md', min: 0, max: 1 },
  compilation: { templateDigest: '0'.repeat(64), schemaDigest: '1'.repeat(64), readout: 'jev-native-v1' },
  priceProtocol: { authority: 'control.model_pricing', revision: 'jev-1.13.0-standard-2026-10-28' },
  registeredCriteria: [],
  retention: { status: 'unknown', basis: 'published-policy', retentionDays: null,
    gap: 'unknown (source-gap)', evidenceRefs: ['https://docs.typesafe.ai/legal.md',
      'https://typesafe.ai/legal/data-processing', 'https://typesafe.ai/legal/privacy-policy'] },
};
