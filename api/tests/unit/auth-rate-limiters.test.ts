import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/env', () => ({ env: { DISABLE_RATE_LIMIT: undefined } }));
vi.mock('../../src/utils/client-ip', () => ({ resolveClientIp: () => 'test-client' }));

import { applyAuthRateLimiters } from '../../src/middleware/auth-rate-limiters';

describe('auth rate limiter bindings', () => {
  it.each([
    '/api/v1/oauth/token',
    '/api/v1/oauth/introspect',
    '/api/v1/oauth/authorize',
    '/api/v1/oauth/revoke',
    '/api/v1/oauth/userinfo',
    '/api/v1/oauth/s2s/self-check',
    '/api/v1/auth/oauth/authorize',
  ])('rate limits %s', async (path) => {
    const app = new Hono();
    applyAuthRateLimiters(app);
    app.all('*', (c) => c.json({ ok: true }));

    const response = await app.request(path, { method: 'POST' });

    expect(response.headers.get('ratelimit-policy')).not.toBeNull();
  });
});
