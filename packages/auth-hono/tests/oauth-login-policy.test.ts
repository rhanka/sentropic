import { describe, expect, it } from 'vitest';

import {
  authorizePath,
  createOauthClient,
  createOauthPorts,
  createOauthRouterForTest,
} from './__fixtures__/oauth-fixtures.js';

describe('OAuth login-policy endpoint', () => {
  it('returns magicLinkSignIn=false when continue is omitted', async () => {
    const { ports } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request('/oauth/login-policy');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ magicLinkSignIn: false });
  });

  it('returns magicLinkSignIn=false for default clients and true when opted in', async () => {
    const { ports: defaultPorts } = await createOauthPorts();
    const { router: defaultRouter } = createOauthRouterForTest({ ports: defaultPorts });
    const defaultAuthorize = await defaultRouter.request(authorizePath());
    const defaultContinue = new URL(defaultAuthorize.headers.get('location') ?? '').searchParams.get('continue')!;

    const defaultPolicy = await defaultRouter.request(
      `/oauth/login-policy?continue=${encodeURIComponent(defaultContinue)}`,
    );
    expect(defaultPolicy.status).toBe(200);
    await expect(defaultPolicy.json()).resolves.toEqual({ magicLinkSignIn: false });

    const magicClient = createOauthClient({ magicLinkSignIn: true });
    const { ports: magicPorts } = await createOauthPorts({ clients: [magicClient] });
    const { router: magicRouter } = createOauthRouterForTest({ ports: magicPorts });
    const magicAuthorize = await magicRouter.request(authorizePath());
    const magicContinue = new URL(magicAuthorize.headers.get('location') ?? '').searchParams.get('continue')!;

    const magicPolicy = await magicRouter.request(
      `/oauth/login-policy?continue=${encodeURIComponent(magicContinue)}`,
    );
    expect(magicPolicy.status).toBe(200);
    await expect(magicPolicy.json()).resolves.toEqual({ magicLinkSignIn: true });
  });

  it('rejects tampered or expired continuations', async () => {
    const { ports } = await createOauthPorts();
    const { router } = createOauthRouterForTest({ ports });

    const response = await router.request('/oauth/login-policy?continue=tampered.token');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' });
  });
});
