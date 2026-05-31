import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  createOptionalAuth,
  createRequireAuth,
  type AuthHonoPorts,
  type AuthHonoUserRecord,
} from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');

const user: AuthHonoUserRecord = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User',
  role: 'admin',
  emailVerified: true,
  accountStatus: 'active',
  approvalDueAt: null,
  createdAt: now,
  updatedAt: now,
};

const createPorts = (overrides: Partial<AuthHonoPorts> = {}): AuthHonoPorts =>
  ({
    users: {
      findById: async () => user,
    },
    sessions: {
      findByTokenHash: async () => ({
        id: 'session-1',
        userId: user.id,
        sessionTokenHash: 'hashed-token',
        refreshTokenHash: null,
        deviceName: null,
        ipAddress: null,
        userAgent: null,
        mfaVerified: false,
        expiresAt: new Date('2026-01-02T00:00:00.000Z'),
        createdAt: now,
        lastActivityAt: now,
        revokedAt: null,
      }),
      touch: async () => undefined,
    },
    cookies: {
      readSessionToken: () => null,
    },
    tokens: {
      hashSecret: () => 'hashed-token',
      verifySessionToken: async () => ({
        userId: user.id,
        sessionId: 'session-1',
        role: user.role,
      }),
    },
    accountPolicy: {
      canAuthenticate: () => ({ allowed: true }),
      resolveSessionRole: (record: AuthHonoUserRecord) => record.role,
    },
    clock: {
      now: () => now,
    },
    ...overrides,
  }) as AuthHonoPorts;

describe('auth middleware factories', () => {
  it('rejects missing credentials in requireAuth', async () => {
    const app = new Hono();
    app.get('/protected', createRequireAuth({ ports: createPorts() }), (c) => c.json({ ok: true }));

    const response = await app.request('/protected');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'unauthorized',
        message: 'Authentication required.',
      },
    });
  });

  it('sets auth context for valid bearer sessions', async () => {
    const app = new Hono();
    app.get('/protected', createRequireAuth({ ports: createPorts() }), (c) => {
      const auth = c.get('auth');
      return c.json({ role: auth.role, userId: auth.user.id });
    });

    const response = await app.request('/protected', {
      headers: { Authorization: 'Bearer session-token' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      role: 'admin',
      userId: 'user-1',
    });
  });

  it('continues without auth context when optionalAuth has no credentials', async () => {
    const app = new Hono();
    app.get('/optional', createOptionalAuth({ ports: createPorts() }), (c) =>
      c.json({ authenticated: Boolean(c.get('auth')) })
    );

    const response = await app.request('/optional');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: false });
  });
});
