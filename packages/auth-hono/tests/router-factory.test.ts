import { describe, expect, it } from 'vitest';

import { createAuthRouter } from '../src/index.js';

describe('createAuthRouter', () => {
  it('mounts a health endpoint for host readiness checks', async () => {
    const router = createAuthRouter();

    const response = await router.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'auth',
    });
  });

  it('mounts configured auth routes under the requested prefix', async () => {
    const router = createAuthRouter({
      routePrefix: '/api/v1/auth',
      routeOverrides: {
        requestEmailCode: {
          method: 'POST',
          path: '/email/code-request',
        },
      },
      serviceName: 'sentropic-auth',
    });

    const healthResponse = await router.request('/api/v1/auth/health');
    await expect(healthResponse.json()).resolves.toEqual({
      status: 'ok',
      service: 'sentropic-auth',
    });

    const emailResponse = await router.request('/api/v1/auth/email/code-request', { method: 'POST' });
    expect(emailResponse.status).toBe(501);
    await expect(emailResponse.json()).resolves.toEqual({
      error: {
        code: 'not_implemented',
        message: 'Auth route handler is not implemented yet.',
      },
    });

    const credentialResponse = await router.request('/api/v1/auth/credentials/credential-1', { method: 'DELETE' });
    expect(credentialResponse.status).toBe(501);
  });

  it('uses injected route handlers when provided', async () => {
    const router = createAuthRouter({
      handlers: {
        requestMagicLink: (c) => c.json({ ok: true }),
      },
      routePrefix: '/api/v1/auth',
    });

    const response = await router.request('/api/v1/auth/magic-link/request', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('excludes delegated routes without intercepting adjacent facades', async () => {
    const router = createAuthRouter({
      excludeRoutes: ['refreshSession', 'logout'],
      routePrefix: '/auth',
    });

    expect((await router.request('/auth/login/options', { method: 'POST' })).status).toBe(501);
    expect((await router.request('/auth/session/refresh', { method: 'POST' })).status).toBe(404);
    expect((await router.request('/auth/session', { method: 'DELETE' })).status).toBe(404);
    expect((await router.request('/auth/oauth/authorize')).status).toBe(404);
  });
});
