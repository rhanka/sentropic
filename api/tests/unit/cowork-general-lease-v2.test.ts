import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { canonicalJson, devicePepProofPayload, leaseV2Digest, signLeaseV2, verifyDevicePepProof, verifyLeaseAckV2, verifyLeaseV2, type LeaseV2Envelope } from '../../src/services/cowork/lease-v2';

const pair = generateKeyPairSync('ed25519');
const publicJwk = pair.publicKey.export({ format: 'jwk' }) as JsonWebKey;
const pepKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
const keys = {
  getActiveKey: async () => ({ kid: 'kid-active', privateKey: pair.privateKey }),
  findKeyByKid: async (kid: string) => kid === 'kid-active' ? ({ kid, publicJwk }) : null,
};
const payload = (): Omit<LeaseV2Envelope, 'version' | 'kid'> => ({
  leaseId: 'lease-a', invocationId: 'invocation-a', toolCallId: 'tool-a', durableCallRef: 'call-a', principalId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', targetDeviceId: 'device-a', targetPepKeyId: 'pep-a', capability: 'input_action', actionKind: 'click', actionDescriptorId: 'action-a', argumentDigest: 'digest-a', requiredAuthority: 'human-receipt', scopeOrReceiptId: 'receipt-a', attestationProfileId: 'profile-a', policyVersion: 'policy-a', actionBudget: 1, killEpoch: 4, issuedAt: '2026-08-03T00:00:00.000Z', expiresAt: '2026-08-03T00:01:00.000Z', nonce: 'nonce-a',
});

describe('Cowork General lease v2', () => {
  it('signs canonical v2 fields and rejects v1, tamper, wrong kid, device, and expiry', async () => {
    const signed = await signLeaseV2(payload(), keys);
    expect(signed).not.toBeNull();
    expect(await verifyLeaseV2(signed!, keys, { targetDeviceId: 'device-a', nonce: 'nonce-a' }, new Date('2026-08-03T00:00:30.000Z'))).toBe(true);
    const beforeExpiry = new Date('2026-08-03T00:00:30.000Z');
    expect(await verifyLeaseV2({ ...signed!, envelope: { ...signed!.envelope, version: 1 } }, keys, {}, beforeExpiry)).toBe(false);
    expect(await verifyLeaseV2({ ...signed!, envelope: { ...signed!.envelope, workspaceId: 'other' } }, keys, {}, beforeExpiry)).toBe(false);
    expect(await verifyLeaseV2({ ...signed!, envelope: { ...signed!.envelope, kid: 'kid-unknown' } }, keys, {}, beforeExpiry)).toBe(false);
    expect(await verifyLeaseV2(signed!, keys, { targetDeviceId: 'device-other' }, beforeExpiry)).toBe(false);
    expect(await verifyLeaseV2(signed!, keys, {}, new Date('2026-08-03T00:02:00.000Z'))).toBe(false);
  });

  it('requires a PEP-signed complete acknowledgement and channel-bound proof', async () => {
    const signed = (await signLeaseV2(payload(), keys))!;
    const unsignedAck = { version: 2 as const, leaseId: 'lease-a', leaseDigest: leaseV2Digest(signed.envelope), deviceId: 'device-a', pepKeyId: 'pep-a', surfaceEpoch: 9, killEpoch: 4 };
    const ack = { ...unsignedAck, signature: sign(null, Buffer.from(`cowork-lease-ack-v2:${canonicalJson(unsignedAck)}`), pair.privateKey).toString('base64url') };
    expect(verifyLeaseAckV2(ack, signed, pepKey)).toBe(true);
    expect(verifyLeaseAckV2({ ...ack, surfaceEpoch: 10 }, signed, pepKey)).toBe(false);

    for (const channel of ['poll', 'sse', 'wake', 'ack', 'result', 'stop-status'] as const) {
      const unsignedProof = { channel, deviceId: 'device-a', pepKeyId: 'pep-a', challenge: `server-${channel}` };
      const proof = { ...unsignedProof, signature: sign(null, Buffer.from(devicePepProofPayload(unsignedProof)), pair.privateKey).toString('base64url') };
      expect(verifyDevicePepProof(proof, unsignedProof, pepKey)).toBe(true);
      expect(verifyDevicePepProof({ ...proof, challenge: 'replayed-on-other-resource' }, unsignedProof, pepKey)).toBe(false);
    }
  });
});
