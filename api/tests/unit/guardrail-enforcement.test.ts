import { describe, expect, it } from 'vitest';
import { classifyGuardrailDecision } from '../../src/services/todo-runtime';

describe('guardrail decision classification', () => {
  it('returns allow when no violation or inactive guardrail', () => {
    expect(
      classifyGuardrailDecision({
        category: 'scope',
        violated: false,
      }),
    ).toBe('allow');

    expect(
      classifyGuardrailDecision({
        category: 'safety',
        violated: true,
        isActive: false,
      }),
    ).toBe('allow');
  });

  it('blocks scope and safety violations', () => {
    expect(
      classifyGuardrailDecision({
        category: 'scope',
        violated: true,
      }),
    ).toBe('block');

    expect(
      classifyGuardrailDecision({
        category: 'safety',
        violated: true,
      }),
    ).toBe('block');
  });

  it('requires approval for approval or quality violations', () => {
    expect(
      classifyGuardrailDecision({
        category: 'approval',
        violated: true,
      }),
    ).toBe('needs_approval');

    expect(
      classifyGuardrailDecision({
        category: 'quality',
        violated: true,
      }),
    ).toBe('needs_approval');
  });

  it('allows approval and quality transitions once approval is granted', () => {
    expect(
      classifyGuardrailDecision({
        category: 'approval',
        violated: true,
        approvalGranted: true,
      }),
    ).toBe('allow');

    expect(
      classifyGuardrailDecision({
        category: 'quality',
        violated: true,
        approvalGranted: true,
      }),
    ).toBe('allow');
  });
});
