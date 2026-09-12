import { describe, expect, it } from 'vitest';

import { COWORK_AUDIT_REASONS, redactCoworkAudit, type CoworkAuditEvent } from '../../src/services/cowork/redacted-audit';

describe('Cowork redacted audit', () => {
  it('emits ids and outcome only, never action content, pixels, or secrets', () => {
    const event = redactCoworkAudit({ kind: 'lease_result', toolCallId: 'call', leaseId: 'lease', targetDeviceId: 'device', capability: 'input_action', outcome: 'FAIT' });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(/pixel|secret|password|typed|image/i);
    expect(event).toEqual({ kind: 'lease_result', toolCallId: 'call', leaseId: 'lease', targetDeviceId: 'device', capability: 'input_action', outcome: 'FAIT' });
  });

  it('planted-marker test: drops sensitive witness markers while preserving allowlisted fields (J-3, J-4)', () => {
    const M_TEXT = 'WITNESS-TEXT-f89a2b7c';
    const M_SCOPE = 'WITNESS-SCOPE-9e41d83a';
    const M_CAPTURE = 'FAKE-SECRET-IMAGE-113355';

    const rawEvent = {
      kind: 'lease_result' as const,
      toolCallId: 'call-planted-1',
      leaseId: 'lease-planted-1',
      targetDeviceId: 'device-planted-1',
      capability: 'input_action' as const,
      outcome: 'PAS-FAIT' as const,
      reason: 'quiescence_unconfirmed' as const,
      settled: 'unverified' as const,
      // Injected witness secrets
      text: M_TEXT,
      metadata: { note: M_SCOPE },
      secret: M_CAPTURE,
      action: { type: 'type', text: M_TEXT },
    };

    const redacted = redactCoworkAudit(rawEvent as unknown as CoworkAuditEvent);
    const serialized = JSON.stringify(redacted);

    // Negative invariants: witness markers MUST NOT be present
    expect(serialized).not.toContain(M_TEXT);
    expect(serialized).not.toContain(M_SCOPE);
    expect(serialized).not.toContain(M_CAPTURE);

    // Positive controls: allowlisted keys and benign identifiers MUST be present
    expect(redacted).toEqual({
      kind: 'lease_result',
      toolCallId: 'call-planted-1',
      leaseId: 'lease-planted-1',
      targetDeviceId: 'device-planted-1',
      capability: 'input_action',
      outcome: 'PAS-FAIT',
      reason: 'quiescence_unconfirmed',
      settled: 'unverified',
    });
    expect(Object.keys(redacted).sort()).toEqual([
      'capability',
      'kind',
      'leaseId',
      'outcome',
      'reason',
      'settled',
      'targetDeviceId',
      'toolCallId',
    ].sort());
  });

  it('validates closed reason enum and drops unknown/free-text reasons (J-4)', () => {
    // Valid reason
    const valid = redactCoworkAudit({
      kind: 'lease_result',
      toolCallId: 'call-1',
      capability: 'input_action',
      reason: 'stop_controller',
    });
    expect(valid.reason).toBe('stop_controller');

    // Unknown/unlisted free text reason
    const invalid = redactCoworkAudit({
      kind: 'lease_result',
      toolCallId: 'call-2',
      capability: 'input_action',
      // @ts-expect-error test unlisted reason
      reason: 'unrecognized_free_text_reason',
    });
    expect(invalid.reason).toBeUndefined();

    // Verify all 16 spec reasons exist in the closed enum
    const expectedReasons = [
      'timeout', 'offline', 'denied', 'mismatch', 'replay', 'malformed',
      'stop_local', 'stop_controller', 'expired', 'surface_guard',
      'invalid_signature', 'not_issuable', 'exposure_revoked', 'device_deleted',
      'quiescence_unconfirmed', 'fault',
    ];
    expect(COWORK_AUDIT_REASONS).toEqual(expect.arrayContaining(expectedReasons));
    expect(COWORK_AUDIT_REASONS.length).toBe(16);
  });
});

