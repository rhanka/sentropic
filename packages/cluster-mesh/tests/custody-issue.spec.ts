import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  BoundedLocalCustodySource,
  decodeCustodyToken,
  encodeCustodyToken,
  type ClusterMeshRegistration,
  type CustodyBinding,
} from '../src/index.js';

const NOW = '2026-09-13T12:00:00.000Z';
const registration: ClusterMeshRegistration = {
  registrationId: 'registration-1', generationId: 'generation-1',
  principalId: 'holder-1', workspaceId: 'workspace-1',
  custodyHolderPrincipalId: 'holder-1', custodyEpoch: 4,
  actuatorRef: 'pty:session-1', status: 'active',
  expiresAt: '2026-09-13T14:00:00.000Z', leaseExpiresAt: '2026-09-13T14:00:00.000Z',
};
const binding: CustodyBinding = {
  registrationId: registration.registrationId, custodyId: 'custody-1',
  holderPrincipalId: 'holder-1', epoch: 4, meshDomain: 'mesh.example.test',
  status: 'active', expiresAt: '2026-09-13T12:00:20.000Z',
};

function fixture() {
  let record: ClusterMeshRegistration | null = registration;
  const source = new BoundedLocalCustodySource({
    issuerId: 'custody-source-1',
    registrations: { async find(id) { return id === record?.registrationId ? record : null; } },
    bindings: [binding], maximumTtlSeconds: 60, now: () => new Date(NOW),
  });
  return { source, setRecord(value: ClusterMeshRegistration | null) { record = value; } };
}

const request = {
  registrationId: registration.registrationId, action: 'drive' as const,
  holderPrincipalId: 'holder-1', invocationId: 'invocation-1', requestedTtlSeconds: 300,
};

describe('bounded-local custody issuance', () => {
  it('should resolve the mesh audience and cap TTL at the binding horizon', async () => {
    const { source } = fixture();
    const token = await source.issue(request);

    expect(token).toMatchObject({
      kind: 'signed-custody-token', version: 'sentropic.cluster-mesh.custody/v1',
      audience: binding.meshDomain, registrationId: registration.registrationId,
      holderPrincipalId: request.holderPrincipalId, custodyId: binding.custodyId,
      epoch: binding.epoch, invocationId: request.invocationId, issuedAt: NOW,
      expiresAt: binding.expiresAt,
      issuer: { issuerId: source.issuerId, keyId: source.keyId, algorithm: 'EdDSA', curve: 'Ed25519' },
      evidence: { kind: 'detached-signature', canonicalization: 'sentropic-json-v1' },
    });
  });

  it.each([
    ['unknown', null, request],
    ['inactive', { ...registration, status: 'revoked' as const }, request],
    ['stale', { ...registration, leaseExpiresAt: NOW }, request],
    ['holder-mismatched', registration, { ...request, holderPrincipalId: 'holder-other' }],
  ] as const)('should return null for a %s registration target', async (_case, record, candidate) => {
    const { source, setRecord } = fixture();
    setRecord(record);
    await expect(source.issue(candidate)).resolves.toBeNull();
  });

  it('should return null after holder revocation', async () => {
    const { source } = fixture();
    await source.revoke({
      selector: { kind: 'holder', holderPrincipalId: request.holderPrincipalId },
      reason: 'session ended',
    });
    await expect(source.issue(request)).resolves.toBeNull();
  });

  it('should return null for an unknown, inactive or stale binding', async () => {
    const { source } = fixture();
    source.removeBinding(binding.registrationId);
    await expect(source.issue(request)).resolves.toBeNull();
    source.setBinding({ ...binding, status: 'revoked' });
    await expect(source.issue(request)).resolves.toBeNull();
    source.setBinding({ ...binding, expiresAt: NOW });
    await expect(source.issue(request)).resolves.toBeNull();
  });
});

describe('custody token wire encoding', () => {
  it('should round-trip unpadded canonical base64url', async () => {
    const token = await fixture().source.issue(request);
    expect(token).not.toBeNull();
    const encoded = encodeCustodyToken(token!);
    expect(encoded).not.toContain('=');
    expect(decodeCustodyToken(encoded)).toEqual(token);
  });

  it.each([
    ['padding', (encoded: string) => `${encoded}=`],
    ['whitespace', (encoded: string) => Buffer.from(
      ` ${Buffer.from(encoded, 'base64url').toString('utf8')}`,
    ).toString('base64url')],
    ['duplicate keys', (encoded: string) => {
      const json = Buffer.from(encoded, 'base64url').toString('utf8');
      return Buffer.from(json.replace('{', '{"kind":"signed-custody-token",')).toString('base64url');
    }],
    ['extra field', (encoded: string) => {
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      return Buffer.from(JSON.stringify({ ...parsed, unexpected: true })).toString('base64url');
    }],
  ])('should reject %s instead of normalizing it', async (_case, mutate) => {
    const token = await fixture().source.issue(request);
    const encoded = encodeCustodyToken(token!);
    expect(() => decodeCustodyToken(mutate(encoded))).toThrow();
  });
});
