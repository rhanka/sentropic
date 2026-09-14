import { describe, expect, it } from 'vitest';
import {
  BoundedLocalCustodySource,
  type ClusterMeshRegistration,
  type CustodyBinding,
  type SignedCustodyToken,
} from '../src/index.js';

const NOW = '2026-09-13T12:00:00.000Z';
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
  status: 'active', expiresAt: '2026-09-13T14:00:00.000Z',
};

function fixture(allowedClockSkewSeconds = 0) {
  let now = new Date(NOW);
  let record = registration;
  const source = new BoundedLocalCustodySource({
    issuerId: 'custody-source-1', registrations: { async find() { return record; } },
    bindings: [binding], maximumTtlSeconds: 60, allowedClockSkewSeconds, now: () => now,
  });
  return {
    source,
    setNow(value: string) { now = new Date(value); },
    setRegistration(value: ClusterMeshRegistration) { record = value; },
  };
}

const issue = (source: BoundedLocalCustodySource, invocationId = 'invocation-1') => source.issue({
  registrationId: registration.registrationId, action: 'drive',
  holderPrincipalId: binding.holderPrincipalId, invocationId,
});
const expected = (token: SignedCustodyToken) => ({
  audience: token.audience, registrationId: token.registrationId, action: token.action,
  holderPrincipalId: token.holderPrincipalId, epoch: token.epoch,
  custodyId: token.custodyId, invocationId: token.invocationId,
});

describe('bounded-local custody lifecycle', () => {
  it('should reject an unknown revocation selector kind fail closed', async () => {
    const { source } = fixture();
    await expect(source.revoke({
      selector: { kind: 'unknown' } as never, reason: 'invalid selector',
    })).rejects.toThrow('unknown custody revocation selector kind');
  });

  it('should revoke one token without revoking its binding', async () => {
    const { source } = fixture();
    const token = (await issue(source))!;
    await expect(source.revoke({
      selector: { kind: 'token', tokenId: token.tokenId }, reason: 'compromised bearer',
    })).resolves.toMatchObject({ issuerId: source.issuerId, reason: 'compromised bearer', revokedAt: NOW });
    await expect(source.verify(token, expected(token)))
      .resolves.toEqual({ ok: false, reason: 'revoked' });
    await expect(source.consume(token, expected(token)))
      .resolves.toEqual({ ok: false, reason: 'revoked' });
    await expect(issue(source, 'invocation-2')).resolves.not.toBeNull();
  });

  it('should revoke a binding for existing and future issuance', async () => {
    const { source } = fixture();
    const token = (await issue(source))!;
    await source.revoke({
      selector: {
        kind: 'binding', registrationId: token.registrationId, custodyId: token.custodyId,
        holderPrincipalId: token.holderPrincipalId, epoch: token.epoch,
      },
      reason: 'custody rotated',
    });
    await expect(source.verify(token, expected(token)))
      .resolves.toEqual({ ok: false, reason: 'revoked' });
    await expect(source.consume(token, expected(token)))
      .resolves.toEqual({ ok: false, reason: 'revoked' });
    await expect(issue(source, 'invocation-2')).resolves.toBeNull();
  });

  it('should revoke a holder across tokens and future issuance', async () => {
    const { source } = fixture();
    const token = (await issue(source))!;
    await source.revoke({
      selector: { kind: 'holder', holderPrincipalId: token.holderPrincipalId },
      reason: 'session revoked',
    });
    await expect(source.verify(token, expected(token)))
      .resolves.toEqual({ ok: false, reason: 'revoked' });
    await expect(source.consume(token, expected(token)))
      .resolves.toEqual({ ok: false, reason: 'revoked' });
    await expect(issue(source, 'invocation-2')).resolves.toBeNull();
  });

  it('should fence a prior epoch and issue only from the current binding', async () => {
    const { source, setRegistration } = fixture();
    const oldToken = (await issue(source))!;
    setRegistration({ ...registration, custodyEpoch: 2 });
    source.setBinding({ ...binding, custodyId: 'custody-2', epoch: 2 });

    await expect(source.verify(oldToken, expected(oldToken)))
      .resolves.toEqual({ ok: false, reason: 'unbound' });
    await expect(source.consume(oldToken, expected(oldToken)))
      .resolves.toEqual({ ok: false, reason: 'unbound' });
    await expect(issue(source, 'invocation-2')).resolves.toMatchObject({
      epoch: 2, custodyId: 'custody-2', invocationId: 'invocation-2',
    });
  });

  it('should atomically consume one sibling token for an invocation tuple', async () => {
    const { source } = fixture();
    const first = (await issue(source))!;
    const second = (await issue(source))!;
    expect(first.tokenId).not.toBe(second.tokenId);
    const decisions = await Promise.all([
      source.consume(first, expected(first)), source.consume(second, expected(second)),
    ]);
    expect(decisions.filter((decision) => decision.ok)).toHaveLength(1);
    expect(decisions.filter((decision) => !decision.ok))
      .toEqual([{ ok: false, reason: 'replayed' }]);
  });

  it('should require a new invocation ID for a retry', async () => {
    const { source } = fixture();
    const first = (await issue(source))!;
    await expect(source.consume(first, expected(first))).resolves.toMatchObject({ ok: true });
    const sameInvocation = (await issue(source))!;
    await expect(source.consume(sameInvocation, expected(sameInvocation)))
      .resolves.toEqual({ ok: false, reason: 'replayed' });
    const retry = (await issue(source, 'invocation-2'))!;
    await expect(source.consume(retry, expected(retry))).resolves.toMatchObject({ ok: true });
  });

  it('should retain token and invocation replay fences throughout the consume skew window', async () => {
    const { source, setNow } = fixture(5);
    const token = (await issue(source))!;
    const sibling = (await issue(source))!;
    await expect(source.consume(token, expected(token))).resolves.toMatchObject({ ok: true });

    setNow('2026-09-13T12:01:04.999Z');
    await expect(source.consume(token, expected(token)))
      .resolves.toEqual({ ok: false, reason: 'replayed' });
    await expect(source.consume(sibling, expected(sibling)))
      .resolves.toEqual({ ok: false, reason: 'replayed' });
  });
});
