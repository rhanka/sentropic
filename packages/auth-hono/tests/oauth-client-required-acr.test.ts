import { describe, expect, it } from 'vitest';

import { meetsRequiredAcr } from '../src/oauth/authorize-handler.js';
import {
  authorizePath,
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

const PASSKEY = 'urn:sentropic:loa:passkey-fresh';

const policyClient = createOauthClient({ requiredAcr: PASSKEY });

describe('meetsRequiredAcr', () => {
  it('allows any session when no policy is set', () => {
    expect(meetsRequiredAcr('urn:sentropic:loa:bearer', null)).toBe(true);
    expect(meetsRequiredAcr('urn:sentropic:loa:bearer', undefined)).toBe(true);
    expect(meetsRequiredAcr(PASSKEY, null)).toBe(true);
  });

  it('requires passkey-fresh for policy clients and fails closed on unknown values', () => {
    expect(meetsRequiredAcr(PASSKEY, PASSKEY)).toBe(true);
    expect(meetsRequiredAcr('urn:sentropic:loa:bearer', PASSKEY)).toBe(false);
    expect(meetsRequiredAcr(PASSKEY, 'urn:unknown')).toBe(false);
  });
});

describe('OAuth authorize per-client MFA policy (B3)', () => {
  it('forces re-authentication (login redirect) for a bearer session on a policy client', async () => {
    const { ports } = await createOauthPorts({
      authenticated: true,
      clients: [policyClient],
      sessionMfaVerified: false,
    });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath());

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/login');
  });

  it('lets a passkey session through to consent on a policy client', async () => {
    const { ports } = await createOauthPorts({
      authenticated: true,
      clients: [policyClient],
      sessionMfaVerified: true,
    });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath());

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
  });

  it('leaves bearer sessions untouched when the client has no policy', async () => {
    const { ports } = await createOauthPorts({
      authenticated: true,
      sessionMfaVerified: false,
    });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath());

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
  });

  it('refuses a still-bearer session after login with access_denied (magic-link/Google path)', async () => {
    const { ports, store } = await createOauthPorts({ clients: [policyClient] });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const initial = await router.request(authorizePath());
    const continuation = new URL(initial.headers.get('location') ?? '').searchParams.get('continue') ?? '';

    const { ports: bearerPorts } = await createOauthPorts({
      authenticated: true,
      clients: [policyClient],
      sessionMfaVerified: false,
      store,
    });
    const { router: bearerRouter } = createOauthRouterForTest({ ports: bearerPorts, stateCodec });

    const response = await bearerRouter.request(
      `/oauth/authorize?continue=${encodeURIComponent(continuation)}`
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/callback');
    expect(location.searchParams.get('error')).toBe('access_denied');
  });

  it('B4: forces re-auth for an existing passkey session without UV, then refuses the still-UV-less re-login', async () => {
    // Unlike B3 (no session at all: magic-link/Google landing), B4 starts from a
    // live passkey session whose ceremony skipped user verification: B1 minted it
    // with mfaVerified=false, so the main flow must force a re-auth first ...
    const { ports, store } = await createOauthPorts({
      authenticated: true,
      clients: [policyClient],
      sessionMfaVerified: false,
    });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const initial = await router.request(authorizePath());

    expect(initial.status).toBe(302);
    const loginLocation = new URL(initial.headers.get('location') ?? '');
    expect(`${loginLocation.origin}${loginLocation.pathname}`).toBe('http://localhost:5397/auth/login');
    const continuation = loginLocation.searchParams.get('continue') ?? '';

    // ... and when the re-login ceremony again skips UV (new session id, still
    // mfaVerified=false), the resume path refuses with access_denied instead of
    // looping back to login.
    const { ports: noUvPorts } = await createOauthPorts({
      authenticated: true,
      clients: [policyClient],
      sessionId: 'session-2',
      sessionMfaVerified: false,
      store,
    });
    const { router: noUvRouter } = createOauthRouterForTest({ ports: noUvPorts, stateCodec });

    const response = await noUvRouter.request(
      `/oauth/authorize?continue=${encodeURIComponent(continuation)}`
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/callback');
    expect(location.searchParams.get('error')).toBe('access_denied');
  });

  it('returns login_required for prompt=none with a bearer session on a policy client', async () => {
    const { ports } = await createOauthPorts({
      authenticated: true,
      clients: [policyClient],
      sessionMfaVerified: false,
    });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath({ prompt: 'none' }));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/callback');
    expect(location.searchParams.get('error')).toBe('login_required');
  });

  it('accepts a fresh passkey session after a forced re-auth', async () => {
    const { ports, store } = await createOauthPorts({
      authenticated: true,
      clients: [policyClient],
      sessionMfaVerified: false,
    });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const initial = await router.request(authorizePath());
    const continuation = new URL(initial.headers.get('location') ?? '').searchParams.get('continue') ?? '';

    const { ports: freshPorts } = await createOauthPorts({
      authenticated: true,
      clients: [policyClient],
      sessionId: 'session-2',
      sessionMfaVerified: true,
      store,
    });
    const { router: freshRouter } = createOauthRouterForTest({ ports: freshPorts, stateCodec });

    const response = await freshRouter.request(
      `/oauth/authorize?continue=${encodeURIComponent(continuation)}`
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
  });
});
