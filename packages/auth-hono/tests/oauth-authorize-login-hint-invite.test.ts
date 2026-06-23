import { describe, expect, it } from 'vitest';

import {
  authorizePath,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

const loginUrl = 'http://localhost:5397/auth/login';
const registerUrl = 'http://localhost:5397/auth/register';

const locationPath = (response: Response): string => {
  const location = new URL(response.headers.get('location') ?? '');
  return `${location.origin}${location.pathname}`;
};

const locationParams = (response: Response): URLSearchParams =>
  new URL(response.headers.get('location') ?? '').searchParams;

describe('OAuth authorize login_hint + sentropic_invite_token routing (BR-39r L4, C3 presence-only)', () => {
  it('routes an invite (no session) to the register URL carrying login_hint + the invite token as plain params', async () => {
    const { ports } = await createOauthPorts({ authenticated: false });
    const { router } = createOauthRouterForTest({ ports, registerUrl });

    const response = await router.request(
      authorizePath({ login_hint: 'invited@example.com', sentropic_invite_token: 'sit_opaque123' }),
    );

    expect(response.status).toBe(302);
    expect(locationPath(response)).toBe(registerUrl);
    const params = locationParams(response);
    expect(params.get('login_hint')).toBe('invited@example.com');
    expect(params.get('sentropic_invite_token')).toBe('sit_opaque123');
    // The OAuth request stays sealed in `continue` (not in plain params).
    expect(params.get('continue')).toBeTruthy();
  });

  it('routes login_hint alone (no invite, no session) to the login URL carrying the email hint', async () => {
    const { ports } = await createOauthPorts({ authenticated: false });
    const { router } = createOauthRouterForTest({ ports, registerUrl });

    const response = await router.request(authorizePath({ login_hint: 'known@example.com' }));

    expect(response.status).toBe(302);
    expect(locationPath(response)).toBe(loginUrl);
    expect(locationParams(response).get('login_hint')).toBe('known@example.com');
    expect(locationParams(response).get('sentropic_invite_token')).toBeNull();
  });

  it('does NOT reveal invite validity by redirect shape: an arbitrary (unchecked) invite token still routes to register', async () => {
    const { ports } = await createOauthPorts({ authenticated: false });
    const { router } = createOauthRouterForTest({ ports, registerUrl });

    // authorize never checks invite validity (C3) — presence alone routes to register.
    const valid = await router.request(authorizePath({ sentropic_invite_token: 'sit_realish' }));
    const bogus = await router.request(authorizePath({ sentropic_invite_token: 'sit_totally-bogus' }));

    expect(locationPath(valid)).toBe(registerUrl);
    expect(locationPath(bogus)).toBe(registerUrl);
  });

  it('continues normally for a live SAME-user session + invite (no consume, no register redirect)', async () => {
    const { ports } = await createOauthPorts({ authenticated: true });
    const { router } = createOauthRouterForTest({ ports, registerUrl });

    // login_hint matches the session user's email (ada@example.com) ⇒ proceed to consent, not register.
    const response = await router.request(
      authorizePath({ login_hint: 'ada@example.com', sentropic_invite_token: 'sit_anything' }),
    );

    expect(response.status).toBe(302);
    expect(locationPath(response)).toBe('http://localhost:5397/auth/oauth/consent');
  });

  it('forces account switch when a live session resolves to a DIFFERENT email than login_hint', async () => {
    const { ports } = await createOauthPorts({ authenticated: true });
    const { router, stateCodec } = createOauthRouterForTest({ ports, registerUrl });

    const response = await router.request(authorizePath({ login_hint: 'someone-else@example.com' }));

    expect(response.status).toBe(302);
    expect(locationPath(response)).toBe(loginUrl);
    const continuation = locationParams(response).get('continue') ?? '';
    const payload = await stateCodec.unseal(continuation);
    expect(payload).toMatchObject({ forceReauth: true, forceReauthSessionId: 'session-1' });
    // The login URL still carries the hint so the form can pre-fill the target account.
    expect(locationParams(response).get('login_hint')).toBe('someone-else@example.com');
  });

  it('falls back to login (not register) when an invite is present but no registerUrl is configured', async () => {
    const { ports } = await createOauthPorts({ authenticated: false });
    const { router } = createOauthRouterForTest({ ports }); // no registerUrl

    const response = await router.request(authorizePath({ sentropic_invite_token: 'sit_x' }));

    expect(response.status).toBe(302);
    expect(locationPath(response)).toBe(loginUrl);
  });
});
