import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { remoteSignedBytes } from '../../../src/services/auth/remote-contract';
import { verifyRemoteCliProof } from '../../../src/services/auth/remote-native-proof';

const keys = generateKeyPairSync('ed25519');
const now = 1_800_000_000_000;
const body = {
  version: 'remote-action-v1', kind: 'cli-session-proof', issuer: 'source-b', kid: 'b-1', audience: 'app-a',
  proofId: 'proof-1', target: { appMeshId: 'a', sourceMeshId: 'b', nativeAudience: 'native-b',
    registrationId: 'reg', tenantId: 'tenant', workspaceId: 'workspace', bindingId: 'binding',
    sourceId: 'source', sourceSessionId: 's', nativeSessionId: 'native', sourceGeneration: 1,
    bootGeneration: 1, custodyEpoch: 1, controllerEpoch: 1, connectionId: 'connection', connectionGeneration: 1 },
  ownerIssuer: 'idp', ownerSub: 'owner', approvedRegistrationRef: 'approval', approvedRegistrationRevision: 1,
  providerId: 'provider', providerVersion: '1', executableDigest: 'a'.repeat(64), nativeSessionPublicKeyId: 'native-key',
  capabilitiesDigest: 'b'.repeat(64), permissionMode: 'interactive', autoApprovePolicyDigest: null,
  issuedAt: now, expiresAt: now + 60_000,
};
const signed = (value: unknown) => ({ body: value,
  signature: { alg: 'Ed25519', value: sign(null, remoteSignedBytes(value), keys.privateKey).toString('base64url') } });
const expected = { ...body, key: keys.publicKey, now };

describe('RC1 I2 CLI proof publication and use', () => {
  it('should verify an exact source-signed current native session proof', () => {
    expect(verifyRemoteCliProof(signed(body), expected).body).toEqual(body);
  });
  it.each(['nativeSessionId', 'workspaceId', 'connectionId', 'sourceGeneration',
    'bootGeneration', 'controllerEpoch', 'custodyEpoch', 'connectionGeneration'] as const)
    ('should refuse an old or substituted %s', (field) => {
      const target = { ...body.target, [field]: typeof body.target[field] === 'number' ? 2 : 'other' };
      expect(() => verifyRemoteCliProof(signed({ ...body, target }), expected))
        .toThrowError(expect.objectContaining({ code: 'session_proof_invalid' }));
    });
  it.each(['ownerSub', 'ownerIssuer', 'approvedRegistrationRef', 'providerId', 'providerVersion',
    'executableDigest', 'nativeSessionPublicKeyId', 'capabilitiesDigest', 'permissionMode', 'proofId'])
    ('should refuse a signed substituted %s', (field) => {
      expect(() => verifyRemoteCliProof(signed({ ...body, [field]: 'other' }), expected)).toThrow();
    });
  it('should refuse expiry and unsafe clock instead of extending authority', () => {
    expect(() => verifyRemoteCliProof(signed(body), { ...expected, now: body.expiresAt - 5000 }))
      .toThrowError(expect.objectContaining({ code: 'expired' }));
    expect(() => verifyRemoteCliProof(signed(body), { ...expected, now: NaN })).toThrow();
  });
  it('should refuse the wrong signing key, algorithm and extra target fields', () => {
    expect(() => verifyRemoteCliProof(signed(body), { ...expected,
      key: generateKeyPairSync('ed25519').publicKey })).toThrow();
    expect(() => verifyRemoteCliProof({ ...signed(body), signature: { alg: 'RS256', value: 'x' } }, expected))
      .toThrow();
    expect(() => verifyRemoteCliProof(signed({ ...body, target: { ...body.target, callback: '/socket' } }), expected))
      .toThrow();
  });
});
