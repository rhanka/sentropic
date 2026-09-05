import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalClusterMeshEvidence,
  createClusterMeshInvocationVerifier,
  type ClusterMeshSignedReceiptEvidence,
} from '../../src/services/cluster-mesh/invocation-verifier';

const now = new Date('2026-09-05T12:00:00.000Z');
const seconds = Math.floor(now.getTime() / 1000);
const trusted = generateKeyPairSync('ed25519');
const untrusted = generateKeyPairSync('ed25519');
const publicKeysJson = JSON.stringify([{
  kid: 'mesh-key-1', alg: 'EdDSA', crv: 'Ed25519',
  publicKeyBase64Url: trusted.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
}]);
const base: ClusterMeshSignedReceiptEvidence = {
  version: 'sentropic.cluster-mesh.receipt/v1', kid: 'mesh-key-1', alg: 'EdDSA', crv: 'Ed25519',
  audience: 'https://api.example.test/api/v1/auth/session/control',
  generationId: 'cluster-mesh-session-v1', invocationId: 'command-1', correlationId: 'correlation-1',
  method: 'POST', path: '/auth/session/control/drive',
  targetRegistrationId: 'registration-1', idempotencyKey: 'idempotency-1',
  principalId: 'workload-1', workspaceId: 'workspace-1', scopes: ['session:drive'],
  policyRevision: 'mesh-policy-1', actuatorRef: 'pty:session-1', custodyEpoch: 1,
  registrationExpiresAt: seconds + 600, issuedAt: seconds - 1, expiresAt: seconds + 60,
  nonce: 'nonce-1', receiptStages: ['transported', 'verified', 'acted'],
};
const token = (value: unknown, key: KeyObject = trusted.privateKey, canonical = true) => {
  const payload = canonical
    ? canonicalClusterMeshEvidence(value as ClusterMeshSignedReceiptEvidence)
    : Buffer.from(JSON.stringify(value));
  return `${payload.toString('base64url')}.${sign(null, payload, key).toString('base64url')}`;
};
const request = (authorizationEvidenceRef: string) => ({
  invocationId: 'command-1', correlationId: 'correlation-1', generationId: 'cluster-mesh-session-v1',
  method: 'POST', path: '/auth/session/control/drive', targetRegistrationId: 'registration-1',
  idempotencyKey: 'idempotency-1', receiptStages: ['transported', 'verified', 'acted'] as const,
  authorizationEvidenceRef,
});
const verifier = (replayed = false) => createClusterMeshInvocationVerifier({
  publicKeysJson, audiences: [base.audience, 'legacy:cluster-mesh'], now: () => now,
  isReplayed: async () => replayed,
});
describe('cluster mesh Ed25519 invocation verifier', () => {
  it('should fail startup loudly when the key ring JSON is malformed', () => {
    expect(() => createClusterMeshInvocationVerifier({ publicKeysJson: '{', audiences: [base.audience] }))
      .toThrow('invalid cluster mesh Ed25519 public-key ring');
  });

  it('accepts a canonical receipt-chain envelope from a dedicated mesh key', async () => {
    await expect(verifier().verify(request(token(base)))).resolves.toMatchObject({
      generationId: base.generationId,
      principal: { verifierId: 'cluster-mesh-ed25519:mesh-key-1' },
      registration: { registrationId: base.targetRegistrationId },
    });
    await expect(verifier().verify(request(token({ ...base, audience: 'legacy:cluster-mesh' })))).resolves.toBeTruthy();
  });

  it.each([
    ['bad signature', () => token(base, untrusted.privateKey), false],
    ['wrong audience', () => token({ ...base, audience: 'https://wrong.example.test' }), false],
    ['absent audience', () => token({ ...base, audience: undefined }, trusted.privateKey, false), false],
    ['expired evidence', () => token({ ...base, issuedAt: seconds - 60, expiresAt: seconds - 1 }), false],
    ['excessive evidence lifetime', () => token({ ...base, expiresAt: seconds + 301 }), false],
    ['future evidence', () => token({ ...base, issuedAt: seconds + 31 }), false],
    ['registration expiring before evidence', () => token({ ...base, registrationExpiresAt: seconds + 30 }), false],
    ['missing generation', () => token({ ...base, generationId: undefined }, trusted.privateKey, false), false],
    ['unknown key', () => token({ ...base, kid: 'unknown-key' }), false],
    ['non-canonical evidence', () => token(Object.fromEntries(Object.entries(base).reverse()), trusted.privateKey, false), false],
    ['invocation binding mismatch', () => token({ ...base, invocationId: 'command-2' }), false],
    ['correlation binding mismatch', () => token({ ...base, correlationId: 'correlation-2' }), false],
    ['method binding mismatch', () => token({ ...base, method: 'PATCH' }), false],
    ['path binding mismatch', () => token({ ...base, path: '/wrong' }), false],
    ['registration binding mismatch', () => token({ ...base, targetRegistrationId: 'registration-2' }), false],
    ['idempotency binding mismatch', () => token({ ...base, idempotencyKey: 'idempotency-2' }), false],
    ['replayed evidence', () => token(base), true],
  ])('rejects %s before the control boundary', async (_name, evidence, replayed) => {
    await expect(verifier(replayed).verify(request(evidence()))).rejects.toThrow();
  });

  it('should reject a reused nonce and an omitted receipt-stage binding', async () => {
    const candidate = verifier();
    await expect(candidate.verify(request(token(base)))).resolves.toBeTruthy();
    await expect(candidate.verify(request(token(base)))).rejects.toThrow('mesh evidence replayed');
    await expect(verifier().verify({ ...request(token(base)), receiptStages: undefined })).rejects.toThrow();
  });

  it('should check durable replay before consuming the in-process nonce', async () => {
    let attempts = 0;
    const candidate = createClusterMeshInvocationVerifier({
      publicKeysJson, audiences: [base.audience], now: () => now,
      isReplayed: async () => {
        if (attempts++ === 0) throw new Error('replay store unavailable');
        return false;
      },
    });

    await expect(candidate.verify(request(token(base)))).rejects.toThrow('replay store unavailable');
    await expect(candidate.verify(request(token(base)))).resolves.toBeTruthy();
  });
});
