import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '../../db/client';
import { coworkDeviceProofChallenges, coworkDeviceProofSessions, coworkDevices } from '../../db/schema';
import { verifyDevicePepProof, type DevicePepProof, type ProofChannel } from './lease-v2';

const PROOF_CHALLENGE_TTL_MS = 60_000;
const SSE_PROOF_SESSION_TTL_MS = 15_000;

export type GeneralProofCheck =
  | { ok: true; device: { deviceId: string; pepKeyId: string; pepPublicKey: string; killEpoch: number } }
  | { ok: false; reason: 'device_not_eligible' | 'invalid_proof' | 'containment_required' };

export type GeneralProofChallenge = Readonly<{
  challengeId: string;
  channel: ProofChannel;
  deviceId: string;
  pepKeyId: string;
  resourceId: string;
  method: string;
  expiresAt: string;
  deviceKillEpoch: number;
}>;

async function loadEligibleGeneralDevice(input: { userId: string; deviceId: string; nodeEnv?: string }, transaction = db): Promise<GeneralProofCheck> {
  const [device] = await transaction.select().from(coworkDevices).where(and(
    eq(coworkDevices.id, input.deviceId), eq(coworkDevices.userId, input.userId), eq(coworkDevices.status, 'active'),
  )).for('update').limit(1);
  if (!device?.pepPublicKey || !device.pepKeyId) return { ok: false, reason: 'device_not_eligible' };
  const profile = device.generalProfile ?? {};
  if (input.nodeEnv === 'production' || profile.isolatedVmTarget !== true || !profile.egressPolicyRef) return { ok: false, reason: 'containment_required' };
  return { ok: true, device: { deviceId: device.id, pepKeyId: device.pepKeyId, pepPublicKey: device.pepPublicKey, killEpoch: device.killEpoch } };
}

/** Minting requires bearer ownership; use requires this one-use PEP proof. */
export async function mintGeneralDeviceProofChallenge(input: {
  userId: string; deviceId: string; channel: ProofChannel; resourceId: string; method: string; nodeEnv?: string; now?: Date;
}): Promise<GeneralProofChallenge | null> {
  const now = input.now ?? new Date();
  const eligible = await loadEligibleGeneralDevice(input);
  if (!eligible.ok) return null;
  const challengeId = randomUUID();
  const expiresAt = new Date(now.getTime() + PROOF_CHALLENGE_TTL_MS);
  await db.insert(coworkDeviceProofChallenges).values({
    id: challengeId,
    deviceId: eligible.device.deviceId,
    userId: input.userId,
    pepKeyId: eligible.device.pepKeyId,
    channel: input.channel,
    resourceId: input.resourceId,
    method: input.method,
    deviceKillEpoch: eligible.device.killEpoch,
    expiresAt,
  });
  return {
    challengeId,
    channel: input.channel,
    deviceId: eligible.device.deviceId,
    pepKeyId: eligible.device.pepKeyId,
    resourceId: input.resourceId,
    method: input.method,
    expiresAt: expiresAt.toISOString(),
    deviceKillEpoch: eligible.device.killEpoch,
  };
}

/** C3: proof is valid only once, for the server-minted channel/resource/method tuple. */
export async function verifyGeneralDeviceProof(input: {
  userId: string; deviceId: string; channel: ProofChannel; resourceId: string; method: string; proof: DevicePepProof; nodeEnv?: string; now?: Date;
}): Promise<GeneralProofCheck> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(coworkDeviceProofChallenges).where(eq(coworkDeviceProofChallenges.id, input.proof.challengeId)).for('update');
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) return { ok: false, reason: 'invalid_proof' };
    const eligible = await loadEligibleGeneralDevice(input, tx);
    if (!eligible.ok) return eligible;
    const expected = {
      channel: input.channel,
      deviceId: input.deviceId,
      pepKeyId: eligible.device.pepKeyId,
      challengeId: challenge.id,
      resourceId: input.resourceId,
      method: input.method,
      expiresAt: challenge.expiresAt.toISOString(),
      deviceKillEpoch: eligible.device.killEpoch,
    } as const;
    if (
      challenge.userId !== input.userId || challenge.deviceId !== input.deviceId || challenge.pepKeyId !== eligible.device.pepKeyId ||
      challenge.channel !== input.channel || challenge.resourceId !== input.resourceId || challenge.method !== input.method ||
      challenge.deviceKillEpoch !== eligible.device.killEpoch || !verifyDevicePepProof(input.proof, expected, eligible.device.pepPublicKey)
    ) return { ok: false, reason: 'invalid_proof' };
    const [consumed] = await tx.update(coworkDeviceProofChallenges).set({ consumedAt: now }).where(and(
      eq(coworkDeviceProofChallenges.id, challenge.id), isNull(coworkDeviceProofChallenges.consumedAt), gt(coworkDeviceProofChallenges.expiresAt, now),
    )).returning();
    return consumed ? eligible : { ok: false, reason: 'invalid_proof' };
  });
}

export async function establishGeneralSseProofSession(input: {
  userId: string; deviceId: string; proof: DevicePepProof; nodeEnv?: string; now?: Date;
}): Promise<{ sessionId: string; expiresAt: string } | null> {
  const now = input.now ?? new Date();
  const verified = await verifyGeneralDeviceProof({
    ...input,
    channel: 'sse',
    resourceId: `device:${input.deviceId}`,
    method: 'POST',
  });
  if (!verified.ok) return null;
  const sessionId = randomUUID();
  const expiresAt = new Date(now.getTime() + SSE_PROOF_SESSION_TTL_MS);
  await db.insert(coworkDeviceProofSessions).values({
    id: sessionId,
    deviceId: input.deviceId,
    userId: input.userId,
    pepKeyId: verified.device.pepKeyId,
    channel: 'sse',
    resourceId: `device:${input.deviceId}`,
    method: 'GET',
    deviceKillEpoch: verified.device.killEpoch,
    expiresAt,
  });
  return { sessionId, expiresAt: expiresAt.toISOString() };
}

export async function consumeGeneralSseProofSession(input: { userId: string; deviceId: string; sessionId: string; now?: Date }): Promise<GeneralProofCheck> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(coworkDeviceProofSessions).where(eq(coworkDeviceProofSessions.id, input.sessionId)).for('update');
    if (!session || session.consumedAt || session.expiresAt <= now || session.channel !== 'sse' || session.method !== 'GET' || session.resourceId !== `device:${input.deviceId}` || session.userId !== input.userId || session.deviceId !== input.deviceId) return { ok: false, reason: 'invalid_proof' };
    const eligible = await loadEligibleGeneralDevice(input, tx);
    if (!eligible.ok || session.pepKeyId !== eligible.device.pepKeyId || session.deviceKillEpoch !== eligible.device.killEpoch) return { ok: false, reason: 'invalid_proof' };
    const [consumed] = await tx.update(coworkDeviceProofSessions).set({ consumedAt: now }).where(and(
      eq(coworkDeviceProofSessions.id, session.id), isNull(coworkDeviceProofSessions.consumedAt), gt(coworkDeviceProofSessions.expiresAt, now),
    )).returning();
    return consumed ? eligible : { ok: false, reason: 'invalid_proof' };
  });
}
