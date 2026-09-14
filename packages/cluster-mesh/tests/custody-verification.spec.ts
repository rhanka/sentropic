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
  custodyHolderPrincipalId: 'holder-1', custodyEpoch: 2,
  actuatorRef: 'pty:session-1', status: 'active',
  expiresAt: '2026-09-13T14:00:00.000Z', leaseExpiresAt: '2026-09-13T14:00:00.000Z',
};
const binding: CustodyBinding = {
  registrationId: registration.registrationId, custodyId: 'custody-1',
  holderPrincipalId: 'holder-1', epoch: 2, meshDomain: 'mesh.example.test',
  status: 'active', expiresAt: '2026-09-13T14:00:00.000Z',
};

function fixture() {
  let now = new Date('2026-09-13T12:00:00.000Z');
  let unavailable = false;
  const source = new BoundedLocalCustodySource({
    issuerId: 'custody-source-1',
    registrations: {
      async find(id) {
        if (unavailable) throw new Error('registration store unavailable');
        return id === registration.registrationId ? registration : null;
      },
    },
    bindings: [binding], maximumTtlSeconds: 60, now: () => now,
  });
  return {
    source,
    setNow(value: string) { now = new Date(value); },
    failStore() { unavailable = true; },
  };
}

const issue = (source: BoundedLocalCustodySource, invocationId = 'invocation-1') => source.issue({
  registrationId: registration.registrationId, action: 'drive',
  holderPrincipalId: binding.holderPrincipalId, invocationId,
});

const expectation = (token: SignedCustodyToken): CustodyTokenExpectation => ({
  audience: binding.meshDomain, registrationId: registration.registrationId,
  action: 'drive', holderPrincipalId: binding.holderPrincipalId,
  epoch: binding.epoch, custodyId: binding.custodyId, invocationId: token.invocationId,
});

describe('bounded-local custody verification', () => {
  it('should verify without consuming and consume exactly once', async () => {
    const { source } = fixture();
    const token = (await issue(source))!;
    const expected = expectation(token);

    await expect(source.verify(token, expected)).resolves.toEqual({ ok: true, token });
    await expect(source.verify(token, expected)).resolves.toEqual({ ok: true, token });
    await expect(source.consume(token, expected)).resolves.toEqual({ ok: true, token });
    await expect(source.verify(token, expected)).resolves.toEqual({ ok: false, reason: 'replayed' });
    await expect(source.consume(token, expected)).resolves.toEqual({ ok: false, reason: 'replayed' });
  });

  it('should reject a token outside the pinned trust root as untrusted', async () => {
    const first = fixture().source;
    const second = fixture().source;
    const token = (await issue(first))!;
    await expect(second.verify(token, expectation(token)))
      .resolves.toEqual({ ok: false, reason: 'untrusted' });
    await expect(second.consume(token, expectation(token)))
      .resolves.toEqual({ ok: false, reason: 'untrusted' });
  });

  it('should reject a signed token against a different expectation as unbound', async () => {
    const { source } = fixture();
    const token = (await issue(source))!;
    await expect(source.verify(token, { ...expectation(token), action: 'wake' }))
      .resolves.toEqual({ ok: false, reason: 'unbound' });
    await expect(source.consume(token, { ...expectation(token), action: 'wake' }))
      .resolves.toEqual({ ok: false, reason: 'unbound' });
  });

  it.each([
    ['target', { registrationId: 'registration-other' }],
    ['holder', { holderPrincipalId: 'holder-other' }],
    ['audience', { audience: 'other-mesh.example.test' }],
    ['invocation', { invocationId: 'invocation-other' }],
  ])('should reject cross-%s substitution as unbound', async (_dimension, mismatch) => {
    const { source } = fixture();
    const token = (await issue(source))!;
    const substituted = { ...expectation(token), ...mismatch };
    await expect(source.verify(token, substituted))
      .resolves.toEqual({ ok: false, reason: 'unbound' });
    await expect(source.consume(token, substituted))
      .resolves.toEqual({ ok: false, reason: 'unbound' });
  });

  it('should reject an expired token as stale', async () => {
    const { source, setNow } = fixture();
    const token = (await issue(source))!;
    setNow('2026-09-13T12:01:00.001Z');
    await expect(source.verify(token, expectation(token)))
      .resolves.toEqual({ ok: false, reason: 'stale' });
    await expect(source.consume(token, expectation(token)))
      .resolves.toEqual({ ok: false, reason: 'stale' });
  });

  it('should fail closed as unavailable when current registration state cannot load', async () => {
    const { source, failStore } = fixture();
    const token = (await issue(source))!;
    failStore();
    await expect(source.verify(token, expectation(token)))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(source.consume(token, expectation(token)))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});
