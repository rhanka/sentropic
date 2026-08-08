import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { coworkDeviceLeases, coworkDevices, coworkDeviceTeardownTombstones, coworkGeneralCalls, workspaceMemberships, workspaces } from '../../db/schema';

export type GeneralCallState = 'FAIT' | 'DÉPOSÉ-EN-ATTENTE' | 'PAS-FAIT';
export type GeneralCallRef = Readonly<{ durableCallRef: string; state: GeneralCallState }>;

export async function depositGeneralCall(input: {
  principalId: string; tenantId: string; workspaceId: string; targetDeviceId: string; invocationId: string; toolCallId: string;
  descriptorCiphertext: string; descriptorKeyRef: string; descriptorMeta: { actionDescriptorId: string; argumentDigest: string }; authorityEpoch: number; nodeEnv?: string;
}): Promise<GeneralCallRef | null> {
  if (input.nodeEnv === 'production' || !input.descriptorCiphertext || !input.descriptorKeyRef || !input.descriptorMeta.actionDescriptorId || !input.descriptorMeta.argumentDigest) return null;
  const [device, workspace, membership] = await Promise.all([
    db.select({ id: coworkDevices.id, profile: coworkDevices.generalProfile }).from(coworkDevices).where(and(eq(coworkDevices.id, input.targetDeviceId), eq(coworkDevices.userId, input.principalId), eq(coworkDevices.status, 'active'))).limit(1),
    db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.tenantId, input.tenantId))).limit(1),
    db.select({ userId: workspaceMemberships.userId }).from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, input.workspaceId), eq(workspaceMemberships.userId, input.principalId))).limit(1),
  ]);
  if (!device[0] || device[0].profile?.isolatedVmTarget !== true || !device[0].profile?.egressPolicyRef || !workspace[0] || !membership[0]) return null;
  const id = randomUUID();
  const { nodeEnv: _nodeEnv, ...record } = input;
  const [created] = await db.insert(coworkGeneralCalls).values({ ...record, id, state: 'DÉPOSÉ-EN-ATTENTE', requiresFreshAuthority: true })
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
  durableCallRef: string; principalId: string; targetDeviceId: string;
}): Promise<boolean> {
  const [call] = await db.update(coworkGeneralCalls).set({ requiresFreshAuthority: true, updatedAt: new Date() }).where(and(
    eq(coworkGeneralCalls.id, input.durableCallRef), eq(coworkGeneralCalls.principalId, input.principalId),
    eq(coworkGeneralCalls.targetDeviceId, input.targetDeviceId),
    eq(coworkGeneralCalls.state, 'DÉPOSÉ-EN-ATTENTE'),
  )).returning();
  return Boolean(call);
}

/** This foundation has no FAIT writer; all terminal resolution is honest PAS-FAIT. */
export async function markGeneralCallNotDone(durableCallRef: string, targetDeviceId?: string): Promise<boolean> {
  const [updated] = await db.update(coworkGeneralCalls).set({ state: 'PAS-FAIT', updatedAt: new Date() })
    .where(targetDeviceId
      ? and(eq(coworkGeneralCalls.id, durableCallRef), eq(coworkGeneralCalls.targetDeviceId, targetDeviceId), eq(coworkGeneralCalls.state, 'DÉPOSÉ-EN-ATTENTE'))
      : and(eq(coworkGeneralCalls.id, durableCallRef), eq(coworkGeneralCalls.state, 'DÉPOSÉ-EN-ATTENTE'))).returning();
  return Boolean(updated);
}

export async function expireGeneralCall(durableCallRef: string): Promise<boolean> {
  return markGeneralCallNotDone(durableCallRef);
}

export async function listPendingGeneralCalls(userId: string, deviceId: string): Promise<GeneralCallRef[]> {
  const calls = await db.select({ id: coworkGeneralCalls.id, state: coworkGeneralCalls.state }).from(coworkGeneralCalls).where(and(
    eq(coworkGeneralCalls.principalId, userId), eq(coworkGeneralCalls.targetDeviceId, deviceId), eq(coworkGeneralCalls.state, 'DÉPOSÉ-EN-ATTENTE'),
  )).limit(50);
  return calls.map((call) => ({ durableCallRef: call.id, state: call.state as GeneralCallState }));
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
