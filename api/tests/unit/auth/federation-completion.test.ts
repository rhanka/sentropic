import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { describe, expect, it, vi } from 'vitest';
import { createFederationBroker } from '../../../src/services/auth/federation/broker';
import { FederationCompletionRefusal, type FederationIdentityAttempt } from '../../../src/services/auth/federation/types';

const now = new Date('2026-11-01T00:00:00Z');
const setup = () => {
  const identity = { email: 'actor@example.com', emailVerified: true, subject: 'subject' };
  const flow = { id: 'flow', provider: 'google', upstreamState: 'state', codeVerifier: 'verifier',
    nonce: 'nonce', continuationToken: null, createdAt: now, expiresAt: new Date(now.getTime() + 60_000) };
  const attempt: FederationIdentityAttempt = {
    now, audit: { record: vi.fn() },
    federation: { findIdentityBySubject: vi.fn(async () => null), linkIdentity: vi.fn(), touchLogin: vi.fn() },
    authenticate: vi.fn(), resolveFederatedUser: vi.fn(), requireLinkActor: vi.fn(),
    verifyEmailProof: vi.fn(), consumeEmailProof: vi.fn(),
  };
  const complete = vi.fn(async <T>(work: (ports: FederationIdentityAttempt) => Promise<T>) => work(attempt));
  const verify = vi.fn(async () => identity);
  const consume = vi.fn(async () => flow);
  const broker = createFederationBroker({
    complete, provider: { id: 'google', verifyCallback: verify, createAuthorizationUrl: () => 'https://provider.test' },
    federation: { consumeFlowState: consume, createFlowState: vi.fn() },
    clock: { now: () => now, addSeconds: (at, seconds) => new Date(at.getTime() + seconds * 1000) },
    audit: { record: vi.fn() }, secrets: { state: () => 'state', nonce: () => 'nonce', codeVerifier: () => 'verifier' },
    config: { autoLinkProviders: new Set(['google']), authorizeUrl: 'https://app.test/oauth',
      landingUrl: 'https://app.test/', flowStateTtlSeconds: 60 },
  });
  return { attempt, broker, complete, consume, verify };
};
const request = { flowStateId: 'flow', state: 'state', code: 'code', error: null, linkUserId: 'actor' };

describe('federation whole-completion boundary', () => {
  it('propagates a failed insert without a same-transaction reread or false success', async () => {
    const h = setup(), failure = new Error('private retry signal');
    vi.mocked(h.attempt.federation.linkIdentity).mockRejectedValue(failure);
    await expect(h.broker.linkCallback(request)).rejects.toBe(failure);
    expect(h.attempt.federation.findIdentityBySubject).toHaveBeenCalledTimes(1);
    expect(h.attempt.requireLinkActor).toHaveBeenCalledWith('actor');
    expect(h.attempt.authenticate).not.toHaveBeenCalled();
  });

  it('rechecks the actor on retry without repeating upstream exchange or flow consumption', async () => {
    const h = setup();
    vi.mocked(h.attempt.federation.linkIdentity).mockRejectedValueOnce(new Error('retry'));
    h.complete.mockImplementationOnce(async work => {
      await expect(work(h.attempt)).rejects.toThrow('retry');
      vi.mocked(h.attempt.requireLinkActor).mockRejectedValueOnce(
        new FederationCompletionRefusal(401, 'authentication_required', 'Sign in before linking a provider.'));
      return work(h.attempt);
    });
    expect(await h.broker.linkCallback(request)).toMatchObject({ kind: 'error', status: 401 });
    expect(h.attempt.requireLinkActor).toHaveBeenCalledTimes(2);
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.consume).toHaveBeenCalledTimes(1);
  });

  it('maps only the fixed ownership conflict after the completion has unwound', async () => {
    const h = setup();
    h.complete.mockRejectedValueOnce(new IdentityCustodyErrorV1('social_subject_conflict'));
    expect(await h.broker.linkCallback(request)).toMatchObject({ kind: 'error', status: 409,
      body: { error: { code: 'identity_linked_other_account' } } });
  });

  it('refuses expired upstream evidence on a fresh completion attempt', async () => {
    const h = setup();
    h.complete.mockImplementationOnce(work => work({ ...h.attempt, now: new Date(now.getTime() + 60_000) }));
    expect(await h.broker.callback(request)).toMatchObject({ kind: 'error', status: 401 });
    expect(h.attempt.resolveFederatedUser).not.toHaveBeenCalled();
    expect(h.attempt.authenticate).not.toHaveBeenCalled();
  });

  it('does not expose login success if the email ticket loses its consume race', async () => {
    const h = setup();
    vi.mocked(h.attempt.resolveFederatedUser).mockResolvedValue({ kind: 'created', userId: 'created', identity: {} as never });
    vi.mocked(h.attempt.consumeEmailProof).mockRejectedValue(new Error('consume conflict'));
    await expect(h.broker.completeEmailChallenge({ provider: 'google', providerSubject: 'subject',
      verifiedEmail: 'actor@example.com', verificationToken: 'ticket', continuation: null,
      expiresAt: new Date(now.getTime() + 60_000).toISOString() })).rejects.toThrow('consume conflict');
    expect(h.attempt.verifyEmailProof).toHaveBeenCalledWith('actor@example.com', 'ticket');
    expect(h.attempt.consumeEmailProof).toHaveBeenCalledWith('created');
    expect(h.attempt.authenticate).not.toHaveBeenCalled();
  });
});
