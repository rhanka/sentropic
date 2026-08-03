import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { coworkDeviceLeases, coworkDevices, coworkDeviceTeardownTombstones, coworkGeneralCalls } from '../../db/schema';

export type GeneralCallState = 'FAIT' | 'DÉPOSÉ-EN-ATTENTE' | 'PAS-FAIT';
export type GeneralCallRef = Readonly<{ durableCallRef: string; state: GeneralCallState }>;

export async function depositGeneralCall(input: {
  principalId: string; tenantId: string; workspaceId: string; targetDeviceId: string; invocationId: string; toolCallId: string;
  descriptorCiphertext: string; descriptorKeyRef: string; descriptorMeta: { actionDescriptorId: string; argumentDigest: string }; authorityEpoch: number;
}): Promise<GeneralCallRef | null> {
  if (!input.descriptorCiphertext || !input.descriptorKeyRef) return null;
  const id = randomUUID();
  const [created] = await db.insert(coworkGeneralCalls).values({ ...input, id, state: 'DÉPOSÉ-EN-ATTENTE', requiresFreshAuthority: true })
    .onConflictDoNothing().returning();
  if (created) return { durableCallRef: created.id, state: 'DÉPOSÉ-EN-ATTENTE' };
  const [existing] = await db.select().from(coworkGeneralCalls).where(and(
    eq(coworkGeneralCalls.principalId, input.principalId), eq(coworkGeneralCalls.workspaceId, input.workspaceId), eq(coworkGeneralCalls.toolCallId, input.toolCallId),
  )).limit(1);
  if (!existing || existing.tenantId !== input.tenantId || existing.targetDeviceId !== input.targetDeviceId || existing.invocationId !== input.invocationId) return null;
  return { durableCallRef: existing.id, state: existing.state as GeneralCallState };
}

/** Wake can only preserve an honest deposit: it never resurrects a prior lease. */
export async function requireFreshAuthorityOnWake(input: {
  durableCallRef: string; principalId: string; tenantId: string; workspaceId: string;
}): Promise<GeneralCallRef | null> {
  const [call] = await db.update(coworkGeneralCalls).set({ requiresFreshAuthority: true, updatedAt: new Date() }).where(and(
    eq(coworkGeneralCalls.id, input.durableCallRef), eq(coworkGeneralCalls.principalId, input.principalId),
    eq(coworkGeneralCalls.tenantId, input.tenantId), eq(coworkGeneralCalls.workspaceId, input.workspaceId),
    eq(coworkGeneralCalls.state, 'DÉPOSÉ-EN-ATTENTE'),
  )).returning();
  return call ? { durableCallRef: call.id, state: 'DÉPOSÉ-EN-ATTENTE' } : null;
}

/** This foundation has no FAIT writer; all terminal resolution is honest PAS-FAIT. */
export async function markGeneralCallNotDone(durableCallRef: string): Promise<boolean> {
  const [updated] = await db.update(coworkGeneralCalls).set({ state: 'PAS-FAIT', updatedAt: new Date() })
    .where(and(eq(coworkGeneralCalls.id, durableCallRef), eq(coworkGeneralCalls.state, 'DÉPOSÉ-EN-ATTENTE'))).returning();
  return Boolean(updated);
}

export async function expireGeneralCall(durableCallRef: string): Promise<boolean> {
  return markGeneralCallNotDone(durableCallRef);
}

/** C5b: one transaction soft-revokes, cancels authority, tombstones, then revokes. */
export async function revokeCoworkDeviceBeforeCascade(input: { deviceId: string; userId: string; reason: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [revoking] = await tx.update(coworkDevices).set({ status: 'revoking', killEpoch: sql`${coworkDevices.killEpoch} + 1` })
      .where(and(eq(coworkDevices.id, input.deviceId), eq(coworkDevices.userId, input.userId), eq(coworkDevices.status, 'active'))).returning();
    if (!revoking) return false;
    await tx.update(coworkGeneralCalls).set({ state: 'PAS-FAIT', updatedAt: new Date() })
      .where(and(eq(coworkGeneralCalls.targetDeviceId, input.deviceId), eq(coworkGeneralCalls.state, 'DÉPOSÉ-EN-ATTENTE')));
    await tx.update(coworkDeviceLeases).set({ status: 'revoked' })
      .where(and(eq(coworkDeviceLeases.deviceId, input.deviceId), inArray(coworkDeviceLeases.status, ['issued', 'acknowledged'])));
    await tx.insert(coworkDeviceTeardownTombstones).values({ id: randomUUID(), deviceId: input.deviceId, userId: input.userId, killEpoch: revoking.killEpoch, reason: input.reason });
    await tx.update(coworkDevices).set({ status: 'revoked', revokedAt: new Date() }).where(eq(coworkDevices.id, input.deviceId));
    return true;
  });
}
