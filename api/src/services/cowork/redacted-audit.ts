export const COWORK_AUDIT_REASONS = [
  'timeout',
  'offline',
  'denied',
  'mismatch',
  'replay',
  'malformed',
  'stop_local',
  'stop_controller',
  'expired',
  'surface_guard',
  'invalid_signature',
  'not_issuable',
  'exposure_revoked',
  'device_deleted',
  'quiescence_unconfirmed',
  'fault',
] as const;

export type CoworkAuditReason = typeof COWORK_AUDIT_REASONS[number];

export type CoworkAuditEvent = {
  kind: 'lease_issued' | 'lease_result' | 'lease_denied' | 'lease_settled_late' | 'schema_violation';
  toolCallId: string;
  leaseId?: string;
  targetDeviceId?: string;
  capability: 'screen_capture' | 'input_action';
  outcome?: 'FAIT' | 'PAS-FAIT';
  reason?: CoworkAuditReason;
  settled?: 'attested' | 'unverified' | 'not_started';
  path?: string;
};

/** I2 audit projection: ids and result state only — never pixels, text, or secrets. */
export function redactCoworkAudit(event: CoworkAuditEvent & Record<string, unknown>): Record<string, string> {
  return {
    kind: event.kind,
    toolCallId: event.toolCallId,
    capability: event.capability,
    ...(event.leaseId ? { leaseId: event.leaseId } : {}),
    ...(event.targetDeviceId ? { targetDeviceId: event.targetDeviceId } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
    ...(event.reason && (COWORK_AUDIT_REASONS as readonly string[]).includes(event.reason) ? { reason: event.reason } : {}),
    ...(event.settled && ['attested', 'unverified', 'not_started'].includes(event.settled) ? { settled: event.settled } : {}),
    ...(event.path ? { path: event.path } : {}),
  };
}

