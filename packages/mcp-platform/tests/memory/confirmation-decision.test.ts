import { describe, expect, it } from 'vitest';
import * as confirmation from '../../src/memory/confirmation.js';
import { confirmationInput } from './confirmation-fixture.js';
describe('A06 durable confirmation decision', () => {
  it('distinguishes committed disclosure from permission for a first effect', () => {
    const input = confirmationInput(); input.expected.reservation_state = 'committed';
    input.expected.now = '2026-10-18T00:06:00.000Z';
    const verify = (confirmation as any).verifyMemoryConfirmationContinuationV1;
    expect(typeof verify).toBe('function');
    expect(verify(input.continuation, input.expected)).toMatchObject({ ok: true, decision: 'disclose_committed_without_repeat_effect' });
    expect(confirmation.checkOperationConfirmation(input).length).toBeGreaterThan(0);
  });
  it('keeps unknown reservation outcomes outside effect authorization', () => {
    const input = confirmationInput(); input.expected.reservation_state = 'unknown';
    const verify = (confirmation as any).verifyMemoryConfirmationContinuationV1;
    expect(typeof verify).toBe('function');
    expect(verify(input.continuation, input.expected)).toMatchObject({ ok: false, error_code: 'MUTATION_OUTCOME_UNKNOWN' });
  });
});
