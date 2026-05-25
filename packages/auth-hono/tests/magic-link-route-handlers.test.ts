import { describe, expect, it } from 'vitest';

import {
  createAuthMagicLinkRouteHandlers,
  createAuthRouter,
  type AuthHonoMagicLinkService,
  type AuthHonoUserRecord,
} from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const user: AuthHonoUserRecord = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User',
  role: 'editor',
  emailVerified: true,
  accountStatus: 'active',
  approvalDueAt: null,
  createdAt: now,
  updatedAt: now,
};

describe('createAuthMagicLinkRouteHandlers', () => {
  it('maps magic-link requests to the magic-link service', async () => {
    const service: AuthHonoMagicLinkService = {
      requestMagicLink: async () => ({
        expiresAt: new Date('2026-01-01T00:10:00.000Z'),
        success: true,
      }),
      verifyMagicLink: async () => {
        throw new Error('unexpected verify call');
      },
    };
    const router = createAuthRouter({
      handlers: createAuthMagicLinkRouteHandlers({ service }),
      routePrefix: '/api/v1/auth',
    });

    const response = await router.request('/api/v1/auth/magic-link/request', {
      body: JSON.stringify({ email: 'user@example.com' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      delivery: 'magic_link',
      expiresAt: '2026-01-01T00:10:00.000Z',
      success: true,
    });
  });

  it('maps verified magic links to a reusable user response', async () => {
    const service: AuthHonoMagicLinkService = {
      requestMagicLink: async () => {
        throw new Error('unexpected request call');
      },
      verifyMagicLink: async () => ({ email: 'user@example.com', user, valid: true }),
    };
    const router = createAuthRouter({
      handlers: createAuthMagicLinkRouteHandlers({ service }),
      routePrefix: '/api/v1/auth',
    });

    const response = await router.request('/api/v1/auth/magic-link/verify', {
      body: JSON.stringify({ token: 'magic-token' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      user: {
        displayName: 'User',
        email: 'user@example.com',
        id: 'user-1',
        role: 'editor',
      },
    });
  });
});
