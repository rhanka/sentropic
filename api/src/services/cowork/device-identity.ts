import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { coworkDevices } from '../../db/schema';
import type { CoworkDeviceCapabilities } from './device-capabilities';

export type { CoworkDeviceCapability, CoworkDeviceCapabilities } from './device-capabilities';

export interface PendingCoworkDeviceIdentity {
  deviceId: string;
  devicePublicKey: string;
  capabilities: CoworkDeviceCapabilities;
  serverNonce: string;
}

export type ActiveCoworkDevice = {
  id: string;
  userId: string;
  publicKey: string;
  status: string;
};

export type ActivateDeviceResult =
  | { ok: true; device: ActiveCoworkDevice }
  | { ok: false; reason: 'cross_user_collision' | 'key_mismatch' | 'revoked' };

function decodeEd25519PublicKey(publicKey: string) {
  const key = createPublicKey({
    key: Buffer.from(publicKey, 'base64url'),
    format: 'der',
    type: 'spki',
  });
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Device public key must be an Ed25519 SPKI key');
  }
  return key;
}

export function assertEd25519PublicKey(publicKey: string): void {
  decodeEd25519PublicKey(publicKey);
}

export function fingerprintDevicePublicKey(publicKey: string): string {
  // OQ-1 remains architect-revisable: BR-41c currently uses Ed25519 SPKI.
  return createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('base64url');
}

export function verifyCoworkSignature(publicKey: string, payload: string, signature: string): boolean {
  try {
    return verify(
      null,
      Buffer.from(payload, 'utf8'),
      decodeEd25519PublicKey(publicKey),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

export function coworkDeliveryProofPayload(input: {
  method: 'GET';
  deviceId: string;
  issuedAtMs: number;
}): string {
  return `cowork-device-delivery-v1:${input.method}.${input.deviceId}.${input.issuedAtMs}`;
}

/** C3: a bearer token alone can never receive a device lease. */
export async function verifyCoworkDeliveryProof(input: {
  userId: string;
  deviceId: string;
  method: 'GET';
  issuedAtMs: number;
  signature: string;
  nowMs?: number;
}): Promise<boolean> {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(input.issuedAtMs) || Math.abs(nowMs - input.issuedAtMs) > 30_000) return false;
  const device = await findActiveCoworkDevice(input.userId, input.deviceId);
  return Boolean(device && verifyCoworkSignature(device.publicKey, coworkDeliveryProofPayload(input), input.signature));
}

function hasSameKey(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'base64url');
  const rightBytes = Buffer.from(right, 'base64url');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export async function findActiveCoworkDevice(
  userId: string,
  deviceId: string,
): Promise<ActiveCoworkDevice | null> {
  const [device] = await db
    .select({
      id: coworkDevices.id,
      userId: coworkDevices.userId,
      publicKey: coworkDevices.publicKey,
      status: coworkDevices.status,
    })
    .from(coworkDevices)
    .where(and(eq(coworkDevices.id, deviceId), eq(coworkDevices.userId, userId)))
    .limit(1);

  return device?.status === 'active' ? device : null;
}

/**
 * Commit an identity only after the caller has completed the device-code human
 * approval and cryptographic proof check. Re-enrollment never rotates a key:
 * OQ-9 must be ratified before a rotation path is introduced.
 */
export async function activateCoworkDevice(input: {
  userId: string;
  deviceName: string;
  identity: PendingCoworkDeviceIdentity;
}): Promise<ActivateDeviceResult> {
  const [existing] = await db
    .select({
      id: coworkDevices.id,
      userId: coworkDevices.userId,
      publicKey: coworkDevices.publicKey,
      status: coworkDevices.status,
    })
    .from(coworkDevices)
    .where(eq(coworkDevices.id, input.identity.deviceId))
    .limit(1);

  if (existing) {
    if (existing.status === 'revoked') return { ok: false, reason: 'revoked' };
    if (existing.userId !== input.userId) return { ok: false, reason: 'cross_user_collision' };
    if (!hasSameKey(existing.publicKey, input.identity.devicePublicKey)) {
      return { ok: false, reason: 'key_mismatch' };
    }
    return { ok: true, device: existing };
  }

  try {
    const [device] = await db
      .insert(coworkDevices)
      .values({
        id: input.identity.deviceId,
        userId: input.userId,
        deviceName: input.deviceName,
        publicKey: input.identity.devicePublicKey,
        publicKeyFingerprint: fingerprintDevicePublicKey(input.identity.devicePublicKey),
        capabilities: input.identity.capabilities,
        status: 'active',
      })
      .returning({
        id: coworkDevices.id,
        userId: coworkDevices.userId,
        publicKey: coworkDevices.publicKey,
        status: coworkDevices.status,
      });
    return { ok: true, device };
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== '23505') throw error;
    return activateCoworkDevice(input);
  }
}
