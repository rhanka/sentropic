import { describe, expect, it } from 'vitest';

import { redactCoworkAudit } from '../../src/services/cowork/redacted-audit';

describe('Cowork redacted audit', () => {
  it('emits ids and outcome only, never action content, pixels, or secrets', () => {
    const event = redactCoworkAudit({ kind: 'lease_result', toolCallId: 'call', leaseId: 'lease', targetDeviceId: 'device', capability: 'input_action', outcome: 'FAIT' });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(/pixel|secret|password|typed|image/i);
    expect(event).toEqual({ kind: 'lease_result', toolCallId: 'call', leaseId: 'lease', targetDeviceId: 'device', capability: 'input_action', outcome: 'FAIT' });
  });
});
