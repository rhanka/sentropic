import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { db } from '../../src/db/client';
import { coworkDevicePresence, coworkDeviceProvisioning, coworkDevices } from '../../src/db/schema';
import { fingerprintDevicePublicKey } from '../../src/services/cowork/device-identity';
import type { CoworkDeviceCapabilities } from '../../src/services/cowork/device-capabilities';

export type TestCoworkKey = {
  deviceId: string;
  publicKey: string;
  signPayload: (payload: string) => string;
};

export function createTestCoworkKey(deviceId = randomUUID()): TestCoworkKey {
  const pair = generateKeyPairSync('ed25519');
  return {
    deviceId,
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    signPayload: (payload) => sign(null, Buffer.from(payload), pair.privateKey).toString('base64url'),
  };
}

export async function seedCoworkDevice(input: {
  userId: string;
  key?: TestCoworkKey;
  status?: 'active' | 'revoked';
  presence?: 'active' | 'disconnected' | 'none';
  lastSeenAt?: Date;
  capabilities?: CoworkDeviceCapabilities;
}) {
  const key = input.key ?? createTestCoworkKey();
  const status = input.status ?? 'active';
  await db.insert(coworkDevices).values({
    id: key.deviceId,
    userId: input.userId,
    deviceName: 'Test Cowork',
    publicKey: key.publicKey,
    publicKeyFingerprint: fingerprintDevicePublicKey(key.publicKey),
    capabilities: input.capabilities ?? {
      capabilityIds: ['screen_capture', 'input_action'],
      isolatedVmTarget: true,
      kioskSurface: 'notepad',
    },
    status,
    revokedAt: status === 'revoked' ? new Date() : null,
  });
  await db.insert(coworkDeviceProvisioning).values({
    publicKey: key.publicKey,
    kioskSurface: 'notepad',
    capabilityIds: ['screen_capture', 'input_action'],
    provisionedBy: input.userId,
    status: 'active',
  }).onConflictDoNothing();
  if (input.presence && input.presence !== 'none') {
    const now = new Date();
    await db.insert(coworkDevicePresence).values({
      deviceId: key.deviceId,
      userId: input.userId,
      status: input.presence,
      connectedAt: now,
      lastSeenAt: input.lastSeenAt ?? now,
    });
  }
  return key;
}
