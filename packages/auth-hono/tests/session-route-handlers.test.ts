import { describe, expect, it } from 'vitest';

import {
  createAuthRouter,
  createAuthSessionRouteHandlers,
  type AuthHonoCookiePort,
  type AuthHonoSessionService,
  type AuthHonoValidatedSession,
} from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-08T00:00:00.000Z');

const validatedSession: AuthHonoValidatedSession = {
  role: 'editor',
  session: { role: 'editor', sessionId: 'session-1', userId: 'user-1' },
  sessionRecord: {
    id: 'session-1',
    userId: 'user-1',
  },
  user: {
    email: 'user@example.com',
    id: 'user-1',
    role: 'editor',
  },
} as AuthHonoValidatedSession;

const tokens = {
  expiresAt,
  refreshToken: 'next-refresh-token',
  sessionId: 'session-1',
  sessionToken: 'next-session-token',
};

const service = (overrides: Partial<AuthHonoSessionService> = {}): AuthHonoSessionService => ({
  createSession: async () => tokens,
  listUserSessions: async () => [],
  refreshSession: async () => tokens,
  revokeAllSessions: async () => 1,
  revokeSession: async () => true,
  validateSessionToken: async () => validatedSession,
  ...overrides,
});

const cookies = (overrides: Partial<AuthHonoCookiePort> = {}): AuthHonoCookiePort => ({
  readRefreshToken: () => null,
  readSessionToken: () => null,
  serializeClearedRefreshCookie: () => 'refreshToken=; Max-Age=0',
  serializeClearedSessionCookie: () => 'session=; Max-Age=0',
  serializeRefreshCookie: ({ token }) => `refreshToken=${token}; HttpOnly`,
  serializeSessionCookie: ({ token }) => `session=${token}; HttpOnly`,
  ...overrides,
});

const router = (
  sessionService: AuthHonoSessionService,
  cookiePort: AuthHonoCookiePort = cookies()
) =>
  createAuthRouter({
    handlers: createAuthSessionRouteHandlers({
      cookies: cookiePort,
      service: sessionService,
    }),
    routePrefix: '/api/v1/auth',
  });

describe('createAuthSessionRouteHandlers', () => {
  it('refreshes sessions through the session service and writes rotated cookies', async () => {
    const calls: string[] = [];
    const response = await router(
      service({
        refreshSession: async (refreshToken) => {
          calls.push(refreshToken);
          return {
            expiresAt,
            refreshToken: 'next-refresh-token',
            sessionId: 'session-1',
            sessionToken: 'next-session-token',
          };
        },
      })
    ).request('/api/v1/auth/session/refresh', {
      body: JSON.stringify({ refreshToken: 'refresh-token' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(['refresh-token']);
    expect(response.headers.get('set-cookie')).toContain('session=next-session-token');
    await expect(response.json()).resolves.toEqual({
      expiresAt: '2026-01-08T00:00:00.000Z',
      refreshToken: 'next-refresh-token',
      sessionToken: 'next-session-token',
      success: true,
    });
  });

  it('maps invalid refresh tokens to an invalid_session response', async () => {
    const response = await router(
      service({
        refreshSession: async () => null,
      })
    ).request('/api/v1/auth/session/refresh', {
      body: JSON.stringify({ refreshToken: 'expired-refresh-token' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'invalid_session',
        message: 'Invalid or expired refresh token.',
      },
    });
  });

  it('revokes the authenticated session and clears cookies on logout', async () => {
    const revoked: string[] = [];
    const response = await router(
      service({
        revokeSession: async (sessionId) => {
          revoked.push(sessionId);
          return true;
        },
      }),
      cookies({ readSessionToken: () => 'session-token' })
    ).request('/api/v1/auth/session', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(revoked).toEqual(['session-1']);
    expect(response.headers.get('set-cookie')).toContain('session=; Max-Age=0');
    await expect(response.json()).resolves.toEqual({
      message: 'Logged out successfully',
      success: true,
    });
  });
});
