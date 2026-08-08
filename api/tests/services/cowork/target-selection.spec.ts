import { describe, expect, it } from 'vitest';

import { CoworkTargetSelectionStore } from '../../../src/services/cowork/target-selection';

describe('Cowork target selection attestation', () => {
  it('rejects claimed isolation and kiosk flags unless the server attestation approves the key', async () => {
    const selection = new CoworkTargetSelectionStore({
      requireWorkspaceAccess: async () => undefined,
      findDevice: async () => ({ id: 'device', userId: 'user', publicKey: 'key', status: 'active', capabilities: {
        capabilityIds: ['screen_capture', 'input_action'], isolatedVmTarget: true, kioskSurface: 'powershell',
      } }),
      isAttested: async () => false,
      hasExposure: async () => true,
    });
    await expect(selection.select({ userId: 'user', workspaceId: 'workspace', sessionId: 'session', deviceId: 'device', selectedAt: Date.now() })).resolves.toBe(false);
  });

  it('accepts only an attested device with a pre-existing exposure grant', async () => {
    const selection = new CoworkTargetSelectionStore({
      requireWorkspaceAccess: async () => undefined,
      findDevice: async () => ({ id: 'device', userId: 'user', publicKey: 'key', status: 'active', capabilities: { capabilityIds: [] } }),
      isAttested: async () => true,
      hasExposure: async () => true,
    });
    await expect(selection.select({ userId: 'user', workspaceId: 'workspace', sessionId: 'session', deviceId: 'device', selectedAt: Date.now() })).resolves.toBe(true);
  });
});
