import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { coworkDevices } from '../../db/schema';
import { verifyDevicePepProof, type DevicePepProof, type ProofChannel } from './lease-v2';

export type GeneralProofCheck =
  | { ok: true; device: { deviceId: string; pepKeyId: string; pepPublicKey: string } }
  | { ok: false; reason: 'device_not_eligible' | 'invalid_proof' | 'containment_required' };

/** C3: bearer ownership is checked elsewhere; this requires the separate PEP key too. */
export async function verifyGeneralDeviceProof(input: {
  userId: string; deviceId: string; channel: ProofChannel; challenge: string; proof: DevicePepProof; nodeEnv?: string;
}): Promise<GeneralProofCheck> {
  const [device] = await db.select().from(coworkDevices).where(and(
    eq(coworkDevices.id, input.deviceId), eq(coworkDevices.userId, input.userId), eq(coworkDevices.status, 'active'),
  )).limit(1);
  if (!device?.pepPublicKey || !device.pepKeyId) return { ok: false, reason: 'device_not_eligible' };
  const profile = device.generalProfile ?? {};
  if (input.nodeEnv === 'production' || profile.isolatedVmTarget !== true || !profile.egressPolicyRef) {
    return { ok: false, reason: 'containment_required' };
  }
  const expected = { channel: input.channel, deviceId: input.deviceId, pepKeyId: device.pepKeyId, challenge: input.challenge } as const;
  if (!verifyDevicePepProof(input.proof, expected, device.pepPublicKey)) return { ok: false, reason: 'invalid_proof' };
  return { ok: true, device: { deviceId: device.id, pepKeyId: device.pepKeyId, pepPublicKey: device.pepPublicKey } };
}
