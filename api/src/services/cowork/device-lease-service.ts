import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';

import { db, pool } from '../../db/client';
import { coworkDeviceLeases, coworkDevices } from '../../db/schema';
import { findActiveCoworkDevice, verifyCoworkSignature } from './device-identity';

const LEASE_TTL_MS = 45_000;
const PRESENCE_FRESHNESS_MS = 45_000;
const IN_FLIGHT_STATUSES = ['issued', 'acknowledged'] as const;

type LeaseScope = Record<string, unknown> | null;
type LeaseStatus = 'issued' | 'acknowledged' | 'consumed' | 'expired' | 'revoked';

export type LeaseResult =
  | { ok: true; lease: { leaseId: string; deviceId: string; nonce: string; scope: LeaseScope; expiresAt: Date; status: LeaseStatus } }
  | { ok: false; reason: 'ineligible' | 'not_found' | 'invalid_signature' | 'not_issuable' | 'not_revocable' };

const toLease = (lease: typeof coworkDeviceLeases.$inferSelect) => ({
  leaseId: lease.id,
  deviceId: lease.deviceId,
  nonce: lease.nonce,
  scope: lease.scope as LeaseScope,
  expiresAt: lease.expiresAt,
  status: lease.status as LeaseStatus,
});

async function publishLeaseNotification(deviceId: string): Promise<void> {
  // Durable rows are the queue. This low-latency signal is intentionally best-effort.
  await pool.query('SELECT pg_notify($1, $2)', ['cowork_device_lease_events', JSON.stringify({ device_id: deviceId })]);
}

export async function issueLease(input: {
  userId: string;
  deviceId: string;
  turnRef: string;
  scope: LeaseScope;
}): Promise<LeaseResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);

  const result = await db.transaction(async (tx) => {
    await tx
      .update(coworkDeviceLeases)
      .set({ status: 'expired' })
      .where(and(
        eq(coworkDeviceLeases.deviceId, input.deviceId),
        eq(coworkDeviceLeases.turnRef, input.turnRef),
        eq(coworkDeviceLeases.status, 'issued'),
        lte(coworkDeviceLeases.expiresAt, now),
      ));
    const [existing] = await tx
      .select()
      .from(coworkDeviceLeases)
      .where(and(
        eq(coworkDeviceLeases.deviceId, input.deviceId),
        eq(coworkDeviceLeases.turnRef, input.turnRef),
        inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES),
      ))
      .limit(1);
    if (existing) return { ok: true, lease: toLease(existing) } as LeaseResult;

    // Lock the device while checking presence and inserting the lease. A
    // concurrent revoke waits for this transaction rather than slipping between
    // eligibility and issuance.
    const eligibility = await tx.execute(sql`
      SELECT d.id
      FROM cowork_devices d
      JOIN cowork_device_presence p ON p.device_id = d.id
      WHERE d.id = ${input.deviceId}
        AND d.user_id = ${input.userId}
        AND d.status = 'active'
        AND p.user_id = ${input.userId}
        AND p.status = 'active'
        AND p.last_seen_at > ${new Date(now.getTime() - PRESENCE_FRESHNESS_MS)}
      FOR UPDATE OF d
    `);
    if (eligibility.rows.length === 0) return { ok: false, reason: 'ineligible' } as LeaseResult;

    const [lease] = await tx
      .insert(coworkDeviceLeases)
      .values({
        id: crypto.randomUUID(),
        deviceId: input.deviceId,
        userId: input.userId,
        turnRef: input.turnRef,
        nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
        scope: input.scope,
        status: 'issued',
        issuedAt: now,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning();
    if (lease) return { ok: true, lease: toLease(lease) } as LeaseResult;

    const [raced] = await tx
      .select()
      .from(coworkDeviceLeases)
      .where(and(
        eq(coworkDeviceLeases.deviceId, input.deviceId),
        eq(coworkDeviceLeases.turnRef, input.turnRef),
        inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES),
      ))
      .limit(1);
    return raced ? { ok: true, lease: toLease(raced) } as LeaseResult : { ok: false, reason: 'ineligible' } as LeaseResult;
  });

  if (result.ok && result.lease.status === 'issued') {
    void publishLeaseNotification(result.lease.deviceId).catch(() => {});
  }
  return result;
}

export async function acknowledgeLease(input: {
  userId: string;
  deviceId: string;
  leaseId: string;
  signature: string;
}): Promise<LeaseResult> {
  const [lease] = await db
    .select()
    .from(coworkDeviceLeases)
    .where(and(
      eq(coworkDeviceLeases.id, input.leaseId),
      eq(coworkDeviceLeases.deviceId, input.deviceId),
      eq(coworkDeviceLeases.userId, input.userId),
    ))
    .limit(1);
  if (!lease) return { ok: false, reason: 'not_found' };

  const device = await findActiveCoworkDevice(input.userId, input.deviceId);
  if (!device || !verifyCoworkSignature(device.publicKey, `cowork-lease-ack-v1:${lease.id}.${lease.nonce}`, input.signature)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const now = new Date();
  const [acknowledged] = await db
    .update(coworkDeviceLeases)
    .set({ status: 'acknowledged', acknowledgedAt: now })
    .where(and(
      eq(coworkDeviceLeases.id, input.leaseId),
      eq(coworkDeviceLeases.deviceId, input.deviceId),
      eq(coworkDeviceLeases.userId, input.userId),
      eq(coworkDeviceLeases.status, 'issued'),
      gt(coworkDeviceLeases.expiresAt, now),
      sql`EXISTS (SELECT 1 FROM cowork_devices d WHERE d.id = ${coworkDeviceLeases.deviceId} AND d.user_id = ${input.userId} AND d.status = 'active')`,
    ))
    .returning();
  return acknowledged ? { ok: true, lease: toLease(acknowledged) } : { ok: false, reason: 'not_issuable' };
}

/** Lot 4 will call this primitive before any external screen-side effect. */
export async function revokeLease(leaseId: string, reason: string, userId?: string): Promise<LeaseResult> {
  void reason; // Audit persistence is intentionally deferred with Lot 4's result protocol.
  const where = userId
    ? and(eq(coworkDeviceLeases.id, leaseId), eq(coworkDeviceLeases.userId, userId), inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES))
    : and(eq(coworkDeviceLeases.id, leaseId), inArray(coworkDeviceLeases.status, IN_FLIGHT_STATUSES));
  const [revoked] = await db.update(coworkDeviceLeases).set({ status: 'revoked' }).where(where).returning();
  return revoked ? { ok: true, lease: toLease(revoked) } : { ok: false, reason: 'not_revocable' };
}

export async function listIssuedLeases(userId: string, deviceId: string, limit = 20) {
  const device = await findActiveCoworkDevice(userId, deviceId);
  if (!device) return null;
  const now = new Date();
  return db
    .select()
    .from(coworkDeviceLeases)
    .where(and(
      eq(coworkDeviceLeases.userId, userId),
      eq(coworkDeviceLeases.deviceId, deviceId),
      eq(coworkDeviceLeases.status, 'issued'),
      gt(coworkDeviceLeases.expiresAt, now),
    ))
    .limit(Math.min(Math.max(limit, 1), 50));
}
