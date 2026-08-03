import { and, eq, gt, inArray, lte } from 'drizzle-orm';

import { db } from '../../db/client';
import { coworkDeviceLeases } from '../../db/schema';
import { verifyLeaseAckV2, type LeaseAckV2, type SignedLeaseV2 } from './lease-v2';

type GeneralLeaseScope = { protocol: 'cowork-general-lease-v2'; signed: SignedLeaseV2; ack?: LeaseAckV2 };
const inFlight = ['issued', 'acknowledged'] as const;

export function isGeneralLeaseV2(scope: unknown): scope is GeneralLeaseScope {
  const candidate = scope as Partial<GeneralLeaseScope> | null;
  return candidate?.protocol === 'cowork-general-lease-v2' && candidate.signed?.envelope?.version === 2;
}

/** GENERAL refuses every v1 scope/ack; MVP v1 remains isolated in its old routes. */
export async function acknowledgeGeneralLeaseV2(input: {
  userId: string; deviceId: string; leaseId: string; ack: LeaseAckV2; pepPublicKey: string;
}): Promise<boolean> {
  const [lease] = await db.select().from(coworkDeviceLeases).where(and(
    eq(coworkDeviceLeases.id, input.leaseId), eq(coworkDeviceLeases.deviceId, input.deviceId), eq(coworkDeviceLeases.userId, input.userId),
  )).limit(1);
  if (!lease || !isGeneralLeaseV2(lease.scope) || !verifyLeaseAckV2(input.ack, lease.scope.signed, input.pepPublicKey)) return false;
  const [acknowledged] = await db.update(coworkDeviceLeases).set({ status: 'acknowledged', acknowledgedAt: new Date(), scope: { ...lease.scope, ack: input.ack } })
    .where(and(eq(coworkDeviceLeases.id, input.leaseId), eq(coworkDeviceLeases.status, 'issued'), gt(coworkDeviceLeases.expiresAt, new Date()))).returning();
  return Boolean(acknowledged);
}

/** One conditional update makes consumption, revocation, and expiry race-safe. */
export async function consumeGeneralLease(leaseId: string, deviceId: string): Promise<boolean> {
  const [consumed] = await db.update(coworkDeviceLeases).set({ status: 'consumed', consumedAt: new Date() }).where(and(
    eq(coworkDeviceLeases.id, leaseId), eq(coworkDeviceLeases.deviceId, deviceId), eq(coworkDeviceLeases.status, 'acknowledged'), gt(coworkDeviceLeases.expiresAt, new Date()),
  )).returning();
  return Boolean(consumed);
}

export async function revokeGeneralLease(leaseId: string, deviceId: string): Promise<boolean> {
  const [revoked] = await db.update(coworkDeviceLeases).set({ status: 'revoked' }).where(and(
    eq(coworkDeviceLeases.id, leaseId), eq(coworkDeviceLeases.deviceId, deviceId), inArray(coworkDeviceLeases.status, inFlight),
  )).returning();
  return Boolean(revoked);
}

export async function expireGeneralLease(leaseId: string, deviceId: string): Promise<boolean> {
  const [expired] = await db.update(coworkDeviceLeases).set({ status: 'expired' }).where(and(
    eq(coworkDeviceLeases.id, leaseId), eq(coworkDeviceLeases.deviceId, deviceId), inArray(coworkDeviceLeases.status, inFlight), lte(coworkDeviceLeases.expiresAt, new Date()),
  )).returning();
  return Boolean(expired);
}
