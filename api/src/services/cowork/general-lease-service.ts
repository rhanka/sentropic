import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import { db } from '../../db/client';
import { coworkDeviceLeases, coworkDevices, coworkGeneralCalls } from '../../db/schema';
import { createServerLeaseV2KeyPort, signLeaseV2, verifyLeaseAckV2, verifyLeaseV2, type LeaseAckV2, type LeaseV2Envelope, type LeaseV2KeyPort, type SignedLeaseV2 } from './lease-v2';
const inFlight = ['issued', 'acknowledged'] as const;
const FRESH_AUTHORITY_TTL_MS = 60_000;
const FRESH_AUTHORITY_CLOCK_SKEW_MS = 5_000;
export type FreshGeneralAuthority = Readonly<{ authorityEpoch: number; capability: string; actionKind: string; actionBudget: number; policyVersion: string; attestationProfileId: string; confirmationReceiptId: string; issuedAt: string; expiresAt: string }>;
type GeneralLeaseScope = { protocol: 'cowork-general-lease-v2'; signed: SignedLeaseV2; ack?: LeaseAckV2 };
export function isGeneralLeaseV2(scope: unknown): scope is GeneralLeaseScope {
  const candidate = scope as Partial<GeneralLeaseScope> | null;
  return candidate?.protocol === 'cowork-general-lease-v2' && candidate.signed?.envelope?.version === 2;
}
const isNonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const parseFreshTimestamp = (value: string): Date | null => { const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null; };

function isFreshAuthority(authority: FreshGeneralAuthority, currentEpoch: number, now: Date): boolean {
  const issuedAt = parseFreshTimestamp(authority.issuedAt);
  const expiresAt = parseFreshTimestamp(authority.expiresAt);
  return isPositiveInteger(authority.authorityEpoch) && authority.authorityEpoch > currentEpoch && isNonEmpty(authority.capability) && isNonEmpty(authority.actionKind)
    && isPositiveInteger(authority.actionBudget) && isNonEmpty(authority.policyVersion) && isNonEmpty(authority.attestationProfileId) && isNonEmpty(authority.confirmationReceiptId)
    && Boolean(issuedAt) && Boolean(expiresAt) && issuedAt! <= new Date(now.getTime() + FRESH_AUTHORITY_CLOCK_SKEW_MS) && now >= issuedAt! && expiresAt! > now
    && expiresAt!.getTime() - issuedAt!.getTime() <= FRESH_AUTHORITY_TTL_MS;
}
function matchesCurrentAuthority(input: { envelope: LeaseV2Envelope; call: typeof coworkGeneralCalls.$inferSelect; device: typeof coworkDevices.$inferSelect }): boolean {
  const authority = input.call.freshAuthority as FreshGeneralAuthority | null;
  const descriptor = input.call.descriptorMeta;
  if (!authority || input.call.requiresFreshAuthority || input.call.state !== 'DÉPOSÉ-EN-ATTENTE' || input.envelope.requiredAuthority !== 'fresh-human-receipt') return false;
  return [
    [input.envelope.durableCallRef, input.call.id], [input.envelope.principalId, input.call.principalId], [input.envelope.tenantId, input.call.tenantId], [input.envelope.workspaceId, input.call.workspaceId],
    [input.envelope.targetDeviceId, input.call.targetDeviceId], [input.envelope.invocationId, input.call.invocationId], [input.envelope.toolCallId, input.call.toolCallId], [input.envelope.actionDescriptorId, descriptor.actionDescriptorId],
    [input.envelope.argumentDigest, descriptor.argumentDigest], [input.envelope.targetPepKeyId, input.device.pepKeyId], [input.envelope.killEpoch, input.device.killEpoch], [input.envelope.authorityEpoch, input.call.authorityEpoch],
    [authority.authorityEpoch, input.envelope.authorityEpoch], [authority.capability, input.envelope.capability], [authority.actionKind, input.envelope.actionKind], [authority.actionBudget, input.envelope.actionBudget],
    [authority.policyVersion, input.envelope.policyVersion], [authority.attestationProfileId, input.envelope.attestationProfileId], [authority.confirmationReceiptId, input.envelope.scopeOrReceiptId], [authority.issuedAt, input.envelope.issuedAt], [authority.expiresAt, input.envelope.expiresAt],
  ].every(([left, right]) => left === right);
}
/**
 * C4 issuance choke point.  A signed lease is minted only while the durable
 * call and current device are locked, then persisted with that same binding.
 */
export async function issueGeneralLeaseV2(input: { userId: string; durableCallRef: string; authority: FreshGeneralAuthority; keys?: LeaseV2KeyPort; now?: Date }): Promise<SignedLeaseV2 | null> {
  const now = input.now ?? new Date();
  const keys = input.keys ?? createServerLeaseV2KeyPort();
  return db.transaction(async (tx) => {
    const [call] = await tx.select().from(coworkGeneralCalls).where(and(eq(coworkGeneralCalls.id, input.durableCallRef), eq(coworkGeneralCalls.principalId, input.userId), eq(coworkGeneralCalls.state, 'DÉPOSÉ-EN-ATTENTE'), eq(coworkGeneralCalls.requiresFreshAuthority, true))).for('update');
    if (!call || !isFreshAuthority(input.authority, call.authorityEpoch, now)) return null;
    const [device] = await tx.select().from(coworkDevices).where(and(eq(coworkDevices.id, call.targetDeviceId), eq(coworkDevices.userId, input.userId), eq(coworkDevices.status, 'active'))).for('update');
    if (!device?.pepKeyId || !device.pepPublicKey) return null;

    const envelopeInput: Omit<LeaseV2Envelope, 'version' | 'kid'> = { leaseId: randomUUID(), invocationId: call.invocationId, toolCallId: call.toolCallId, durableCallRef: call.id, principalId: call.principalId, tenantId: call.tenantId, workspaceId: call.workspaceId, targetDeviceId: device.id, targetPepKeyId: device.pepKeyId, capability: input.authority.capability, actionKind: input.authority.actionKind, actionDescriptorId: call.descriptorMeta.actionDescriptorId, argumentDigest: call.descriptorMeta.argumentDigest, requiredAuthority: 'fresh-human-receipt', scopeOrReceiptId: input.authority.confirmationReceiptId, attestationProfileId: input.authority.attestationProfileId, policyVersion: input.authority.policyVersion, actionBudget: input.authority.actionBudget, authorityEpoch: input.authority.authorityEpoch, killEpoch: device.killEpoch, issuedAt: input.authority.issuedAt, expiresAt: input.authority.expiresAt, nonce: randomBytes(32).toString('base64url') };
    const signed = await signLeaseV2(envelopeInput, keys, now);
    if (!signed) return null;
    const [bound] = await tx.update(coworkGeneralCalls).set({
      authorityEpoch: input.authority.authorityEpoch,
      requiresFreshAuthority: false,
      freshAuthority: input.authority,
      updatedAt: now,
    }).where(and(eq(coworkGeneralCalls.id, call.id), eq(coworkGeneralCalls.requiresFreshAuthority, true))).returning();
    if (!bound) return null;
    const [lease] = await tx.insert(coworkDeviceLeases).values({
      id: signed.envelope.leaseId,
      deviceId: device.id,
      userId: input.userId,
      turnRef: call.id,
      nonce: signed.envelope.nonce,
      scope: { protocol: 'cowork-general-lease-v2', signed },
      issuedAt: now,
      expiresAt: new Date(signed.envelope.expiresAt),
    }).onConflictDoNothing().returning();
    return lease ? signed : null;
  });
}
/** GENERAL refuses v1 and re-locks call + device before accepting a PEP ack. */
export async function acknowledgeGeneralLeaseV2(input: {
  userId: string;
  deviceId: string;
  leaseId: string;
  ack: LeaseAckV2;
  keys?: LeaseV2KeyPort;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const keys = input.keys ?? createServerLeaseV2KeyPort();
  return db.transaction(async (tx) => {
    const [lease] = await tx.select().from(coworkDeviceLeases).where(and(
      eq(coworkDeviceLeases.id, input.leaseId),
      eq(coworkDeviceLeases.deviceId, input.deviceId),
      eq(coworkDeviceLeases.userId, input.userId),
      eq(coworkDeviceLeases.status, 'issued'),
    )).for('update');
    if (!lease || !isGeneralLeaseV2(lease.scope)) return false;
    const envelope = lease.scope.signed.envelope;
    const [call, device] = await Promise.all([
      tx.select().from(coworkGeneralCalls).where(eq(coworkGeneralCalls.id, envelope.durableCallRef)).for('update'),
      tx.select().from(coworkDevices).where(and(eq(coworkDevices.id, input.deviceId), eq(coworkDevices.userId, input.userId), eq(coworkDevices.status, 'active'))).for('update'),
    ]);
    if (!call[0] || !device[0]?.pepPublicKey || !matchesCurrentAuthority({ envelope, call: call[0], device: device[0] })) return false;
    if (!await verifyLeaseV2(lease.scope.signed, keys, {
      durableCallRef: call[0].id,
      principalId: input.userId,
      tenantId: call[0].tenantId,
      workspaceId: call[0].workspaceId,
      targetDeviceId: input.deviceId,
      targetPepKeyId: device[0].pepKeyId!,
      authorityEpoch: call[0].authorityEpoch,
      killEpoch: device[0].killEpoch,
    }, now)) return false;
    if (!verifyLeaseAckV2(input.ack, lease.scope.signed, device[0].pepPublicKey)) return false;
    const [acknowledged] = await tx.update(coworkDeviceLeases).set({
      status: 'acknowledged',
      acknowledgedAt: now,
      scope: { ...lease.scope, ack: input.ack },
    }).where(and(eq(coworkDeviceLeases.id, input.leaseId), eq(coworkDeviceLeases.status, 'issued'), gt(coworkDeviceLeases.expiresAt, now))).returning();
    return Boolean(acknowledged);
  });
}
/** Lot 4 must call this before any effect; stale call/device epochs cannot consume. */
export async function consumeGeneralLease(input: { userId: string; deviceId: string; durableCallRef: string; leaseId: string; keys?: LeaseV2KeyPort; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const keys = input.keys ?? createServerLeaseV2KeyPort();
  return db.transaction(async (tx) => {
    const [lease] = await tx.select().from(coworkDeviceLeases).where(and(
      eq(coworkDeviceLeases.id, input.leaseId),
      eq(coworkDeviceLeases.deviceId, input.deviceId),
      eq(coworkDeviceLeases.userId, input.userId),
      eq(coworkDeviceLeases.status, 'acknowledged'),
    )).for('update');
    if (!lease || !isGeneralLeaseV2(lease.scope)) return false;
    const envelope = lease.scope.signed.envelope;
    const [call, device] = await Promise.all([
      tx.select().from(coworkGeneralCalls).where(and(eq(coworkGeneralCalls.id, input.durableCallRef), eq(coworkGeneralCalls.id, envelope.durableCallRef))).for('update'),
      tx.select().from(coworkDevices).where(and(eq(coworkDevices.id, input.deviceId), eq(coworkDevices.userId, input.userId), eq(coworkDevices.status, 'active'))).for('update'),
    ]);
    if (!call[0] || !device[0]?.pepPublicKey || !matchesCurrentAuthority({ envelope, call: call[0], device: device[0] })) return false;
    if (!await verifyLeaseV2(lease.scope.signed, keys, {
      durableCallRef: input.durableCallRef,
      principalId: input.userId,
      targetDeviceId: input.deviceId,
      targetPepKeyId: device[0].pepKeyId!,
      authorityEpoch: call[0].authorityEpoch,
      killEpoch: device[0].killEpoch,
    }, now)) return false;
    const [consumed] = await tx.update(coworkDeviceLeases).set({ status: 'consumed', consumedAt: now }).where(and(
      eq(coworkDeviceLeases.id, input.leaseId),
      eq(coworkDeviceLeases.status, 'acknowledged'),
      gt(coworkDeviceLeases.expiresAt, now),
    )).returning();
    return Boolean(consumed);
  });
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
