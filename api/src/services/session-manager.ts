import { db } from '../db/client';
import { userSessions } from '../db/schema';
import { eq, and, lt } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { createHash } from 'crypto';
import { logger } from '../logger';
import { env } from '../config/env';

/**
 * Session Manager Service
 * 
 * Manages user sessions with JWT tokens and refresh tokens:
 * - Create sessions with access + refresh tokens
 * - Validate session tokens
 * - Refresh expired sessions
 * - Revoke sessions (logout)
 * - List user sessions for device management
 */

interface DeviceInfo {
  name?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface SessionTokens {
  sessionToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface SessionPayload {
  userId: string;
  sessionId: string;
  role: string;
}

// JWT secret key (from environment or generate random for dev)
const JWT_SECRET = new TextEncoder().encode(
  env.JWT_SECRET || 'dev-secret-key-change-in-production-please'
);

// Token durations
const SESSION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
const REFRESH_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Hash a token for storage (SHA-256)
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
  userId: string,
  role: string,
  deviceInfo?: DeviceInfo
): Promise<SessionTokens> {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION * 1000);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_DURATION * 1000);
  
  // Generate JWT session token
  const sessionToken = await new SignJWT({ userId, sessionId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(JWT_SECRET);
  
  // Generate refresh token (random UUID)
  const refreshToken = crypto.randomUUID();
  
  // Store session in database (with hashed tokens)
  await db.insert(userSessions).values({
    id: sessionId,
    userId,
    sessionTokenHash: hashToken(sessionToken),
    refreshTokenHash: hashToken(refreshToken),
    deviceName: deviceInfo?.name || null,
    ipAddress: deviceInfo?.ipAddress || null,
    userAgent: deviceInfo?.userAgent || null,
    mfaVerified: false,
    expiresAt,
    createdAt: now,
    lastActivityAt: now,
  });
  
  logger.info({ 
    userId, 
    sessionId, 
    deviceName: deviceInfo?.name 
  }, 'Session created');
  
  return {
    sessionToken,
    refreshToken,
    expiresAt,
  };
}

/**
 * Validate a session token
 * 
 * @param sessionToken - JWT session token
 * @returns Session payload if valid, null otherwise
 */
export async function validateSession(
  sessionToken: string
): Promise<SessionPayload | null> {
  try {
    // Verify JWT signature and expiration
    const { payload } = await jwtVerify(sessionToken, JWT_SECRET);
    
    const { userId, sessionId, role } = payload as SessionPayload;
    
    // Check if session exists and is not revoked
    const sessionHash = hashToken(sessionToken);
    const [session] = await db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.sessionTokenHash, sessionHash),
          eq(userSessions.id, sessionId)
        )
      )
      .limit(1);
    
    if (!session) {
      logger.warn({ sessionId }, 'Session not found in database (possibly revoked)');
      return null;
    }
    
    // Check if session is expired
    if (session.expiresAt < new Date()) {
      logger.warn({ sessionId }, 'Session expired');
      return null;
    }
    
    // Update last activity
    await db
      .update(userSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(userSessions.id, sessionId));
    
    return { userId, sessionId, role };
  } catch (error) {
    logger.debug({ err: error }, 'Invalid session token');
    return null;
  }
}

/**
 * Refresh a session using refresh token
 * 
 * @param refreshToken - Refresh token
 * @returns New session tokens if valid, null otherwise
 */
export async function refreshSession(
  refreshToken: string
): Promise<SessionTokens | null> {
  try {
    const refreshHash = hashToken(refreshToken);
    
    // Find session by refresh token
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, refreshHash))
      .limit(1);
    
    if (!session) {
      logger.warn('Refresh token not found');
      return null;
    }
    
    // Check if session is expired
    if (session.expiresAt < new Date()) {
      logger.warn({ sessionId: session.id }, 'Refresh session expired');
      return null;
    }
    
    // Get user role (would need to join with users table)
    // For now, decode from existing session or default to 'guest'
    const role = 'guest'; // TODO: Get from users table
    
    // Generate new tokens
    const newSessionToken = await new SignJWT({ 
      userId: session.userId, 
      sessionId: session.id, 
      role 
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(new Date(Date.now() + SESSION_DURATION * 1000))
      .sign(JWT_SECRET);
    
    const newRefreshToken = crypto.randomUUID();
    const newExpiresAt = new Date(Date.now() + SESSION_DURATION * 1000);
    
    // Update session with new tokens
    await db
      .update(userSessions)
      .set({
        sessionTokenHash: hashToken(newSessionToken),
        refreshTokenHash: hashToken(newRefreshToken),
        expiresAt: newExpiresAt,
        lastActivityAt: new Date(),
      })
      .where(eq(userSessions.id, session.id));
    
    logger.info({ 
      userId: session.userId, 
      sessionId: session.id 
    }, 'Session refreshed');
    
    return {
      sessionToken: newSessionToken,
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
    };
  } catch (error) {
    logger.error({ err: error }, 'Error refreshing session');
    return null;
  }
}

/**
 * Revoke a session (logout)
 * 
 * @param sessionId - Session ID to revoke
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await db
    .delete(userSessions)
    .where(eq(userSessions.id, sessionId));
  
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
  
  return await db
    .select({
      id: userSessions.id,
      deviceName: userSessions.deviceName,
      ipAddress: userSessions.ipAddress,
      userAgent: userSessions.userAgent,
      createdAt: userSessions.createdAt,
      lastActivityAt: userSessions.lastActivityAt,
      expiresAt: userSessions.expiresAt,
    })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        lt(now, userSessions.expiresAt) // Only active sessions
      )
    );
}

/**
 * Revoke all sessions for a user (logout everywhere)
 * 
 * @param userId - User ID
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  const deleted = await db
    .delete(userSessions)
    .where(eq(userSessions.userId, userId))
    .returning({ id: userSessions.id });
  
  logger.info({ userId, count: deleted.length }, 'All user sessions revoked');
}

