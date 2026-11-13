import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionPrice } from './pricing.js';
import { digestStructuredArtifact as digest } from './validation.js';

const contract = 'gemini-decisions-v1beta';
const source = 'https://aistudio.google.com/docs/decisions-api';
/** Explicit host opt-in only. Published semantics do not qualify live identity or calibration. */
export const geminiDecisionsDescriptor: DecisionEvaluatorDescriptor = {
  evaluator: { providerId: 'gemini', evaluatorId: 'gemini-decision-1', revision: 'gemini-decision-1-v1beta-unqualified' },
  protocol: 'gemini-decisions', wireModel: 'gemini-decision-1', acceptedServedModelIds: ['gemini-decision-1'],
  qualification: { servedIdentity: 'unqualified', billingBound: 'unqualified', evidenceRefs: [source] },
  maxBillableInputTokens: 262_144, maxBillableOutputTokens: 0,
  maxRequestBytes: 256 * 1024, maxStateQuestionBytes: 32 * 1024,
  probabilityTolerance: 1e-4, scoreNativeKeys: 'index-string', nativeDecision: false,
  confidence: { meaning: 'provider-confidence', meaningRef: source + '#confidence', min: 0, max: 1 },
  compilation: { templateDigest: digest({ contract, input: 'json-data', question: 'verdict' }),
    schemaDigest: digest({ contract, answers: ['noul', 'choice', 'score'] }), readout: contract },
  definition: { validationProfile: { profile: 'native-distribution-v1', version: 'v1' },
    kinds: ['binary', 'choice', 'graded'].map((kind) => ({ kind, schemaDigest: digest({ contract, kind }) })),
    evidenceRequirements: ['served-identity', 'reported-usage', 'one-named-answer'],
    executionDigest: digest({ contract, attempts: 1, maxBillableInputTokens: 262_144, maxBillableOutputTokens: 0 }),
    bundleDigest: digest({ contract, qualification: 'unqualified', sourceDate: '2026-11-12' }) },
  priceProtocol: { authority: 'control.model_pricing', revision: 'gemini-decision-1-standard-2026-11-11' },
  registeredCriteria: [], retention: { status: 'unknown', basis: 'published-policy', retentionDays: null,
    gap: 'unknown (source-gap)',
    evidenceRefs: ['https://ai.google.dev/gemini-api/terms', source] },
};
export const geminiDecisionsPrice: DecisionPrice = {
  providerId: 'gemini', modelId: 'gemini-decision-1', priceRevision: geminiDecisionsDescriptor.priceProtocol.revision,
  authority: 'control.model_pricing', protocol: 'gemini-decisions', inputMicroUsdPerMtok: '100000',
  outputMicroUsdPerMtok: '0', minimumMicroUsd: '0', identityMismatchPricing: 'requires-reconciliation',
};
