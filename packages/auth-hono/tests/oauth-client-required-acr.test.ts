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

  it('B4: refuses a passkey session without UV (mfaVerified=false) on a policy client', async () => {
    const { ports, store } = await createOauthPorts({ clients: [policyClient] });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const initial = await router.request(authorizePath());
    const continuation = new URL(initial.headers.get('location') ?? '').searchParams.get('continue') ?? '';

    // A passkey ceremony without user verification mints mfaVerified=false (B1),
    // which is indistinguishable from a bearer session at authorize time — and
    // must be refused for policy clients all the same.
    const { ports: noUvPorts } = await createOauthPorts({
      authenticated: true,
      clients: [policyClient],
      sessionMfaVerified: false,
      store,
    });
    const { router: noUvRouter } = createOauthRouterForTest({ ports: noUvPorts, stateCodec });

    const response = await noUvRouter.request(
      `/oauth/authorize?continue=${encodeURIComponent(continuation)}`
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('access_denied');
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
