import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionPrice } from './pricing.js';
import { digestStructuredArtifact } from './validation.js';

const contract = 'openai-decisions-v1';
const digest = (value: unknown) => digestStructuredArtifact(value);
/** Live account access observed in Q1; stable selection and calibration remain unverified. */
export const openAiDecisionsDescriptor: DecisionEvaluatorDescriptor = {
  evaluator: { providerId: 'openai', evaluatorId: 'gpt-6-luna-decisions', revision: 'gpt-6-luna-decisions-v1-unqualified' },
  protocol: 'openai-decisions', wireModel: 'gpt-6-luna', acceptedServedModelIds: ['gpt-6-luna'],
  qualification: { servedIdentity: 'unqualified', billingBound: 'unqualified',
    evidenceRefs: ['spec/decision/q1-live-smoke.md#openai-decisions'] },
  maxBillableInputTokens: 2048, maxBillableOutputTokens: 0,
  maxRequestBytes: 256 * 1024, maxStateQuestionBytes: 32 * 1024,
  probabilityTolerance: 1e-4, scoreNativeKeys: 'index-string', nativeDecision: false,
  confidence: { meaning: 'provider-confidence',
    meaningRef: 'https://developers.openai.com/api/docs/guides/decisions#interpret-the-answers', min: 0, max: 1 },
  compilation: { templateDigest: digest({ contract, input: 'json-data', question: 'verdict', cache: 'disabled' }),
    schemaDigest: digest({ contract, answers: ['predicate', 'choice', 'score', 'refusal'] }), readout: contract },
  definition: { validationProfile: { profile: 'native-distribution-v1', version: 'v1' },
    kinds: ['binary', 'choice', 'graded'].map((kind) => ({ kind, schemaDigest: digest({ contract, kind }) })),
    evidenceRequirements: ['served-identity', 'reported-usage', 'one-named-answer'],
    executionDigest: digest({ contract, attempts: 1, cache: 'disabled', maxBillableInputTokens: 2048, maxBillableOutputTokens: 0 }),
    bundleDigest: digest({ contract, qualification: 'unqualified', sourceDate: '2026-10-26' }) },
  priceProtocol: { authority: 'control.model_pricing', revision: 'openai-decisions-standard-no-cache-2026-10-26' },
  registeredCriteria: [], retention: { status: 'unknown', basis: 'published-policy', retentionDays: null,
    gap: 'unknown (source-gap)', evidenceRefs: ['https://developers.openai.com/api/docs/guides/your-data'] },
};

/** Published standard/no-cache rate projection; the host must supply its authoritative row. */
export const openAiDecisionsPrice: DecisionPrice = {
  providerId: 'openai', modelId: 'gpt-6-luna', ...{ priceRevision: openAiDecisionsDescriptor.priceProtocol.revision },
  authority: 'control.model_pricing', protocol: 'openai-decisions', inputMicroUsdPerMtok: '100000',
  outputMicroUsdPerMtok: '0', minimumMicroUsd: '0', identityMismatchPricing: 'requires-reconciliation',
};
