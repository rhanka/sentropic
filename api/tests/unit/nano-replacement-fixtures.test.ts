import { describe, expect, it } from 'vitest';
import { LONG_FACTS, LONG_QUESTIONS, NANO_CASES, makeLongFixture } from '../ai/nano-replacement-fixtures';

describe('sealed paired qualification fixtures', () => {
  it('should exercise nineteen upstream requests per candidate across all five classes', () => {
    expect(new Set(NANO_CASES.map((fixture) => fixture.kind)).size).toBe(5);
    const requests = NANO_CASES.reduce((count, fixture) => count +
      (fixture.kind === 'tool_json' || (fixture.kind === 'history_document' && fixture.singlePassLimit === 1) ? 2 : 1), 0);
    expect(requests).toBe(19);
  });
  it('should place document facts throughout the full input without leaking answers into questions', () => {
    const document = makeLongFixture(699_000);
    expect(document.length).toBe(699_000 * 4);
    expect(document.indexOf(LONG_FACTS[0])).toBeLessThan(100);
    expect(document.indexOf(LONG_FACTS[2]) / document.length).toBeCloseTo(0.5, 2);
    expect(document.indexOf(LONG_FACTS[3]) / document.length).toBeGreaterThan(0.99);
    for (const fact of LONG_FACTS) expect(LONG_QUESTIONS).not.toContain(fact);
  });
});
