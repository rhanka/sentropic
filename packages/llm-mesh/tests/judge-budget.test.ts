import { describe, expect, it } from 'vitest';
import { quoteJudge, priceJudgeUsage } from '../src/judge/pricing.js';
import { normalizeJudgeUsage, unreportedJudgeUsage } from '../src/judge/receipt.js';
import { judgeRequest, qualifiedDescriptor } from './judge-fixtures.js';

export const price = () => ({ providerId: 'typesafe' as const, modelId: 'jev-1.13.0', priceRevision: 'fixture-price-v1',
  inputMicroUsdPerMtok: '42000', outputMicroUsdPerMtok: '0', minimumMicroUsd: '0', identityMismatchPricing: 'requested-model' as const });
describe('qualified integer judge liability', () => {
  it('reserves the qualified maximum and prices reported usage, including identity mismatch', () => {
    const result = quoteJudge(judgeRequest(), qualifiedDescriptor(), price());
    expect(result.ok && result.quote.reservedMicroUsd).toBe('2753');
    if (!result.ok) throw new Error('fixture quote');
    const usage = normalizeJudgeUsage({ inputTokens: 1000, outputTokens: 0, evaluatorCalls: 1, explanations: 0 })!;
    expect(priceJudgeUsage(usage, result.quote, true)).toMatchObject({ cost: { amountMicroUsd: '42', source: 'reported-usage-times-rate' }, pending: false });
    expect(priceJudgeUsage(unreportedJudgeUsage('unknown'), result.quote)).toMatchObject({ cost: { amountMicroUsd: '2753' }, pending: true });
  });
  it('refuses absent/wrong prices and unqualified/nonzero-output liability', () => {
    const d = qualifiedDescriptor();
    expect(quoteJudge(judgeRequest(), d, null)).toEqual({ ok: false, code: 'PRICING_UNAVAILABLE' });
    expect(quoteJudge(judgeRequest(), d, { ...price(), modelId: 'alias' }).ok).toBe(false);
    expect(quoteJudge(judgeRequest(), { ...d, qualification: { ...d.qualification, billingBound: 'unqualified' } }, price()))
      .toEqual({ ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' });
    expect(quoteJudge(judgeRequest(), d, { ...price(), outputMicroUsdPerMtok: '1' }).ok).toBe(false);
  });
  it('uses the stricter cap and an explicit minimum without floating point', () => {
    expect(quoteJudge(judgeRequest({ policy: { budget: { maxCostMicroUsd: '2752' } } }), qualifiedDescriptor(), price()).ok).toBe(false);
    expect(quoteJudge(judgeRequest(), qualifiedDescriptor(), price(), '2752').ok).toBe(false);
    const rate = '900719925474099312345';
    const d = { ...qualifiedDescriptor(), maxBillableInputTokens: 1 };
    const result = quoteJudge(judgeRequest(), d, { ...price(), inputMicroUsdPerMtok: rate });
    expect(result.ok && result.quote.reservedMicroUsd).toBe(((BigInt(rate) + 999999n) / 1000000n).toString());
    expect(quoteJudge(judgeRequest(), d, { ...price(), minimumMicroUsd: '99' })).toMatchObject({ quote: { reservedMicroUsd: '99' } });
  });
});
