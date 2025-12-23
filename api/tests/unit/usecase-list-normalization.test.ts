import { describe, it, expect } from 'vitest';
import { normalizeStringListField } from '../../src/services/context-usecase';

describe('normalizeStringListField', () => {
  it('removes marker-only entries (e.g. "-") and empty strings', () => {
    const out = normalizeStringListField(['-', '  ', '\n', ' **OK**  ', ' - ']);
    expect(out).toEqual(['**OK**']);
  });

  it('strips a single leading bullet/number prefix from each item', () => {
    const out = normalizeStringListField(['- **A**', '* B', '1. C', '• D', '  -   E  ']);
    expect(out).toEqual(['**A**', 'B', 'C', 'D', 'E']);
  });

  it('does not strip hyphens that are not list markers (e.g. negative numbers)', () => {
    const out = normalizeStringListField(['-5% baisse', '--not-a-bullet', '-_underscore']);
    expect(out).toEqual(['-5% baisse', '--not-a-bullet', '-_underscore']);
  });

  it('splits multi-line markdown bullet blocks into separate array items', () => {
    const out = normalizeStringListField('- A\n- B\n- C');
    expect(out).toEqual(['A', 'B', 'C']);
  });

  it('keeps continuation lines attached to the previous bullet item', () => {
    const out = normalizeStringListField('- A line\n  continuation\n- B');
    expect(out).toEqual(['A line\ncontinuation', 'B']);
  });

  it('drops standalone "-" lines even when mixed in multi-line input', () => {
    const out = normalizeStringListField('-\n- A\n-\n- B');
    expect(out).toEqual(['A', 'B']);
  });
});


