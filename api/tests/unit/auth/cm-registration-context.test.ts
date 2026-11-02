import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createOAuthHmacStateCodec } from '../../../../packages/auth-hono/src/oauth/state-codec';
import { resolveCmRegistrationContext } from '../../../src/services/identity/cm-registration-context';

const now = new Date('2026-11-01T00:00:00Z');
const codec = createOAuthHmacStateCodec({ secret: 'synthetic-test-only-state-key' });
const seal = (clientId: string, expiresAt = new Date(+now + 60_000).toISOString()) => codec.seal({
  clientId, expiresAt, createdAt: now.toISOString(), codeChallenge: 'challenge', codeChallengeMethod: 'S256',
  dpopJkt: null, nonce: null, redirectUri: 'https://client.test/callback', scope: 'openid', state: null, tenantId: null,
});
const setup = (clientId: string | null) => {
  const invitation = { email: 'invitee@example.test', clientId };
  return {
    email: invitation.email, now, continuationCodec: codec,
    digest: { sha256: async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex') },
    invitations: { findByDigest: vi.fn(async () => invitation) },
    ticketTokens: { verify: vi.fn() },
  };
};

describe('trusted invitation registration context', () => {
  it('accepts the exact client from a verified live OAuth continuation', async () => {
    const input = setup('client');
    expect(await resolveCmRegistrationContext({ ...input,
      presentation: { email: input.email, verificationToken: 'sit_invitation', oauthContinuation: await seal('client') },
    })).toEqual({ email: input.email, clientId: 'client' });
  });

  it.each(['missing', 'tampered', 'other-client', 'expired'])('refuses %s continuation evidence', async kind => {
    const input = setup('client');
    const token = kind === 'missing' ? undefined : kind === 'tampered' ? `${await seal('client')}x`
      : await seal(kind === 'other-client' ? 'different' : 'client', kind === 'expired' ? now.toISOString() : undefined);
    expect(await resolveCmRegistrationContext({ ...input,
      presentation: { email: input.email, verificationToken: 'sit_invitation', oauthContinuation: token },
    })).toBeNull();
  });

  it('revalidates expiry on a later transaction attempt', async () => {
    const input = setup('client'), oauthContinuation = await seal('client');
    expect(await resolveCmRegistrationContext({ ...input, now: new Date(+now + 60_000),
      presentation: { email: input.email, verificationToken: 'sit_invitation', oauthContinuation },
    })).toBeNull();
  });

  it('preserves invitations without a client binding and refuses another email', async () => {
    const input = setup(null), presentation = { email: input.email, verificationToken: 'sit_invitation' };
    expect(await resolveCmRegistrationContext({ ...input, presentation })).toEqual({ email: input.email, clientId: null });
    expect(await resolveCmRegistrationContext({ ...input, email: 'other@example.test', presentation })).toBeNull();
  });
});
