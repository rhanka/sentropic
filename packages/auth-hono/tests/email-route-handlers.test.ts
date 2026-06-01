import { describe, expect, it } from 'vitest';

import {
  createAuthEmailRouteHandlers,
  createAuthRouter,
  type AuthHonoEmailVerificationService,
} from '../src/index.js';

describe('createAuthEmailRouteHandlers', () => {
  it('maps email code requests to the email service', async () => {
    const calls: string[] = [];
    const service: AuthHonoEmailVerificationService = {
      requestEmailCode: async (input) => {
        calls.push(input.email);
        return { expiresAt: new Date('2026-01-01T00:10:00.000Z'), success: true };
      },
      verifyEmailCode: async () => {
        throw new Error('unexpected verify call');
      },
    };
    const router = createAuthRouter({
      handlers: createAuthEmailRouteHandlers({ service }),
      routePrefix: '/api/v1/auth',
    });

    const response = await router.request('/api/v1/auth/email/verify-request', {
      body: JSON.stringify({ email: 'user@example.com' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(['user@example.com']);
    await expect(response.json()).resolves.toEqual({
      delivery: 'email',
      expiresAt: '2026-01-01T00:10:00.000Z',
      success: true,
    });
  });

  it('maps email code verification service errors to HTTP errors', async () => {
    const service: AuthHonoEmailVerificationService = {
      requestEmailCode: async () => {
        throw new Error('unexpected request call');
      },
      verifyEmailCode: async () => ({
        error: {
          code: 'invalid_or_expired_code',
          message: 'Verification code is invalid or expired.',
          status: 400,
        },
        valid: false,
      }),
    };
    const router = createAuthRouter({
      handlers: createAuthEmailRouteHandlers({ service }),
      routePrefix: '/api/v1/auth',
    });

    const response = await router.request('/api/v1/auth/email/verify-code', {
      body: JSON.stringify({ code: '123456', email: 'user@example.com' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'invalid_or_expired_code',
        message: 'Verification code is invalid or expired.',
      },
    });
  });
});
