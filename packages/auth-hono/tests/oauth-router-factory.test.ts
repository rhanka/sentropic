import { describe, expect, it } from 'vitest';

import { createWellKnownRouter } from '../src/index.js';
import { createOauthPorts, createOauthRouterForTest } from './__fixtures__/oauth-fixtures.js';

describe('OAuth router factories', () => {
  it('mounts OAuth routes under the default prefix', async () => {
    const { ports } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });

    expect((await router.request('/oauth/authorize')).status).not.toBe(404);
    expect((await router.request('/oauth/token', { method: 'POST' })).status).not.toBe(404);
    expect((await router.request('/oauth/userinfo')).status).not.toBe(404);
    expect((await router.request('/oauth/revoke', { method: 'POST' })).status).not.toBe(404);
    expect((await router.request('/oauth/introspect', { method: 'POST' })).status).not.toBe(404);
    expect((await router.request('/oauth/consent')).status).not.toBe(404);
    expect((await router.request('/oauth/consent/decision', { method: 'POST' })).status).not.toBe(404);
  });

  it('supports empty prefix for host-mounted OAuth routers', async () => {
    const { ports } = await createOauthPorts();
    const prefixed = createOauthRouterForTest({ ports }).router;
    const noPrefix = createOauthRouterForTest({ ports, routePrefix: '' }).router;

    expect((await prefixed.request('/token', { method: 'POST' })).status).toBe(404);
    expect((await noPrefix.request('/token', { method: 'POST' })).status).not.toBe(404);
    expect((await noPrefix.request('/oauth/token', { method: 'POST' })).status).toBe(404);
  });

  it('keeps well-known routes separate from the OAuth subrouter', async () => {
    const { ports } = await createOauthPorts();
    const wellKnown = createWellKnownRouter({ issuer: 'http://localhost:9197', ports });
    const { router: oauth } = createOauthRouterForTest({ ports });

    expect((await wellKnown.request('/openid-configuration')).status).toBe(200);
    expect((await oauth.request('/openid-configuration')).status).toBe(404);
  });
});
