import { describe, expect, it } from 'vitest';
import {
  BoundedLocalCustodySource,
  type ClusterMeshRegistration,
  type CustodyBinding,
  type SignedCustodyToken,
} from '../src/index.js';

const ISSUED_AT = '2026-09-13T12:00:00.000Z';
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

function fixture() {
  let now = new Date(ISSUED_AT);
  const source = new BoundedLocalCustodySource({
    issuerId: 'custody-source-1', registrations: { async find() { return registration; } },
    bindings: [binding], maximumTtlSeconds: 60, allowedClockSkewSeconds: 5,
    now: () => now,
  });
  return { source, setNow(value: string) { now = new Date(value); } };
}

const issue = (source: BoundedLocalCustodySource, invocationId: string) => source.issue({
  registrationId: registration.registrationId, action: 'drive',
  holderPrincipalId: binding.holderPrincipalId, invocationId,
});

const expected = (token: SignedCustodyToken) => ({
  audience: token.audience, registrationId: token.registrationId, action: token.action,
  holderPrincipalId: token.holderPrincipalId, epoch: token.epoch,
  custodyId: token.custodyId, invocationId: token.invocationId,
});

describe('custody token freshness', () => {
  it('should accept the issued-at skew boundary on verify and consume', async () => {
    const { source, setNow } = fixture();
    const verified = (await issue(source, 'invocation-verify'))!;
    const consumed = (await issue(source, 'invocation-consume'))!;

    setNow('2026-09-13T11:59:55.000Z');
    await expect(source.verify(verified, expected(verified))).resolves.toMatchObject({ ok: true });
    await expect(source.consume(consumed, expected(consumed))).resolves.toMatchObject({ ok: true });
  });

  it('should reject a token issued 1 ms beyond skew on verify and consume', async () => {
    const { source, setNow } = fixture();
    const verified = (await issue(source, 'invocation-verify'))!;
    const consumed = (await issue(source, 'invocation-consume'))!;

    setNow('2026-09-13T11:59:54.999Z');
    await expect(source.verify(verified, expected(verified)))
      .resolves.toEqual({ ok: false, reason: 'stale' });
    await expect(source.consume(consumed, expected(consumed)))
      .resolves.toEqual({ ok: false, reason: 'stale' });
  });

  it('should accept the expiration skew boundary on verify and consume', async () => {
    const { source, setNow } = fixture();
    const verified = (await issue(source, 'invocation-verify'))!;
    const consumed = (await issue(source, 'invocation-consume'))!;

    setNow('2026-09-13T12:01:05.000Z');
    await expect(source.verify(verified, expected(verified))).resolves.toMatchObject({ ok: true });
    await expect(source.consume(consumed, expected(consumed))).resolves.toMatchObject({ ok: true });
  });

  it('should reject a token expired 1 ms beyond skew on verify and consume', async () => {
    const { source, setNow } = fixture();
    const verified = (await issue(source, 'invocation-verify'))!;
    const consumed = (await issue(source, 'invocation-consume'))!;

    setNow('2026-09-13T12:01:05.001Z');
    await expect(source.verify(verified, expected(verified)))
      .resolves.toEqual({ ok: false, reason: 'stale' });
    await expect(source.consume(consumed, expected(consumed)))
      .resolves.toEqual({ ok: false, reason: 'stale' });
  });
});
