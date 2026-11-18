import { describe, expect, it } from 'vitest';

import { MuseCodeEnrollmentProvider } from '../../src/enrollment/muse-code.js';

const jsonResponse = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

const setupFlow = (tokenPayload: unknown) => {
  const routes: Array<{ match: (url: string) => boolean; respond: () => unknown }> = [
    {
      match: (u) => u.includes('/oidc/device/authorization/'),
      respond: () => jsonResponse({ device_code: 'dev-1', user_code: 'USER-1', verification_uri_complete: 'https://example.test/a', expires_in: 900, interval: 0 }),
    },
    {
      match: (u) => u.includes('/oidc/device/token/'),
      respond: () => jsonResponse(tokenPayload),
    },
    {
      match: (u) => u.includes('/muse-code/key'),
      respond: () => jsonResponse({ api_key: 'minted-seat-key', user_email: 'seat@example.test' }),
    },
  ];
  const fetchFn = (async (url: unknown) => {
    const route = routes.find((r) => r.match(String(url)));
    if (!route) throw new Error(`unexpected fetch: ${String(url)}`);
    return route.respond();
  }) as typeof fetch;
  return new MuseCodeEnrollmentProvider({ fetchFn });
};

describe('Muse device-flow seat lifetime (t+1h defect)', () => {
  it('does not inherit the OAuth expires_in for the minted key', async () => {
    const provider = setupFlow({ access_token: 'dca-token-1', expires_in: 3600 });
    const started = await provider.start({ configRef: 'default', mode: 'cli', redirectUri: 'http://127.0.0.1', ownerScope: 'tenant-1:user-1' });
    const completed = await provider.pollForCompletion(started.enrollmentId, 5);
    expect(completed.credential?.accessToken).toBe('minted-seat-key');
    // The minted key has no measured expiry: unknown, validated on use.
    expect(completed.credential?.expiresAt).toBe('');
  });

  it('persists the device-flow access token for a later re-mint', async () => {
    const provider = setupFlow({ access_token: 'dca-token-keep', expires_in: 3600 });
    const started = await provider.start({ configRef: 'default', mode: 'cli', redirectUri: 'http://127.0.0.1', ownerScope: 'tenant-1:user-1' });
    const completed = await provider.pollForCompletion(started.enrollmentId, 5);
    expect(completed.credential?.museDeviceAccessToken).toBe('dca-token-keep');
  });

  it('re-mints through the stored device token when no refresh token exists', async () => {
    const provider = setupFlow({ access_token: 'dca-token-1', expires_in: 3600 });
    const started = await provider.start({ configRef: 'default', mode: 'cli', redirectUri: 'http://127.0.0.1', ownerScope: 'tenant-1:user-1' });
    const completed = await provider.pollForCompletion(started.enrollmentId, 5);
    const credential = completed.credential!;
    const refreshed = await provider.refresh({
      accountId: credential.accountId,
      credentialVersion: credential.authClientConfigVersion,
      museDeviceAccessToken: credential.museDeviceAccessToken,
    });
    expect(refreshed.accessToken).toBe('minted-seat-key');
    expect(refreshed.accountId).toBe(credential.accountId);
  });

  it('fails closed with a typed auth signal when no grant exists', async () => {
    const provider = setupFlow({ access_token: 'dca-token-1', expires_in: 3600 });
    const started = await provider.start({ configRef: 'default', mode: 'cli', redirectUri: 'http://127.0.0.1', ownerScope: 'tenant-1:user-1' });
    const completed = await provider.pollForCompletion(started.enrollmentId, 5);
    const credential = completed.credential!;
    const error = await provider.refresh({
      accountId: credential.accountId,
      credentialVersion: credential.authClientConfigVersion,
    }).catch((e: unknown) => e as Error & { status?: number; code?: string });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('AUTHENTICATION_FAILED');
    expect(error.status).toBe(401);
  });
});
