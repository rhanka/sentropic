import { describe, expect, it, vi } from 'vitest';

import {
  createFacebookProvider,
  fetchFacebookIdentity,
} from '../../../src/services/auth/federation/facebook-provider';

const SECRET_TOKEN = 'EAAB_SECRET-facebook-token-must-never-leak';

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({ json: async () => body, ok, status }) as unknown as Response;

describe('Facebook federation provider (BR-39e Lot 5)', () => {
  it('builds an authorization URL with state, email, and public_profile scopes', () => {
    const provider = createFacebookProvider({
      clientId: 'facebook-client',
      clientSecret: 'facebook-secret',
      redirectUri: 'https://auth.example.com/auth/federation/facebook/callback',
    });

    const url = new URL(
      provider.createAuthorizationUrl({ codeVerifier: 'unused', nonce: 'unused', state: 'state-123' }) as string,
    );

    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['email', 'public_profile']),
    );
  });

  it('derives subject from the string id and treats a returned email as unverified', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ email: 'person@example.com', id: '1020304050', name: 'Person' }),
    );

    const identity = await fetchFacebookIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN);

    expect(identity).toEqual({
      email: 'person@example.com',
      emailVerified: false,
      subject: '1020304050',
    });
    expect(JSON.stringify(identity)).not.toContain(SECRET_TOKEN);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://graph.facebook.com/me?fields=id,name,email',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${SECRET_TOKEN}` }),
      }),
    );
  });

  it('returns a challenge-ready identity when email is absent or declined', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'fb-no-email', name: 'Private Person' }));

    const identity = await fetchFacebookIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN);

    expect(identity).toEqual({ email: null, emailVerified: false, subject: 'fb-no-email' });
  });

  it('rejects a failed Graph profile response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'denied' }, false, 401));

    await expect(
      fetchFacebookIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN),
    ).rejects.toThrow(/status 401/);
  });

  it('rejects a Graph profile without a non-empty string id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ email: 'person@example.com', id: 42 }));

    await expect(
      fetchFacebookIdentity(fetchImpl as unknown as typeof fetch, SECRET_TOKEN),
    ).rejects.toThrow(/string account id/);
  });
});
