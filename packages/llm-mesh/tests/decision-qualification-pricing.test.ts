import { describe, expect, it } from 'vitest';
import { priceDecisionUsage, quoteDecision } from '../src/decision/pricing.js';
import { unreportedDecisionUsage } from '../src/decision/receipt.js';
import { normalizeDecisionUsage } from '../src/decision/receipt.js';
import { decisionPrice, decisionRequest, qualifiedDescriptor } from './decision-fixtures.js';

describe('protocol-specific qualification liability', () => {
  it('should round the total priced work once per receipt before aggregation', () => {
    const d = { ...qualifiedDescriptor(), protocol: 'structured-llm' as const,
      maxBillableInputTokens: 1, maxBillableOutputTokens: 1 };
    const quoted = quoteDecision(decisionRequest(), d, { ...decisionPrice(), protocol: 'structured-llm',
      inputMicroUsdPerMtok: '1', outputMicroUsdPerMtok: '1' });
    expect(quoted).toMatchObject({ ok: true, quote: { reservedMicroUsd: '1' } });
    if (!quoted.ok) return;
    const usage = normalizeDecisionUsage({ inputTokens: 1, outputTokens: 1, evaluatorCalls: 1, explanations: 0 })!;
    expect(priceDecisionUsage(usage, quoted.quote)).toMatchObject({ cost: { amountMicroUsd: '1' } });
  });
  it('should refuse a price collision or a missing input bound before quoting', () => {
    const d = qualifiedDescriptor();
    expect(quoteDecision(decisionRequest(), d, { ...decisionPrice(), protocol: 'openai-decisions' }))
      .toEqual({ ok: false, code: 'PRICING_UNAVAILABLE' });
    d.maxBillableInputTokens = undefined as never;
    expect(quoteDecision(decisionRequest(), d, decisionPrice()))
      .toEqual({ ok: false, code: 'BUDGET_BOUND_UNAVAILABLE' });
  });
  it('should use a qualified local per-call bound without inventing token usage', () => {
    const d = { ...qualifiedDescriptor(), protocol: 'systemone-local' as const };
    const price = { ...decisionPrice(), protocol: 'systemone-local' as const, billingMode: 'call-rate',
      inputMicroUsdPerMtok: '0', minimumMicroUsd: '117' };
    const quoted = quoteDecision(decisionRequest(), d, price);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.quote.reservedMicroUsd).toBe('117');
    expect(priceDecisionUsage(unreportedDecisionUsage('unknown'), quoted.quote)).toMatchObject({ pending: false,
      cost: { status: 'estimated', source: 'call-rate', amountMicroUsd: '117' } });
    expect(quoteDecision(decisionRequest(), d, { ...price, inputMicroUsdPerMtok: '1' }).ok).toBe(false);
  });
});
