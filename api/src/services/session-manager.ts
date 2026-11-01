import { cmAuthSessionService, createCmLoginForSubject } from './identity/cm-session-facade';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createHash } from 'crypto';
import { logger } from '../logger';
import { env } from '../config/env';
import { getRemoteSessionAuthority } from './auth/remote-private-session';
import { tombstoneRemoteSessions } from './auth/remote-revocation';
import { deleteAndQueueRemoteSessions } from './auth/remote-revocation-outbox';
import {
  createCmSession,
  findCmSessionByRefreshTokenHash,
  findCmSessionByTokenHash,
  listCmSessionsForUser,
  rotateCmSession,
  touchCmSession,
} from './identity/cm-sessions';
import { findCmUserById } from './identity/cm-users';

/**
 * Session Manager Service
 *
 * Manages user sessions with JWT tokens and refresh tokens:
 * - Create sessions with access + refresh tokens
 * - Validate session tokens
 * - Refresh expired sessions
 * - Revoke sessions (logout)
 * - List user sessions for device management
 *
 * Lot A4: session persistence lives in the cluster-mesh identity custody store
 * (cm_identity.identity_login_token_bindings + identity_login_sessions); the
 * legacy `public.user_sessions` table is dropped by control migration 0014.
 */

interface DeviceInfo {
  name?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface SessionTokens {
  sessionId: string;
  sessionToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface SessionPayload {
  userId: string;
  sessionId: string;
  role: string;
  email?: string | null;
  displayName?: string | null;
}

type SessionTokenClaims = JWTPayload & {
  userId: string;
  sessionId: string;
  role: string;
  login: { mfaVerified: boolean; authTime: number; sessionVersion: number };
  tokenUse?: 'session' | 'refresh';
};

function readSignedLogin(payload: JWTPayload): SessionTokenClaims['login'] | null {
  const login = payload.login as Partial<SessionTokenClaims['login']> | undefined;
  return login && typeof login.mfaVerified === 'boolean'
    && Number.isSafeInteger(login.authTime) && Number.isSafeInteger(login.sessionVersion)
    && login.authTime! >= 0 && login.sessionVersion! >= 0
    ? login as SessionTokenClaims['login'] : null;
}

// JWT secret key (from environment or generate random for dev)
const JWT_SECRET = new TextEncoder().encode(
  env.JWT_SECRET || 'dev-secret-key-change-in-production-please'
);

// Token durations
const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
// REFRESH_DURATION kept for future refresh token implementation
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const REFRESH_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Hash a token for storage (SHA-256)
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function signSessionToken(
  claims: SessionTokenClaims,
  expiresAt: Date
): Promise<string> {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(JWT_SECRET);
}

/**
 * Create a new session for a user
 *
 * @param userId - User ID
 * @param role - User role
 * @param deviceInfo - Optional device information
 * @returns Session tokens (sessionToken, refreshToken) and expiration
 */
export async function createSession(
  userId: string, _role: string, deviceInfo?: DeviceInfo, options?: { mfaVerified?: boolean },
): Promise<SessionTokens> {
  // MFA login is minted only by the verified CM assertion completion.
  if (options?.mfaVerified) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  return createCmLoginForSubject(userId, deviceInfo);
}

/**
 * Validate a session token
 *
 * @param sessionToken - JWT session token
 * @returns Session payload if valid, null otherwise
 */
export async function validateSession(sessionToken: string): Promise<SessionPayload | null> {
  const result = await cmAuthSessionService.validateSessionToken(sessionToken);
  return result ? { userId: result.user.id, sessionId: result.sessionRecord.id,
    role: result.role, email: result.user.email, displayName: result.user.displayName } : null;
}

/**
 * Refresh a session using refresh token
 *
 * @param refreshToken - Refresh token
 * @returns New session tokens if valid, null otherwise
 */
export async function refreshSession(refreshToken: string): Promise<SessionTokens | null> {
  return cmAuthSessionService.refreshSession(refreshToken);
}

/**
 * Revoke a session (logout)
 *
 * @param sessionId - Session ID to revoke
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const { input, key } = await deleteAndQueueRemoteSessions({ sessionId });
  await tombstoneRemoteSessions(input, key);

  logger.info({ sessionId }, 'Session revoked');
}

/**
 * List all active sessions for a user
 *
 * @param userId - User ID
 * @returns Array of session records
 */
export async function listUserSessions(userId: string) {
  const now = new Date();

  const sessions = await listCmSessionsForUser(userId);
  return sessions
    .filter(session => !session.revokedAt && session.expiresAt > now)
    .map(session => ({
      id: session.id,
      deviceName: session.deviceName,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
    }));
}

/**
 * Revoke all sessions for a user (logout everywhere)
 *
 * @param userId - User ID
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  const { rows: deleted, input, key } = await deleteAndQueueRemoteSessions({ userId });
  await tombstoneRemoteSessions(input, key);

  logger.info({ userId, count: deleted.length }, 'All user sessions revoked');
}
