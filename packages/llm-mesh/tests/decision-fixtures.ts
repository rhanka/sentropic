import { vi } from 'vitest';
import { createProviderRegistry } from '../src/registry.js';
import { createJevAdapter } from '../src/decision/adapter.js';
import type { DecisionServiceOptions } from '../src/decision/host-options.js';
import type { DecisionReceipt } from '../src/decision/receipt.js';
import type { DecisionRequest } from '../src/decision/request.js';
import { jevDescriptor } from '../src/decision/descriptor.js';
import { mintStructuredContractDigests, STRUCTURED_READOUT_IDENTITY } from '../src/decision/structured.js';

/** Synthetic qualification only: these IDs/evidence do not activate the built-in descriptor. */
export const qualifiedDescriptor = () => structuredClone({ ...jevDescriptor,
  executionProfile: 'qualification' as 'production' | 'qualification' | undefined,
  evaluator: { ...jevDescriptor.evaluator, revision: 'synthetic-v1' },
  acceptedServedModelIds: ['synthetic-served-model'],
  qualification: { servedIdentity: 'qualified' as const, billingBound: 'qualified' as const,
    evidenceRefs: ['fixture:synthetic-qualification'] },
});
export const decisionRequest = (overrides: Partial<DecisionRequest> = {}): DecisionRequest => ({
  schemaVersion: 1, evaluator: qualifiedDescriptor().evaluator,
  inputs: { output: 'synthetic candidate' }, criterion: { kind: 'binary', instructions: 'Check evidence.' },
  ...overrides,
});
export const jevResponse = (answer: unknown = { noul: 0.25 }) => ({
  model: 'synthetic-served-model', answers: { verdict: answer !== null && typeof answer === 'object'
    ? { type: 'noul' in answer ? 'noul' : 'score' in answer ? 'score' : 'choice', ...answer } : answer },
  usage: { input_tokens: 1000, output_tokens: 0 },
});
export const trustedNativeContext = (request: DecisionRequest) => {
  const kind = request.criterion.kind;
  const levels = kind === 'graded' ? request.criterion.levels.length : 0;
  const direction = kind === 'graded' ? request.criterion.direction : 'unordered';
  void direction;
  return {
    evaluator: { ...request.evaluator },
    validationProfile: { profile: 'native-distribution-v1' as const, version: 'v1' },
    acceptedServedModelIds: ['synthetic-served-model'],
    semantics: { nativeDecision: false,
      score: kind === 'graded'
        ? { meaning: 'rubric-grade', min: 0, max: Math.max(0, levels - 1) }
        : kind === 'choice'
          ? null
          : { meaning: 'probability-true', min: 0, max: 1 },
      confidence: kind === 'binary'
        ? null
        : { meaning: 'provider-confidence', meaningRef: 'https://docs.typesafe.ai/confidence.md', min: 0, max: 1 },
      rationale: 'forbidden' as const },
    definitionDigest: 'a'.repeat(64),
  };
};
export const decisionPrice = () => ({ providerId: 'typesafe' as const, modelId: 'jev-1.13.0', priceRevision: 'fixture-price-v1',
  inputMicroUsdPerMtok: '42000', outputMicroUsdPerMtok: '0', minimumMicroUsd: '0', identityMismatchPricing: 'requested-model' as const,
  authority: 'fixture:synthetic-tariff', protocol: 'jev-native' as const });

/**
 * Minted digest pair for one effective structured output budget. Fixtures
 * mint through the implementation helper so declared digests always bind
 * the artifacts the backend actually compiles and dispatches.
 */
export const structuredContractDigests = (maxOutputTokens = 4096) =>
  mintStructuredContractDigests({ maxOutputTokens, readout: STRUCTURED_READOUT_IDENTITY });
/** Refresh the digest-bound definition (and only it) when a test overrides the enforced output budget. */
export const withStructuredBudget = (descriptor: Record<string, unknown>, maxBillableOutputTokens: number) => {
  const compilation = (descriptor as { compilation: { readout: string } }).compilation;
  return { ...descriptor, maxBillableOutputTokens,
    definition: mintStructuredContractDigests({ maxOutputTokens: maxBillableOutputTokens,
      readout: compilation.readout }).definition };
};
/** Synthetic structured descriptor under the new contract: explicit enforced
 * output bound, declared scalar score semantics, qualified billing. */
export const structuredDecisionDescriptor = () => {
  const base = qualifiedDescriptor();
  const { definition, ...compilation } = structuredContractDigests();
  return { ...base, protocol: 'structured-llm' as const,
    evaluator: { ...base.evaluator, evaluatorId: 'structured-judge-v1' },
    wireModel: 'structured-judge-v1', scoreNativeKeys: 'scalar' as const,
    acceptedServedModelIds: ['synthetic-structured-model'],
    maxBillableOutputTokens: 4096,
    compilation: { ...compilation, readout: STRUCTURED_READOUT_IDENTITY },
    definition,
    scoreSemantics: { meaning: 'support', meaningRef: 'fixture:synthetic-scalar' },
    qualification: { servedIdentity: 'qualified' as const, billingBound: 'qualified' as const,
      evidenceRefs: ['fixture:synthetic-qualification'] },
    confidence: { meaning: 'support', meaningRef: 'fixture:structured-support', min: 0, max: 1 } };
};

/** Transport-reported evidence body for the structured contract: the score or
 * label plus independently validated served identity and usage counters. */
/**
 * Generated completion text: the verdict evidence only. Served identity and
 * reported usage never appear here; they travel in the provider envelope, so
 * any served/usage field in this text is spoofed content, not provenance.
 */
export const structuredEvidenceBody = (evidence: { score?: number; label?: string }) => JSON.stringify(
  evidence.score !== undefined ? { score: evidence.score } : { label: evidence.label },
);
/**
 * Provider envelope for one transport send: the generated text plus the
 * provider-side response metadata (served identity, reported counters).
 */
export const structuredEvidenceEnvelope = (text: string,
  servedModelId = 'synthetic-structured-model',
  usage: { inputTokens: number; outputTokens: number } = { inputTokens: 100, outputTokens: 5 }) => ({
  text,
  served: { modelId: servedModelId },
  usage: { ...usage },
});

export const structuredDecisionPrice = (modelId = 'structured-judge-v1') => ({
  providerId: 'typesafe' as const, modelId, priceRevision: 'fixture-price-v1',
  inputMicroUsdPerMtok: '42000', outputMicroUsdPerMtok: '50000',
  minimumMicroUsd: '0', identityMismatchPricing: 'requested-model' as const,
  authority: 'fixture:synthetic-tariff', protocol: 'structured-llm' as const });

/** Test-only linearized durable-port model; never a production financial authority. */
export function decisionServiceFixture() {
  const descriptor = qualifiedDescriptor();
  const state = { now: 0, disabled: new Set<string>(), ledger: [] as DecisionReceipt[], receipts: [] as DecisionReceipt[] };
  const key = (ref: { providerId: string; evaluatorId: string; revision: string }) => JSON.stringify(ref);
  const transport = { send: vi.fn().mockResolvedValue({ ok: true, body: jevResponse() }) };
  const adapter = createJevAdapter({ descriptor, transport });
  const budget = {
    admit: vi.fn(async (input) => state.disabled.has(key(input.evaluator))
      ? { ok: false as const, code: 'PROVIDER_UNAVAILABLE' as const } : { ok: true as const, holdId: input.callId }),
    markDispatched: vi.fn(async (input) => state.disabled.has(key(input.evaluator))
      ? { ok: false as const, code: 'PROVIDER_UNAVAILABLE' as const, provenUnsent: true } : { ok: true as const }),
    release: vi.fn(async () => {}),
    settle: vi.fn(async (input) => {
      state.ledger.push(input.receipt);
      if (input.boundViolated) state.disabled.add(key(input.receipt.evaluator));
    }),
  };
  const options: DecisionServiceOptions = { registry: createProviderRegistry([adapter]), resolveEvaluator: () => descriptor,
    evaluatorAllowlist: [{ ...descriptor.evaluator }],
    resolvePrice: vi.fn(() => decisionPrice()), authorize: vi.fn(async () => true), budget,
    resolveAuth: vi.fn(async () => ({ material: { type: 'environment-token', envVar: 'JEV_API_KEY', token: 'synthetic-secret-canary' },
      descriptor: { sourceType: 'environment-token' } })),
    receipts: { persist: vi.fn(async (receipt) => { state.receipts.push(receipt); }) },
    clock: { wall: () => 1700000000000 + state.now, monotonic: () => state.now } };
  return { options, descriptor, transport, adapter, budget, state };
}
