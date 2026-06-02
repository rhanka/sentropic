import { describe, expect, it } from 'vitest';

import {
  AUTH_HONO_AUTH_UI_METHODS,
  AUTH_HONO_REQUIRED_PORTS,
  AUTH_HONO_ROUTE_MAP,
  type AuthHonoPorts,
} from '../src/index.js';

describe('@sentropic/auth-hono contracts', () => {
  it('tracks the BR-39a AuthUiTransport method surface', () => {
    expect(AUTH_HONO_AUTH_UI_METHODS).toEqual([
      'requestEmailCode',
      'verifyEmailCode',
      'requestMagicLink',
      'verifyMagicLink',
      'createPasskeyRegistrationOptions',
      'verifyPasskeyRegistration',
      'createPasskeyAuthenticationOptions',
      'verifyPasskeyAuthentication',
      'refreshSession',
      'logout',
      'listCredentials',
      'renameCredential',
      'revokeCredential',
    ]);
  });

  it('maps AuthUiTransport methods to stable Hono route contracts', () => {
    expect(AUTH_HONO_ROUTE_MAP.requestEmailCode).toEqual({
      method: 'POST',
      path: '/email/verify-request',
    });
    expect(AUTH_HONO_ROUTE_MAP.requestMagicLink).toEqual({
      method: 'POST',
      path: '/magic-link/request',
    });
    expect(AUTH_HONO_ROUTE_MAP.verifyPasskeyRegistration).toEqual({
      method: 'POST',
      path: '/register/verify',
    });
    expect(AUTH_HONO_ROUTE_MAP.renameCredential).toEqual({
      method: 'PUT',
      path: '/credentials/:id',
    });
  });

  it('declares the required adapter ports for app-owned infrastructure', () => {
    expect(AUTH_HONO_REQUIRED_PORTS).toEqual([
      'users',
      'credentials',
      'challenges',
      'sessions',
      'emailVerification',
      'magicLinks',
      'emailDelivery',
      'cookies',
      'tokens',
      'auditLog',
      'clock',
      'random',
      'accountPolicy',
      'oauthStateStore',
      'jwks',
    ]);
  });

  it('accepts an adapter object covering every required port', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const user = {
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
    const session = {
      id: 'session-1',
      userId: user.id,
      sessionTokenHash: 'session-hash',
      refreshTokenHash: 'refresh-hash',
      deviceName: null,
      ipAddress: null,
      userAgent: null,
      mfaVerified: false,
      expiresAt: now,
      createdAt: now,
      lastActivityAt: now,
      revokedAt: null,
    };

    const ports = {
      users: {
        findById: async () => user,
        findByEmail: async () => user,
        create: async () => user,
        update: async () => user,
        count: async () => 1,
      },
      credentials: {
        findById: async () => null,
        findByCredentialId: async () => null,
        listForUser: async () => [],
        create: async (input) => ({
          id: 'credential-1',
          userId: input.userId,
          credentialId: input.credentialId,
          publicKey: input.publicKey,
          counter: input.counter,
          transports: input.transports ?? null,
          name: input.name ?? null,
          deviceType: input.deviceType ?? null,
          backedUp: input.backedUp ?? null,
          lastUsedAt: null,
          createdAt: now,
          revokedAt: null,
        }),
        updateCounter: async () => undefined,
        rename: async () => null,
        revoke: async () => true,
      },
      challenges: {
        create: async (input) => ({
          id: 'challenge-1',
          challenge: input.challenge,
          userId: input.userId ?? null,
          type: input.type,
          expiresAt: input.expiresAt,
          used: false,
          createdAt: now,
        }),
        findValid: async () => null,
        markUsed: async () => undefined,
        purgeExpired: async () => 0,
      },
      sessions: {
        create: async () => session,
        findById: async () => session,
        findByTokenHash: async () => session,
        findByRefreshTokenHash: async () => session,
        touch: async () => undefined,
        updateTokens: async () => session,
        revoke: async () => true,
        revokeAllForUser: async () => 1,
        listForUser: async () => [session],
      },
      emailVerification: {
        countRecent: async () => 0,
        createCode: async (input) => ({
          id: 'email-code-1',
          email: input.email,
          codeHash: input.codeHash,
          verificationToken: null,
          expiresAt: input.expiresAt,
          used: false,
          createdAt: input.now,
        }),
        findLatestValidCode: async () => null,
        markUsedWithVerificationToken: async () => undefined,
        verifyToken: async () => true,
      },
      magicLinks: {
        create: async (input) => ({
          id: 'magic-link-1',
          tokenHash: input.tokenHash,
          email: input.email,
          userId: input.userId ?? null,
          expiresAt: input.expiresAt,
          used: false,
          createdAt: input.now,
        }),
        findValidByTokenHash: async () => null,
        markUsed: async () => undefined,
      },
      emailDelivery: {
        sendVerificationCode: async () => undefined,
        sendMagicLink: async () => undefined,
      },
      cookies: {
        readSessionToken: () => null,
        readRefreshToken: () => null,
        serializeSessionCookie: () => 'session=token',
        serializeRefreshCookie: () => 'refresh=token',
        serializeClearedSessionCookie: () => 'session=',
        serializeClearedRefreshCookie: () => 'refresh=',
      },
      tokens: {
        hashSecret: () => 'hash',
        signSessionToken: async () => 'session-token',
        verifySessionToken: async () => ({
          userId: user.id,
          sessionId: session.id,
          role: user.role,
        }),
        signVerificationToken: async () => 'verification-token',
      },
      auditLog: {
        record: () => undefined,
      },
      clock: {
        now: () => now,
        addSeconds: (date, seconds) => new Date(date.getTime() + seconds * 1000),
      },
      random: {
        uuid: () => 'uuid',
        bytes: (length) => new Uint8Array(length),
        numericCode: (length) => '0'.repeat(length),
        token: () => 'token',
      },
      accountPolicy: {
        normalizeEmail: (email) => email.trim().toLowerCase(),
        deriveDisplayName: () => 'User',
        roleForNewUser: () => 'editor',
        statusForNewUser: () => ({ accountStatus: 'active', approvalDueAt: null }),
        canAuthenticate: () => ({ allowed: true }),
        resolveSessionRole: (record) => record.role,
      },
      oauthStateStore: {
        consumeAuthCode: async () => null,
        findClient: async () => null,
        findTokenMeta: async () => null,
        isTokenRevoked: async () => false,
        purgeExpired: async () => 0,
        recordDpopJti: async () => true,
        revokeToken: async () => true,
        saveAuthCode: async () => undefined,
        saveTokenMeta: async () => undefined,
      },
      jwks: {
        findKeyByKid: async () => null,
        getActiveKey: async () => null,
        listPublicKeys: async () => [],
      },
    } satisfies AuthHonoPorts;

    expect(Object.keys(ports)).toEqual(AUTH_HONO_REQUIRED_PORTS);
  });
});
