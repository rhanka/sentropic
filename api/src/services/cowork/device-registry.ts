import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client';
import { coworkDeviceLeases, coworkDevicePresence, coworkDevices } from '../../db/schema';

export type CoworkDeviceMutationResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_owned' | 'revoked' };

async function checkActiveDeviceOwner(
  userId: string,
  deviceId: string,
): Promise<CoworkDeviceMutationResult> {
  const [device] = await db
    .select({ userId: coworkDevices.userId, status: coworkDevices.status })
    .from(coworkDevices)
    .where(eq(coworkDevices.id, deviceId))
    .limit(1);

  if (!device) return { ok: false, reason: 'not_found' };
  if (device.userId !== userId) return { ok: false, reason: 'not_owned' };
  if (device.status !== 'active') return { ok: false, reason: 'revoked' };
  return { ok: true };
}

/** Register an active, PoP-enrolled desktop device in durable presence. */
export async function registerCoworkDevice(
  userId: string,
  deviceId: string,
): Promise<CoworkDeviceMutationResult> {
  const allowed = await checkActiveDeviceOwner(userId, deviceId);
  if (!allowed.ok) return allowed;

  const now = new Date();
  await db
    .insert(coworkDevicePresence)
    .values({ deviceId, userId, status: 'active', connectedAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: coworkDevicePresence.deviceId,
      set: { userId, status: 'active', lastSeenAt: now },
    });
  return { ok: true };
}

/** Refresh durable device presence after validating user ownership and status. */
export async function keepaliveCoworkDevice(
  userId: string,
  deviceId: string,
): Promise<CoworkDeviceMutationResult> {
  const allowed = await checkActiveDeviceOwner(userId, deviceId);
  if (!allowed.ok) return allowed;

  await db
    .update(coworkDevicePresence)
    .set({ status: 'active', lastSeenAt: new Date() })
    .where(and(eq(coworkDevicePresence.deviceId, deviceId), eq(coworkDevicePresence.userId, userId)));
  return { ok: true };
}

/** Keep a disconnected row for restart-safe presence history instead of deleting it. */
export async function unregisterCoworkDevice(
  userId: string,
  deviceId: string,
): Promise<CoworkDeviceMutationResult> {
  const allowed = await checkActiveDeviceOwner(userId, deviceId);
  if (!allowed.ok) return allowed;

  await db
    .update(coworkDevicePresence)
    .set({ status: 'disconnected', lastSeenAt: new Date() })
    .where(and(eq(coworkDevicePresence.deviceId, deviceId), eq(coworkDevicePresence.userId, userId)));
  return { ok: true };
}

/**
 * C5b/#492: terminalize every executable lease in the same transaction before
 * deleting the target row.  Do not replace this with a direct FK cascade.
 */
export async function deleteCoworkDeviceWithLeaseRevocation(
  userId: string,
  deviceId: string,
): Promise<CoworkDeviceMutationResult> {
  return db.transaction(async (tx) => {
    const [device] = await tx.select({ userId: coworkDevices.userId, status: coworkDevices.status })
      .from(coworkDevices).where(eq(coworkDevices.id, deviceId)).limit(1);
    if (!device) return { ok: false, reason: 'not_found' };
    if (device.userId !== userId) return { ok: false, reason: 'not_owned' };

    await tx.update(coworkDeviceLeases).set({ status: 'revoked' }).where(and(
      eq(coworkDeviceLeases.deviceId, deviceId),
      inArray(coworkDeviceLeases.status, ['issued', 'acknowledged']),
    ));
    await tx.delete(coworkDevices).where(and(eq(coworkDevices.id, deviceId), eq(coworkDevices.userId, userId)));
    return { ok: true };
  });
}

/** Identifies a durable Cowork record so browser-tab routes cannot bypass its ownership checks. */
export async function isKnownCoworkDevice(deviceId: string): Promise<boolean> {
  const [device] = await db
    .select({ id: coworkDevices.id })
    .from(coworkDevices)
    .where(eq(coworkDevices.id, deviceId))
    .limit(1);
  return Boolean(device);
}

export async function listCoworkPresence(userId: string) {
  return db
    .select({
      deviceId: coworkDevicePresence.deviceId,
      status: coworkDevicePresence.status,
      connectedAt: coworkDevicePresence.connectedAt,
      lastSeenAt: coworkDevicePresence.lastSeenAt,
    })
    .from(coworkDevicePresence)
    .where(eq(coworkDevicePresence.userId, userId));
}
