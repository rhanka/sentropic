import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '../../src/db/client';
import { coworkDeviceTeardownTombstones, coworkDevices, coworkGeneralCalls } from '../../src/db/schema';
import { depositGeneralCall, markGeneralCallNotDone, requireFreshAuthorityOnWake, revokeCoworkDeviceBeforeCascade } from '../../src/services/cowork/general-call-service';
import { consumeGeneralSseProofSession, establishGeneralSseProofSession, mintGeneralDeviceProofChallenge, verifyGeneralDeviceProof } from '../../src/services/cowork/general-device-proof';
import { devicePepProofPayload, type DevicePepProof } from '../../src/services/cowork/lease-v2';
import { cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { seedCoworkDevice } from '../utils/cowork-device';

describe('Cowork General durable protocol', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  beforeEach(async () => { user = await createAuthenticatedUser('editor'); });
  afterEach(cleanupAuthData);

  async function deposit(deviceId: string, toolCallId = 'tool-a') {
    return depositGeneralCall({
      principalId: user.id, tenantId: 'sentropic', workspaceId: user.workspaceId!, targetDeviceId: deviceId, invocationId: 'invoke-a', toolCallId,
      descriptorCiphertext: 'opaque-ciphertext', descriptorKeyRef: 'test-key-ref', descriptorMeta: { actionDescriptorId: 'action-a', argumentDigest: 'digest-a' }, authorityEpoch: 0, nodeEnv: 'test',
    });
  }

  it('persists one honest DÉPOSÉ ref, binds it to workspace/device, and never writes FAIT', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active', general: true });
    const first = await deposit(device.deviceId);
    const retry = await deposit(device.deviceId);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({ state: 'DÉPOSÉ-EN-ATTENTE' });
    expect(await requireFreshAuthorityOnWake({ durableCallRef: first!.durableCallRef, principalId: user.id, targetDeviceId: device.deviceId })).toBe(true);
    expect(await markGeneralCallNotDone(first!.durableCallRef, device.deviceId)).toBe(true);
    const [row] = await db.select().from(coworkGeneralCalls).where(eq(coworkGeneralCalls.id, first!.durableCallRef));
    expect(row?.state).toBe('PAS-FAIT');
    expect(row?.state).not.toBe('FAIT');
  });

  it('denies a deposit on a sibling device and revokes/tombstones before teardown', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active', general: true });
    const siblingUser = await createAuthenticatedUser('editor');
    const sibling = await seedCoworkDevice({ userId: siblingUser.id, presence: 'active', general: true });
    expect(await deposit(sibling.deviceId, 'cross-device')).toBeNull();
    const call = await deposit(device.deviceId, 'revoke-call');
    expect(await revokeCoworkDeviceBeforeCascade({ deviceId: device.deviceId, userId: user.id, reason: 'test-teardown' })).toBe(true);
    const [revoked, tombstone, cancelled] = await Promise.all([
      db.select().from(coworkDevices).where(eq(coworkDevices.id, device.deviceId)),
      db.select().from(coworkDeviceTeardownTombstones).where(eq(coworkDeviceTeardownTombstones.deviceId, device.deviceId)),
      db.select().from(coworkGeneralCalls).where(eq(coworkGeneralCalls.id, call!.durableCallRef)),
    ]);
    expect(revoked[0]?.status).toBe('revoked');
    expect(tombstone).toHaveLength(1);
    expect(cancelled[0]?.state).toBe('PAS-FAIT');
  });

  it('burns server-minted PEP proofs once and requires a new proof after reconnect', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active', general: true });
    const challenge = await mintGeneralDeviceProofChallenge({
      userId: user.id,
      deviceId: device.deviceId,
      channel: 'poll',
      resourceId: `device:${device.deviceId}`,
      method: 'POST',
      nodeEnv: 'test',
    });
    expect(challenge).not.toBeNull();
    const signProof = (value: typeof challenge): DevicePepProof => {
      const unsigned = {
        channel: value!.channel,
        deviceId: value!.deviceId,
        pepKeyId: value!.pepKeyId,
        challengeId: value!.challengeId,
        resourceId: value!.resourceId,
        method: value!.method,
        expiresAt: value!.expiresAt,
        deviceKillEpoch: value!.deviceKillEpoch,
      } as const;
      return { ...unsigned, signature: device.pepKey!.signPayload(devicePepProofPayload(unsigned)) };
    };
    const proof = signProof(challenge);
    expect((await verifyGeneralDeviceProof({ userId: user.id, deviceId: device.deviceId, channel: 'poll', resourceId: `device:${device.deviceId}`, method: 'POST', proof, nodeEnv: 'test' })).ok).toBe(true);
    expect((await verifyGeneralDeviceProof({ userId: user.id, deviceId: device.deviceId, channel: 'poll', resourceId: `device:${device.deviceId}`, method: 'POST', proof, nodeEnv: 'test' })).ok).toBe(false);

    const reconnectChallenge = await mintGeneralDeviceProofChallenge({
      userId: user.id,
      deviceId: device.deviceId,
      channel: 'sse',
      resourceId: `device:${device.deviceId}`,
      method: 'POST',
      nodeEnv: 'test',
    });
    const session = await establishGeneralSseProofSession({ userId: user.id, deviceId: device.deviceId, proof: signProof(reconnectChallenge), nodeEnv: 'test' });
    expect(session).not.toBeNull();
    // The services retain no in-memory challenge/session state: this simulates a
    // reconnect after process restart and succeeds only from durable rows.
    expect((await consumeGeneralSseProofSession({ userId: user.id, deviceId: device.deviceId, sessionId: session!.sessionId })).ok).toBe(true);
    expect((await consumeGeneralSseProofSession({ userId: user.id, deviceId: device.deviceId, sessionId: session!.sessionId })).ok).toBe(false);
  });
});
