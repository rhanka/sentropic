import type {
  AuthHonoAccountStatus,
  AuthHonoCookiePort,
  AuthHonoSessionRecord,
  AuthHonoSessionService,
  AuthHonoUserRecord,
} from '@sentropic/auth-hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { userSessions, users } from '../../db/schema';
import {
  refreshSession as refreshSessionTokens,
  revokeSession as revokeSessionById,
  validateSession,
} from '../session-manager';

/**
 * Sentropic adapters for `@sentropic/auth-hono` session route handlers.
 *
 * Shared by `api/src/routes/auth/session.ts` and reusable by the auth middleware
 * and WebAuthn login/register rewirings. The session service implements only the
 * methods consumed by the package session route handlers (`refreshSession`,
 * `validateSessionToken`, `revokeSession`); `createSession`, `listUserSessions`,
 * and `revokeAllSessions` remain app-owned and are intentionally not delegated.
 */

const isProduction = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'session';
const REFRESH_COOKIE = 'refresh_token';

const readCookie = (request: Request, name: string): string | null => {
  const header = request.headers.get('cookie');
  if (!header) {
    return null;
  }
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
};

const maxAgeFrom = (expiresAt: Date): number =>
  Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

const serializeCookie = (name: string, value: string, maxAgeSeconds: number): string =>
  [
    `${name}=${value}`,
    'HttpOnly',
    isProduction ? 'Secure' : '',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ');

export const authHonoCookiePort: AuthHonoCookiePort = {
  readRefreshToken: (request) => readCookie(request, REFRESH_COOKIE),
  readSessionToken: (request) => readCookie(request, SESSION_COOKIE),
  serializeClearedRefreshCookie: () => serializeCookie(REFRESH_COOKIE, '', 0),
  serializeClearedSessionCookie: () => serializeCookie(SESSION_COOKIE, '', 0),
  serializeRefreshCookie: ({ expiresAt, token }) =>
    serializeCookie(REFRESH_COOKIE, token, maxAgeFrom(expiresAt)),
  serializeSessionCookie: ({ expiresAt, token }) =>
    serializeCookie(SESSION_COOKIE, token, maxAgeFrom(expiresAt)),
};

const toAuthHonoSessionRecord = (
  row: typeof userSessions.$inferSelect
): AuthHonoSessionRecord => ({
  createdAt: row.createdAt,
  deviceName: row.deviceName,
  expiresAt: row.expiresAt,
  id: row.id,
  ipAddress: row.ipAddress,
  lastActivityAt: row.lastActivityAt ?? row.createdAt,
  mfaVerified: row.mfaVerified,
  refreshTokenHash: row.refreshTokenHash,
  revokedAt: null,
  sessionTokenHash: row.sessionTokenHash,
  userAgent: row.userAgent,
  userId: row.userId,
});

const toAuthHonoUserRecord = (row: typeof users.$inferSelect): AuthHonoUserRecord => ({
  accountStatus: row.accountStatus as AuthHonoAccountStatus,
  approvalDueAt: row.approvalDueAt,
  createdAt: row.createdAt,
  displayName: row.displayName,
  email: row.email,
  emailVerified: row.emailVerified,
  id: row.id,
  role: row.role,
  updatedAt: row.updatedAt ?? row.createdAt,
});

export const authHonoSessionService: AuthHonoSessionService = {
  async createSession() {
    throw new Error('Session creation remains app-owned in Sentropic API.');
  },

  async listUserSessions() {
    throw new Error('Session listing remains app-owned in Sentropic API.');
  },

  async refreshSession(refreshToken) {
    const tokens = await refreshSessionTokens(refreshToken);
    if (!tokens) {
      return null;
    }
    return {
      expiresAt: tokens.expiresAt,
      refreshToken: tokens.refreshToken,
      sessionId: tokens.sessionId,
      sessionToken: tokens.sessionToken,
    };
  },

  async revokeAllSessions() {
    throw new Error('Global session revocation remains app-owned in Sentropic API.');
  },

  async revokeSession(sessionId) {
    await revokeSessionById(sessionId);
    return true;
  },

  async validateSessionToken(sessionToken) {
    const payload = await validateSession(sessionToken);
    if (!payload) {
      return null;
    }

    const [sessionRow] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, payload.sessionId))
      .limit(1);
    const [userRow] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);

    if (!sessionRow || !userRow) {
      return null;
    }

    return {
      role: payload.role,
      session: {
        displayName: userRow.displayName,
        email: userRow.email,
        role: payload.role,
        sessionId: payload.sessionId,
        userId: payload.userId,
      },
      sessionRecord: toAuthHonoSessionRecord(sessionRow),
      user: toAuthHonoUserRecord(userRow),
    };
  },
};
