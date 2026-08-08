import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { generateKeyPairSync, randomUUID } from 'node:crypto';

import { db } from '../../src/db/client';
import { coworkDeviceLeases, coworkDeviceTeardownTombstones, coworkDevices, coworkGeneralCalls, users, workspaces } from '../../src/db/schema';
import { depositGeneralCall, markGeneralCallNotDone, requireFreshAuthorityOnWake, revokeCoworkDeviceBeforeCascade } from '../../src/services/cowork/general-call-service';
import { consumeGeneralSseProofSession, establishGeneralSseProofSession, mintGeneralDeviceProofChallenge, verifyGeneralDeviceProof } from '../../src/services/cowork/general-device-proof';
import { acknowledgeGeneralLeaseV2, consumeGeneralLease, issueGeneralLeaseV2, type FreshGeneralAuthority } from '../../src/services/cowork/general-lease-service';
import { canonicalJson, devicePepProofPayload, leaseV2Digest, type DevicePepProof } from '../../src/services/cowork/lease-v2';
import { cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { createTestCoworkKey, seedCoworkDevice } from '../utils/cowork-device';

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

  it('binds each minted lease to one durable call and the current device epoch', async () => {
    const device = await seedCoworkDevice({ userId: user.id, presence: 'active', general: true });
    const first = await deposit(device.deviceId, 'lease-call-a');
    const second = await deposit(device.deviceId, 'lease-call-b');
    const serverPair = generateKeyPairSync('ed25519');
    const publicJwk = serverPair.publicKey.export({ format: 'jwk' }) as JsonWebKey;
    const keys = {
      getActiveKey: async () => ({ kid: 'lease-kid', privateKey: serverPair.privateKey, alg: 'EdDSA', crv: 'Ed25519' }),
      findKeyByKid: async (kid: string) => kid === 'lease-kid' ? ({ kid, publicJwk, active: true, alg: 'EdDSA', crv: 'Ed25519', rotatedAt: null }) : null,
    };
    const now = new Date();
    const authority: FreshGeneralAuthority = {
      authorityEpoch: 1,
      capability: 'input_action',
      actionKind: 'click',
      actionBudget: 1,
      policyVersion: 'policy-test-1',
      attestationProfileId: 'profile-test-1',
      confirmationReceiptId: 'receipt-test-1',
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 45_000).toISOString(),
    };
    const signed = await issueGeneralLeaseV2({ userId: user.id, durableCallRef: first!.durableCallRef, authority, keys, now });
    expect(signed).not.toBeNull();
    const unsignedAck = {
      version: 2 as const,
      leaseId: signed!.envelope.leaseId,
      leaseDigest: leaseV2Digest(signed!.envelope),
      deviceId: device.deviceId,
      pepKeyId: device.pepKeyId!,
      surfaceEpoch: 1,
      killEpoch: signed!.envelope.killEpoch,
    };
    const ack = {
      ...unsignedAck,
      signature: device.pepKey!.signPayload(`cowork-lease-ack-v2:${canonicalJson(unsignedAck)}`),
    };
    expect(await acknowledgeGeneralLeaseV2({ userId: user.id, deviceId: device.deviceId, leaseId: signed!.envelope.leaseId, ack, keys, now })).toBe(true);
    expect(await consumeGeneralLease({ userId: user.id, deviceId: device.deviceId, leaseId: signed!.envelope.leaseId, durableCallRef: second!.durableCallRef, keys, now })).toBe(false);
    const rotatedPep = createTestCoworkKey();
    await db.update(coworkDevices).set({ pepKeyId: `pep:${rotatedPep.deviceId}`, pepPublicKey: rotatedPep.publicKey }).where(eq(coworkDevices.id, device.deviceId));
    const [rotatedDevice] = await db.select().from(coworkDevices).where(eq(coworkDevices.id, device.deviceId));
    expect(rotatedDevice?.killEpoch).toBeGreaterThan(signed!.envelope.killEpoch);
    expect(await consumeGeneralLease({ userId: user.id, deviceId: device.deviceId, leaseId: signed!.envelope.leaseId, durableCallRef: first!.durableCallRef, keys, now })).toBe(false);
  });

  it('revokes authority before direct device, user, and workspace cascades', async () => {
    const addLease = async (userId: string, deviceId: string, turnRef: string) => {
      const id = randomUUID();
      await db.insert(coworkDeviceLeases).values({ id, deviceId, userId, turnRef, nonce: randomUUID(), scope: { protocol: 'cowork-general-lease-v2' }, expiresAt: new Date(Date.now() + 60_000) });
      return id;
    };
    const makeCall = (principalId: string, workspaceId: string, targetDeviceId: string, toolCallId: string) => depositGeneralCall({
      principalId, tenantId: 'sentropic', workspaceId, targetDeviceId, invocationId: `${toolCallId}-invoke`, toolCallId,
      descriptorCiphertext: 'opaque-ciphertext', descriptorKeyRef: 'test-key-ref', descriptorMeta: { actionDescriptorId: `action-${toolCallId}`, argumentDigest: `digest-${toolCallId}` }, authorityEpoch: 0, nodeEnv: 'test',
    });

    const direct = await seedCoworkDevice({ userId: user.id, presence: 'active', general: true });
    const directCall = await deposit(direct.deviceId, 'direct-delete-call');
    const directLease = await addLease(user.id, direct.deviceId, directCall!.durableCallRef);
    await db.delete(coworkDevices).where(eq(coworkDevices.id, direct.deviceId));
    const [directTombstone] = await db.select().from(coworkDeviceTeardownTombstones).where(eq(coworkDeviceTeardownTombstones.deviceId, direct.deviceId));
    expect(directTombstone?.revokedLeaseIds).toContain(directLease);
    expect(await db.select().from(coworkDeviceLeases).where(eq(coworkDeviceLeases.id, directLease))).toHaveLength(0);

    const workspaceUser = await createAuthenticatedUser('editor');
    const workspaceDevice = await seedCoworkDevice({ userId: workspaceUser.id, presence: 'active', general: true });
    const workspaceCall = await makeCall(workspaceUser.id, workspaceUser.workspaceId!, workspaceDevice.deviceId, 'workspace-delete-call');
    const workspaceLease = await addLease(workspaceUser.id, workspaceDevice.deviceId, workspaceCall!.durableCallRef);
    await db.delete(workspaces).where(eq(workspaces.id, workspaceUser.workspaceId!));
    expect((await db.select().from(coworkDeviceLeases).where(eq(coworkDeviceLeases.id, workspaceLease)))[0]?.status).toBe('revoked');

    const accountUser = await createAuthenticatedUser('editor');
    const accountDevice = await seedCoworkDevice({ userId: accountUser.id, presence: 'active', general: true });
    const accountCall = await makeCall(accountUser.id, accountUser.workspaceId!, accountDevice.deviceId, 'account-delete-call');
    const accountLease = await addLease(accountUser.id, accountDevice.deviceId, accountCall!.durableCallRef);
    await db.delete(users).where(eq(users.id, accountUser.id));
    const [accountTombstone] = await db.select().from(coworkDeviceTeardownTombstones).where(eq(coworkDeviceTeardownTombstones.deviceId, accountDevice.deviceId));
    expect(accountTombstone?.revokedLeaseIds).toContain(accountLease);
    expect(await db.select().from(coworkDeviceLeases).where(eq(coworkDeviceLeases.id, accountLease))).toHaveLength(0);
  });

});
