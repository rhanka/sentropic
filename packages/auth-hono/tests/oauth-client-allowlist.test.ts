import { describe, expect, it } from 'vitest';

import { isSubjectAllowed } from '../src/oauth/authorize-handler.js';
import {
  authorizePath,
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

describe('isSubjectAllowed', () => {
  it('allows every subject when the list is empty or absent', () => {
    expect(isSubjectAllowed('user-1', [])).toBe(true);
    expect(isSubjectAllowed('user-1', null)).toBe(true);
    expect(isSubjectAllowed('user-1', undefined)).toBe(true);
  });

  it('restricts to listed subjects otherwise', () => {
    expect(isSubjectAllowed('user-1', ['user-1'])).toBe(true);
    expect(isSubjectAllowed('user-2', ['user-1'])).toBe(false);
  });
});

describe('OAuth authorize per-client subject allowlist (C1)', () => {
  it('refuses a non-listed subject before consent with access_denied', async () => {
    const client = createOauthClient({ allowedUserIds: ['owner-1'] });
    const { ports } = await createOauthPorts({ authenticated: true, clients: [client] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath());

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/callback');
    expect(location.searchParams.get('error')).toBe('access_denied');
  });

  it('lets prompt=login switch account instead of refusing a non-listed session', async () => {
    const client = createOauthClient({ allowedUserIds: ['owner-1'] });
    const { ports } = await createOauthPorts({ authenticated: true, clients: [client] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath({ prompt: 'login' }));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/login');
    expect(location.searchParams.get('error')).toBeNull();
  });

  it('lets a listed subject through to consent', async () => {
    const client = createOauthClient({ allowedUserIds: ['user-1'] });
    const { ports } = await createOauthPorts({ authenticated: true, clients: [client] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request(authorizePath());

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/auth/oauth/consent');
  });

  it('refuses a non-listed subject on resume with access_denied', async () => {
    const client = createOauthClient({ allowedUserIds: ['owner-1'] });
    const { ports, store } = await createOauthPorts({ clients: [client] });
    const { router, stateCodec } = createOauthRouterForTest({ ports });
    const initial = await router.request(authorizePath());
    const continuation = new URL(initial.headers.get('location') ?? '').searchParams.get('continue') ?? '';

    const { ports: listedPorts } = await createOauthPorts({
      authenticated: true,
      clients: [client],
      store,
    });
    const { router: listedRouter } = createOauthRouterForTest({ ports: listedPorts, stateCodec });

    const response = await listedRouter.request(
      `/oauth/authorize?continue=${encodeURIComponent(continuation)}`
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:5397/callback');
    expect(location.searchParams.get('error')).toBe('access_denied');
  });
});
