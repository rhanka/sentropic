import { describe, expect, it } from 'vitest';

const loadBudget = () => import('../utils/nano-qualification-budget');

describe('paired nano qualification admission', () => {
  it('should arm only the exact standalone qualification scope', async () => {
    const { qualificationSelected } = await loadBudget();
    expect(qualificationSelected(' tests/ai/nano-replacement-qualification.test.ts ')).toBe(true);
    for (const scope of [undefined, '', 'tests/ai', 'tests/ai/nano-replacement-qualification.test.ts other.test.ts']) {
      expect(qualificationSelected(scope)).toBe(false);
    }
  });

  it('should reserve the documented maximum admitted input before a physical send', async () => {
    const { createNanoBudget } = await loadBudget();
    const events: unknown[] = [];
    const budget = createNanoBudget((event) => events.push(event));
    const ticket = budget.reserve('gpt-5.6-luna', 25_000);
    expect(ticket.reservedMicroUsd).toBe(506_000);
    expect(events).toHaveLength(1);
    budget.settle(ticket, { input: 704_000, output: 200, reasoning: 0, cached: 0 });
    expect(budget.snapshot().chargedMicroUsd).toBeLessThan(ticket.reservedMicroUsd);
    expect(budget.snapshot().calls).toBe(1);
  });

  it('should refuse admission before crossing the shared A+B dollar or call limit', async () => {
    const { createNanoBudget } = await loadBudget();
    const events: unknown[] = [];
    expect(() => createNanoBudget((event) => events.push(event), 0.01).reserve('gpt-6-luna', 32)).toThrow(/budget/i);
    expect(events).toHaveLength(0);
    const budget = createNanoBudget(() => undefined, 15, 1);
    const ticket = budget.reserve('gpt-6-luna', 32);
    budget.settle(ticket, { input: 100, output: 10, reasoning: 0, cached: 0 });
    expect(() => budget.reserve('gpt-5.6-luna', 64)).toThrow(/limit/i);
  });

  it.each([null, { input: 100, output: 10 }])('should retain reservations and stop on missing usage %j or cancellation', async (usage) => {
    const { createNanoBudget } = await loadBudget();
    const budget = createNanoBudget(() => undefined);
    const ticket = budget.reserve('gpt-6-luna', 32);
    expect(() => budget.settle(ticket, usage as any)).toThrow(/usage/i);
    expect(budget.snapshot().chargedMicroUsd).toBe(ticket.reservedMicroUsd);
    expect(() => budget.reserve('gpt-5.6-luna', 32)).toThrow(/closed/i);
    const cancelled = createNanoBudget(() => undefined);
    const pending = cancelled.reserve('gpt-6-luna', 32);
    cancelled.close();
    expect(cancelled.snapshot().chargedMicroUsd).toBe(pending.reservedMicroUsd);
  });

  it('should stop before sending when the durable reservation cannot be written', async () => {
    const { createNanoBudget } = await loadBudget();
    const budget = createNanoBudget(() => { throw new Error('disk full'); });
    expect(() => budget.reserve('gpt-6-luna', 32)).toThrow(/journal/i);
    expect(() => budget.reserve('gpt-5.6-luna', 32)).toThrow(/closed/i);
  });

  it('should include reasoning in output once and apply the full-request long-input tariff', async () => {
    const { priceNanoUsage } = await loadBudget();
    expect(priceNanoUsage('gpt-6-luna', { input: 1000, output: 100, reasoning: 20, cached: 0 })).toBeCloseTo(0.00015);
    expect(priceNanoUsage('gpt-5.6-luna', { input: 300_000, output: 100, reasoning: 0, cached: 0 })).toBeCloseTo(0.12018);
  });
});
