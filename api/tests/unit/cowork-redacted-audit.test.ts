import { describe, expect, it } from 'vitest';

import { COWORK_AUDIT_REASONS, redactCoworkAudit, type CoworkAuditEvent } from '../../src/services/cowork/redacted-audit';

import { projectDeliveryScope, validCaptureResult } from '../../src/services/cowork/device-lease-service';

describe('Cowork redacted audit', () => {
  it('emits ids and outcome only, never action content, pixels, or secrets', () => {
    const event = redactCoworkAudit({ kind: 'lease_result', toolCallId: 'call', leaseId: 'lease', targetDeviceId: 'device', capability: 'input_action', outcome: 'FAIT' });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(/pixel|secret|password|typed|image/i);
    expect(event).toEqual({ kind: 'lease_result', toolCallId: 'call', leaseId: 'lease', targetDeviceId: 'device', capability: 'input_action', outcome: 'FAIT' });
  });

  it('cross-surface planted-marker test: asserts witness absence across delivery frame, capture ingestion, and audit lines (NEW-2 / J-3 / §3.5)', () => {
    const M_TEXT = 'WITNESS-TEXT-f89a2b7c';
    const M_SCOPE = 'WITNESS-SCOPE-9e41d83a';
    const M_CAPTURE = 'FAKE-SECRET-IMAGE-113355';

    // Surface 1: Delivery SSE / Poll Frame projection (projectDeliveryScope)
    const rawDeliveryScope = {
      capability: 'input_action' as const,
      serverEnvelope: { kid: 'oauth-key-1', mac: 'mac-proof-1' },
      action: { action: 'type', text: M_TEXT },
      // Planted witness markers in non-delivery fields
      invocation: {
        principalId: 'user-1', workspaceId: 'ws-1', sessionId: 'sess-1',
        targetDeviceId: 'dev-1', capability: 'input_action', actionHash: 'hash-1',
        secretNote: M_SCOPE,
      },
      metadata: { secret: M_SCOPE },
      result: { secret: M_CAPTURE },
      cancellationRequestedAt: '2026-09-12T00:00:00.000Z',
    };

    const deliveryFrame = projectDeliveryScope(rawDeliveryScope);
    expect(deliveryFrame).not.toBeNull();
    const serializedDelivery = JSON.stringify(deliveryFrame);

    // Negative invariants: M_SCOPE and M_CAPTURE must NOT be present in delivery frame
    expect(serializedDelivery).not.toContain(M_SCOPE);
    expect(serializedDelivery).not.toContain(M_CAPTURE);
    expect(deliveryFrame).not.toHaveProperty('invocation');
    expect(deliveryFrame).not.toHaveProperty('metadata');
    expect(deliveryFrame).not.toHaveProperty('result');
    expect(deliveryFrame).not.toHaveProperty('cancellationRequestedAt');

    // Positive controls: admitted field action.text MUST contain M_TEXT; frame key count == allowlist count (3)
    expect(deliveryFrame!.action).toEqual({ action: 'type', text: M_TEXT });
    expect(Object.keys(deliveryFrame!).sort()).toEqual(['action', 'capability', 'serverEnvelope']);
    expect(Object.keys(deliveryFrame!).length).toBe(3);

    // Surface 2: Device Capture Result Ingestion (validCaptureResult)
    const validPng = 'data:image/png;base64,QUJD';
    const smuggledMetadataCapture = {
      ok: true, screen: 0, width: 1920, height: 1080, image: validPng,
      metadata: { secret: M_CAPTURE },
    };
    const smuggledSecretFieldCapture = {
      ok: true, screen: 0, width: 1920, height: 1080, image: validPng,
      secret: M_CAPTURE,
    };
    const wellFormedCapture = {
      ok: true, screen: 0, width: 1920, height: 1080, image: validPng,
    };

    // Negative invariant: smuggled metadata/secret is rejected before ingestion/persistence
    expect(validCaptureResult(smuggledMetadataCapture, { action: 'screen_capture' })).toBe(false);
    expect(validCaptureResult(smuggledSecretFieldCapture, { action: 'screen_capture' })).toBe(false);

    // Positive controls: well-formed capture is accepted; allowed key count == exactly 5
    expect(validCaptureResult(wellFormedCapture, { action: 'screen_capture' })).toBe(true);
    expect(Object.keys(wellFormedCapture).sort()).toEqual(['height', 'image', 'ok', 'screen', 'width']);
    expect(Object.keys(wellFormedCapture).length).toBe(5);

    // Surface 3: Redacted Audit Line projection (redactCoworkAudit)
    const rawAuditEvent = {
      kind: 'lease_result' as const,
      toolCallId: 'call-planted-1',
      leaseId: 'lease-planted-1',
      targetDeviceId: 'device-planted-1',
      capability: 'input_action' as const,
      outcome: 'PAS-FAIT' as const,
      reason: 'quiescence_unconfirmed' as const,
      settled: 'unverified' as const,
      // Planted witness markers across candidate leak paths
      text: M_TEXT,
      action: { type: 'type', text: M_TEXT },
      scope: { metadata: { note: M_SCOPE } },
      result: { secret: M_CAPTURE },
      secret: M_CAPTURE,
    };

    const redactedAudit = redactCoworkAudit(rawAuditEvent as unknown as CoworkAuditEvent);
    const serializedAudit = JSON.stringify(redactedAudit);

    // Negative invariants: none of M_TEXT, M_SCOPE, M_CAPTURE present in audit output
    expect(serializedAudit).not.toContain(M_TEXT);
    expect(serializedAudit).not.toContain(M_SCOPE);
    expect(serializedAudit).not.toContain(M_CAPTURE);

    // Positive controls: benign identifiers present; emitted key count == allowlist count (8)
    expect(redactedAudit).toEqual({
      kind: 'lease_result',
      toolCallId: 'call-planted-1',
      leaseId: 'lease-planted-1',
      targetDeviceId: 'device-planted-1',
      capability: 'input_action',
      outcome: 'PAS-FAIT',
      reason: 'quiescence_unconfirmed',
      settled: 'unverified',
    });
    expect(Object.keys(redactedAudit).sort()).toEqual([
      'capability', 'kind', 'leaseId', 'outcome', 'reason', 'settled', 'targetDeviceId', 'toolCallId',
    ].sort());
    expect(Object.keys(redactedAudit).length).toBe(8);
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

