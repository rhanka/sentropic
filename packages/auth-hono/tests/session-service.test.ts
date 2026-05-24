import { describe, expect, it } from 'vitest';

import {
  createAuthSessionService,
  type AuthHonoPorts,
  type AuthHonoSessionRecord,
  type AuthHonoUserRecord,
} from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-08T00:00:00.000Z');

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

const createSessionRecord = (input: Partial<AuthHonoSessionRecord> = {}): AuthHonoSessionRecord => ({
  id: 'session-1',
  userId: user.id,
  sessionTokenHash: 'hash:session-token',
  refreshTokenHash: 'hash:refresh-token',
  deviceName: null,
  ipAddress: null,
  userAgent: null,
  mfaVerified: false,
  expiresAt,
  createdAt: now,
  lastActivityAt: now,
  revokedAt: null,
  ...input,
});

const createPorts = (overrides: Partial<AuthHonoPorts> = {}): AuthHonoPorts =>
  ({
    users: {
      findById: async () => user,
    },
    sessions: {
      create: async () => createSessionRecord(),
      findByTokenHash: async () => createSessionRecord(),
      touch: async () => undefined,
      revoke: async () => true,
      revokeAllForUser: async () => 1,
      listForUser: async () => [createSessionRecord()],
    },
    tokens: {
      hashSecret: (secret: string) => `hash:${secret}`,
      signSessionToken: async () => 'session-token',
      verifySessionToken: async () => ({
        userId: user.id,
        sessionId: 'session-1',
        role: user.role,
      }),
    },
    random: {
      uuid: () => 'session-1',
      token: () => 'refresh-token',
    },
    accountPolicy: {
      canAuthenticate: () => ({ allowed: true }),
      resolveSessionRole: (record: AuthHonoUserRecord) => record.role,
    },
    clock: {
      now: () => now,
      addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000),
    },
    ...overrides,
  }) as AuthHonoPorts;

describe('createAuthSessionService', () => {
  it('issues session and refresh tokens through injected ports', async () => {
    const service = createAuthSessionService({ ports: createPorts() });

    const tokens = await service.createSession({
      deviceInfo: { name: 'Laptop' },
      user,
    });

    expect(tokens).toEqual({
      expiresAt,
      refreshToken: 'refresh-token',
      sessionId: 'session-1',
      sessionToken: 'session-token',
    });
  });

  it('validates active sessions and resolves the effective role', async () => {
    const service = createAuthSessionService({ ports: createPorts() });

    const session = await service.validateSessionToken('session-token');

    expect(session).toEqual({
      role: 'admin',
      session: {
        userId: user.id,
        sessionId: 'session-1',
        role: 'admin',
      },
      sessionRecord: createSessionRecord(),
      user,
    });
  });

  it('returns null for expired sessions', async () => {
    const service = createAuthSessionService({
      ports: createPorts({
        sessions: {
          findByTokenHash: async () => createSessionRecord({ expiresAt: new Date('2025-01-01T00:00:00.000Z') }),
        },
      } as Partial<AuthHonoPorts>),
    });

    await expect(service.validateSessionToken('session-token')).resolves.toBeNull();
  });
});
