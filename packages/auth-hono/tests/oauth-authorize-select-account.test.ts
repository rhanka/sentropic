import { describe, expect, it } from 'vitest';

import {
  authorizePath,
  createOauthPorts,
  createOauthRouterForTest,
  createOauthSession,
} from './__fixtures__/oauth-fixtures.js';

const loginUrl = 'http://localhost:5397/auth/login';
const consentUrl = 'http://localhost:5397/auth/oauth/consent';

const locationPath = (response: Response): string => {
  const location = new URL(response.headers.get('location') ?? '');
  return `${location.origin}${location.pathname}`;
};

describe('OAuth authorize prompt=select_account / prompt=login (C2 force-reauth)', () => {
  it('redirects a logged-in user to login and seals forceReauth + the current session id on select_account', async () => {
    const { ports } = await createOauthPorts({ authenticated: true });
    const { router, stateCodec } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath({ prompt: 'select_account' }));

    expect(response.status).toBe(302);
    expect(locationPath(response)).toBe(loginUrl);
    const continuation = new URL(response.headers.get('location') ?? '').searchParams.get('continue') ?? '';
    const payload = await stateCodec.unseal(continuation);
    expect(payload).toMatchObject({ forceReauth: true, forceReauthSessionId: 'session-1' });
    // No user is sealed yet (re-auth pending).
    expect(payload?.userId).toBeUndefined();
  });

  it('re-redirects a resume that still resolves to the SAME session id back to login (not consent)', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const initial = await router.request(authorizePath({ prompt: 'select_account' }));
    const continuation =
      new URL(initial.headers.get('location') ?? '').searchParams.get('continue') ?? '';

    // The user did NOT actually re-auth: the resume still resolves to session-1 (the sealed id).
    const { ports: samePorts } = await createOauthPorts({ authenticated: true, store });
    const { router: sameRouter } = createOauthRouterForTest({ ports: samePorts, stateCodec });

    const response = await sameRouter.request(
      `/oauth/authorize?continue=${encodeURIComponent(continuation)}`,
    );

    expect(response.status).toBe(302);
    expect(locationPath(response)).toBe(loginUrl);
  });

  it('proceeds to consent when the resume resolves to a NEW (different) session id', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const initial = await router.request(authorizePath({ prompt: 'select_account' }));
    const continuation =
      new URL(initial.headers.get('location') ?? '').searchParams.get('continue') ?? '';

    // Simulate a genuinely fresh login: a NEW session id (≠ the sealed session-1). Both the token
    // claims and the looked-up session record must agree on the new id (resolveOAuthSession cross-checks).
    const { ports: freshPorts } = await createOauthPorts({ authenticated: true, store });
    freshPorts.sessions = {
      ...freshPorts.sessions,
      findByTokenHash: async (hash: string) =>
        hash === 'hash:session-token' ? createOauthSession({ id: 'session-2' }) : null,
    };
    freshPorts.tokens = {
      ...freshPorts.tokens,
      verifySessionToken: async (token: string) =>
        token === 'session-token'
          ? { email: 'ada@example.com', role: 'member', sessionId: 'session-2', userId: 'user-1' }
          : null,
    };
    const { router: freshRouter } = createOauthRouterForTest({ ports: freshPorts, stateCodec });

    const response = await freshRouter.request(
      `/oauth/authorize?continue=${encodeURIComponent(continuation)}`,
    );

    expect(response.status).toBe(302);
    expect(locationPath(response)).toBe(consentUrl);
  });

  it('returns account_selection_required for prompt=select_account + none, login_required for prompt=login + none', async () => {
    const { ports } = await createOauthPorts({ authenticated: true });
    const { router } = createOauthRouterForTest({ ports });

    const selectNone = await router.request(authorizePath({ prompt: 'select_account none' }));
    expect(selectNone.status).toBe(302);
    expect(new URL(selectNone.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'account_selection_required',
    );

    const loginNone = await router.request(authorizePath({ prompt: 'login none' }));
    expect(loginNone.status).toBe(302);
    expect(new URL(loginNone.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'login_required',
    );
  });

  it('regression: prompt=login also force-reauths (same resume rejection on identical session id)', async () => {
    const { ports, store } = await createOauthPorts({ authenticated: true });
    const { router, stateCodec } = createOauthRouterForTest({ ports });

    const initial = await router.request(authorizePath({ prompt: 'login' }));
    expect(locationPath(initial)).toBe(loginUrl);
    const continuation =
      new URL(initial.headers.get('location') ?? '').searchParams.get('continue') ?? '';
    const payload = await stateCodec.unseal(continuation);
    expect(payload).toMatchObject({ forceReauth: true, forceReauthSessionId: 'session-1' });

    const { ports: samePorts } = await createOauthPorts({ authenticated: true, store });
    const { router: sameRouter } = createOauthRouterForTest({ ports: samePorts, stateCodec });
    const resume = await sameRouter.request(
      `/oauth/authorize?continue=${encodeURIComponent(continuation)}`,
    );
    expect(locationPath(resume)).toBe(loginUrl);
  });
});
