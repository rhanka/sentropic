import { describe, expect, it } from 'vitest';
import { checkOperationConfirmation, isWithinExecutionBudget } from '../../src/memory/confirmation.js';
import { confirmationInput } from './confirmation-fixture.js';

describe('P07.platform.confirmation', () => {
  it('accepts 300s TTL and refuses 301s', () => {
    const input = confirmationInput(); expect(checkOperationConfirmation(input)).toEqual([]);
    input.continuation.expires_at = '2026-10-18T00:05:01.000Z';
    expect(checkOperationConfirmation(input).join(' ')).toMatch(/ttl/);
  });
  it('allows expiry minus 1ms and refuses the exact expiry instant', () => {
    const input = confirmationInput(); input.expected.now = '2026-10-18T00:04:59.999Z';
    input.expected.execution_deadline_at = input.continuation.expires_at;
    expect(checkOperationConfirmation(input)).toEqual([]);
    input.expected.now = input.continuation.expires_at;
    expect(checkOperationConfirmation(input).join(' ')).toMatch(/expiry/);
  });
  it('admits a 30s execution budget and refuses 31s', () => {
    const input = confirmationInput(); expect(checkOperationConfirmation(input)).toEqual([]);
    input.expected.execution_deadline_at = '2026-10-18T00:00:51.000Z';
    expect(checkOperationConfirmation(input).join(' ')).toMatch(/execution/);
    expect(isWithinExecutionBudget('2026-10-18T00:00:10.000Z', '2026-10-18T00:00:40.000Z')).toBe(true);
    expect(isWithinExecutionBudget('2026-10-18T00:00:10.000Z', '2026-10-18T00:00:41.000Z')).toBe(false);
  });
  it('requires authenticated reattachment of the same logical session and generation', () => {
    const input = confirmationInput(); input.expected.transport_attachment_ref = 'attachment-2';
    expect(checkOperationConfirmation(input).length).toBeGreaterThan(0);
    input.continuation.reattachment_proof = { previous_attachment_ref: 'attachment-1', current_attachment_ref: 'attachment-2',
      reattachment_receipt_digest: 'sha256:' + 'd'.repeat(64), verified: true, admitted_generation: '1' };
    expect(checkOperationConfirmation(input)).toEqual([]);
    input.continuation.reattachment_proof.verified = 'true';
    expect(checkOperationConfirmation(input).length).toBeGreaterThan(0);
  });
});
