/**
 * composer-autosize.spec.ts — Node unit tests for the pure auto-grow helper.
 *
 * Tests: computeAutosizeResult edge cases and core behavior.
 * Environment: node (existing test-chat-ui target; no jsdom needed).
 * P6 radar — additive, no Svelte dependency.
 */
import { describe, expect, it } from 'vitest';

import { computeAutosizeResult } from '../src/utils/composer-autosize.js';

describe('computeAutosizeResult — base behavior', () => {
  it('should return baseHeight as maxHeight when content fits in one line', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 0,
      contentHeight: 40,
      wasMultiline: false,
    });
    expect(result.maxHeight).toBe(40);
    expect(result.isMultiline).toBe(false);
  });

  it('should detect multiline when contentHeight > baseHeight + 2', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 0,
      contentHeight: 80,
      wasMultiline: false,
    });
    expect(result.isMultiline).toBe(true);
  });

  it('should NOT detect multiline at the exact boundary (contentHeight = baseHeight + 2)', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 0,
      contentHeight: 42,
      wasMultiline: false,
    });
    // 42 > 40 + 2 is false (42 > 42 is false)
    expect(result.isMultiline).toBe(false);
  });

  it('should detect multiline when contentHeight is just above the boundary', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 0,
      contentHeight: 43,
      wasMultiline: false,
    });
    expect(result.isMultiline).toBe(true);
  });
});

describe('computeAutosizeResult — containerHeight cap', () => {
  it('should cap maxHeight at 30% of containerHeight when containerHeight is set', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 600,
      contentHeight: 200,
      wasMultiline: false,
    });
    // 30% of 600 = 180; max(40, 180) = 180
    expect(result.maxHeight).toBe(180);
  });

  it('should use baseHeight as floor when containerHeight cap is smaller', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 80,
      contentHeight: 50,
      wasMultiline: false,
    });
    // 30% of 80 = 24; max(40, 24) = 40
    expect(result.maxHeight).toBe(40);
  });

  it('should grow with content when containerHeight is 0 (unconstrained)', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 0,
      contentHeight: 120,
      wasMultiline: false,
    });
    // Unconstrained: maxHeight = max(baseHeight, contentHeight)
    expect(result.maxHeight).toBe(120);
  });
});

describe('computeAutosizeResult — shouldRemeasure', () => {
  it('should set shouldRemeasure=true when transitioning from single-line to multiline', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 0,
      contentHeight: 80,
      wasMultiline: false,
    });
    expect(result.shouldRemeasure).toBe(true);
  });

  it('should set shouldRemeasure=true when transitioning from multiline to single-line', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 0,
      contentHeight: 40,
      wasMultiline: true,
    });
    expect(result.shouldRemeasure).toBe(true);
  });

  it('should set shouldRemeasure=false when multiline state is unchanged', () => {
    const stable = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: 0,
      contentHeight: 80,
      wasMultiline: true,
    });
    expect(stable.shouldRemeasure).toBe(false);
  });
});

describe('computeAutosizeResult — defensive guards', () => {
  it('should fall back to 40px when baseHeight is 0', () => {
    const result = computeAutosizeResult({
      baseHeight: 0,
      containerHeight: 0,
      contentHeight: 0,
      wasMultiline: false,
    });
    expect(result.maxHeight).toBeGreaterThanOrEqual(40);
  });

  it('should fall back to 40px when baseHeight is NaN', () => {
    const result = computeAutosizeResult({
      baseHeight: NaN,
      containerHeight: 0,
      contentHeight: 0,
      wasMultiline: false,
    });
    expect(result.maxHeight).toBeGreaterThanOrEqual(40);
  });

  it('should treat negative containerHeight as 0 (unconstrained)', () => {
    const result = computeAutosizeResult({
      baseHeight: 40,
      containerHeight: -100,
      contentHeight: 80,
      wasMultiline: false,
    });
    // Treated as unconstrained; maxHeight = max(40, 80) = 80
    expect(result.maxHeight).toBe(80);
  });
});
