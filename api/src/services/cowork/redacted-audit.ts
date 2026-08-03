export type CoworkAuditEvent = {
  kind: 'lease_issued' | 'lease_result' | 'lease_denied';
  toolCallId: string;
  leaseId?: string;
  targetDeviceId?: string;
  capability: 'screen_capture' | 'input_action';
  outcome?: 'FAIT' | 'PAS-FAIT';
};

/** I2 audit projection: ids and result state only — never pixels, text, or secrets. */
export function redactCoworkAudit(event: CoworkAuditEvent): Record<string, string> {
  return {
    kind: event.kind,
    toolCallId: event.toolCallId,
    capability: event.capability,
    ...(event.leaseId ? { leaseId: event.leaseId } : {}),
    ...(event.targetDeviceId ? { targetDeviceId: event.targetDeviceId } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
  };
}
