import { describe, expect, it } from 'vitest';
import { quoteDecision, priceDecisionUsage } from '../src/decision/pricing.js';
import { normalizeDecisionUsage, unreportedDecisionUsage } from '../src/decision/receipt.js';
import { decisionRequest, qualifiedDescriptor } from './decision-fixtures.js';

export const price = () => ({ providerId: 'typesafe' as const, modelId: 'jev-1.13.0', priceRevision: 'fixture-price-v1',
  inputMicroUsdPerMtok: '42000', outputMicroUsdPerMtok: '0', minimumMicroUsd: '0', identityMismatchPricing: 'requested-model' as const });
describe('qualified integer decision liability', () => {
  it('reserves the qualified maximum and prices reported usage, including identity mismatch', () => {
    const result = quoteDecision(decisionRequest(), qualifiedDescriptor(), price());
    expect(result.ok && result.quote.reservedMicroUsd).toBe('2753');
    if (!result.ok) throw new Error('fixture quote');
    const usage = normalizeDecisionUsage({ inputTokens: 1000, outputTokens: 0, evaluatorCalls: 1, explanations: 0 })!;
    expect(priceDecisionUsage(usage, result.quote, true)).toMatchObject({ cost: { amountMicroUsd: '42', source: 'reported-usage-times-rate' }, pending: false });
    expect(priceDecisionUsage(unreportedDecisionUsage('unknown'), result.quote)).toMatchObject({ cost: { amountMicroUsd: '2753' }, pending: true });
  });
  it('binds the admitted tariff to the descriptor price protocol (F4)', () => {
    const descriptor = qualifiedDescriptor();
    expect(quoteDecision(decisionRequest(), descriptor,
      { ...price(), priceRevision: 'foreign-protocol-price' }).ok).toBe(false);
    expect(quoteDecision(decisionRequest(), descriptor, price()).ok).toBe(true);
  });
  it('reserves protocol-aware output liability for structured backends (F3)', () => {
    const base = qualifiedDescriptor();
    const structured = { ...base, protocol: 'structured-llm' as const,
      evaluator: { ...base.evaluator, evaluatorId: 'structured-judge-v1' }, wireModel: 'structured-judge-v1' };
    const outputPrice = { ...price(), modelId: 'structured-judge-v1', outputMicroUsdPerMtok: '50000' };
    const quoted = quoteDecision(decisionRequest(), structured, outputPrice);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) throw new Error('structured quote failed');
    expect(BigInt(quoted.quote.reservedMicroUsd)).toBeGreaterThan(2753n);
    expect(quoteDecision(decisionRequest(), base, { ...price(), outputMicroUsdPerMtok: '1' }).ok).toBe(false);
  });
  it('refuses absent/wrong prices and unqualified/nonzero-output liability', () => {
    const d = qualifiedDescriptor();
    expect(quoteDecision(decisionRequest(), d, null)).toEqual({ ok: false, code: 'PRICING_UNAVAILABLE' });
    expect(quoteDecision(decisionRequest(), d, { ...price(), modelId: 'alias' }).ok).toBe(false);
    expect(quoteDecision(decisionRequest(), { ...d, qualification: { ...d.qualification, billingBound: 'unqualified' } }, price()))
      .toEqual({ ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' });
    expect(quoteDecision(decisionRequest(), d, { ...price(), outputMicroUsdPerMtok: '1' }).ok).toBe(false);
  });
  it('uses the stricter cap and an explicit minimum without floating point', () => {
    expect(quoteDecision(decisionRequest({ policy: { budget: { maxCostMicroUsd: '2752' } } }), qualifiedDescriptor(), price()).ok).toBe(false);
    expect(quoteDecision(decisionRequest(), qualifiedDescriptor(), price(), '2752').ok).toBe(false);
    const rate = '900719925474099312345';
    const d = { ...qualifiedDescriptor(), maxBillableInputTokens: 1 };
    const result = quoteDecision(decisionRequest(), d, { ...price(), inputMicroUsdPerMtok: rate });
    expect(result.ok && result.quote.reservedMicroUsd).toBe(((BigInt(rate) + 999999n) / 1000000n).toString());
    expect(quoteDecision(decisionRequest(), d, { ...price(), minimumMicroUsd: '99' })).toMatchObject({ quote: { reservedMicroUsd: '99' } });
  });
});
