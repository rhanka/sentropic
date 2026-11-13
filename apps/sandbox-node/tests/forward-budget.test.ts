import { describe, expect, it } from 'vitest';
import { ForwardBudget } from '../src/forward-budget.js';

describe('agent-wide forwarding budget', () => {
  it('should queue a burst, admit after release and refuse saturation with a contract error', async () => {
    const budget = new ForwardBudget(2, 1);
    const first = await budget.acquire(), second = await budget.acquire();
    const waiting = budget.acquire();
    await expect(budget.acquire()).rejects.toMatchObject({ code: 'ports_saturated', status: 429 });
    first(); const third = await waiting;
    await expect(budget.acquire()).rejects.toMatchObject({ code: 'ports_saturated', retryAfterMs: 100 });
    second(); third();
    (await budget.acquire())();
  });
  it.each([0, 9, NaN, 1.5])('should reject an unsafe helper cap (%s)', cap => {
    expect(() => new ForwardBudget(cap)).toThrow('1..8');
  });
});
