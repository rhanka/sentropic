import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  BoundedLocalCustodySource,
  type ClusterMeshRegistration,
  type CustodyBinding,
  type CustodyTokenExpectation,
  type SignedCustodyToken,
} from '../src/index.js';

const registration: ClusterMeshRegistration = {
  registrationId: 'registration-1', generationId: 'generation-1',
  principalId: 'holder-1', workspaceId: 'workspace-1',
  custodyHolderPrincipalId: 'holder-1', custodyEpoch: 1,
  actuatorRef: 'pty:session-1', status: 'active',
  expiresAt: '2026-09-13T14:00:00.000Z', leaseExpiresAt: '2026-09-13T14:00:00.000Z',
};
const binding: CustodyBinding = {
  registrationId: registration.registrationId, custodyId: 'custody-1',
  holderPrincipalId: 'holder-1', epoch: 1, meshDomain: 'mesh.example.test',
  status: 'active', expiresAt: registration.expiresAt,
};

function source() {
  return new BoundedLocalCustodySource({
    issuerId: 'custody-source-1', registrations: { async find() { return registration; } },
    bindings: [binding], maximumTtlSeconds: 60,
    now: () => new Date('2026-09-13T12:00:00.000Z'),
  });
}

const issue = (custody: BoundedLocalCustodySource) => custody.issue({
  registrationId: registration.registrationId, action: 'drive',
  holderPrincipalId: binding.holderPrincipalId, invocationId: 'invocation-1',
});

const expected = (token: SignedCustodyToken): CustodyTokenExpectation => ({
  audience: token.audience, registrationId: token.registrationId, action: token.action,
  holderPrincipalId: token.holderPrincipalId, epoch: token.epoch,
  custodyId: token.custodyId, invocationId: token.invocationId,
});

async function expectUntrusted(custody: BoundedLocalCustodySource, token: SignedCustodyToken) {
  await expect(custody.verify(token, expected(token)))
    .resolves.toEqual({ ok: false, reason: 'untrusted' });
  await expect(custody.consume(token, expected(token)))
    .resolves.toEqual({ ok: false, reason: 'untrusted' });
}

describe('custody token tamper resistance', () => {
  it('should reject a flipped signature byte', async () => {
    const custody = source();
    const token = (await issue(custody))!;
    const signature = Buffer.from(token.evidence.signatureBase64Url, 'base64url');
    signature[0] ^= 0x01;
    await expectUntrusted(custody, {
      ...token,
      evidence: { ...token.evidence, signatureBase64Url: signature.toString('base64url') },
    });
  });

  it.each([
    ['audience', { audience: 'other-mesh.example.test' }],
    ['registrationId', { registrationId: 'registration-other' }],
    ['action', { action: 'wake' as const }],
    ['holderPrincipalId', { holderPrincipalId: 'holder-other' }],
    ['epoch', { epoch: 2 }],
    ['custodyId', { custodyId: 'custody-other' }],
    ['invocationId', { invocationId: 'invocation-other' }],
  ] as const)('should reject a signed %s mutation', async (_field, mutation) => {
    const custody = source();
    const token = (await issue(custody))!;
    await expectUntrusted(custody, { ...token, ...mutation });
  });
});
