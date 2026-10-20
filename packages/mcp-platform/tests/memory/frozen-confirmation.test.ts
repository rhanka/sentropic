import { describe, expect, it } from 'vitest';
import { checkOperationConfirmation, isWithinExecutionBudget } from '../../src/memory/confirmation.js';
import { confirmationInput } from './confirmation-fixture.js';

describe('co-frozen A06 confirmation', () => {
  it('accepts complete current binding', () => expect(checkOperationConfirmation(confirmationInput())).toEqual([]));
  it.each(['authenticated', 'enrolled_2fa', 'step_up_assurance_verified', 'issuer', 'approving_subject_sub',
    'enrollment_receipt_digest', 'step_up_2fa_receipt_digest'])( 'refuses missing assurance %s', key => {
    const input = confirmationInput(); delete input.continuation.assurance[key];
    expect(checkOperationConfirmation(input).length).toBeGreaterThan(0);
  });
  it.each(['caller_currently_authorized', 'target_currently_authorized', 'approver_currently_enrolled_2fa',
    'approver_not_revoked', 'approver_current_assurance_verified', 'host_deployment_qualified'])(
    'requires a separate literal true for %s', key => {
      for (const value of [false, undefined, null, 'true', 1, {}]) {
        const input = confirmationInput(); input.expected[key] = value;
        expect(checkOperationConfirmation(input).length).toBeGreaterThan(0);
      }
    },
  );
  it.each(['tenant_id', 'initiating_principal_id', 'store_id', 'scope_ref', 'agent_id', 'mcp_client_id',
    'active_generation', 'transport_attachment_ref', 'reservation_ref', 'operation_digest'])(
    'refuses current binding substitution of %s', key => {
      const input = confirmationInput(); input.expected[key] = 'substitution';
      expect(checkOperationConfirmation(input).length).toBeGreaterThan(0);
    },
  );
  it('refuses a future confirmation and reverse execution time', () => {
    const input = confirmationInput(); input.expected.now = '2026-10-17T23:59:59.000Z';
    expect(checkOperationConfirmation(input).length).toBeGreaterThan(0);
    expect(isWithinExecutionBudget('2026-10-18T00:00:20.000Z', '2026-10-18T00:00:10.000Z')).toBe(false);
  });
});
