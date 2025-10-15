import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import {
  validateSession,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  listUserSessions,
} from '../../services/session-manager';

/**
 * Session Management Routes
 * 
 * GET /auth/session - Get current session info
 * POST /auth/session/refresh - Refresh session token
 * DELETE /auth/session - Logout current session
 * DELETE /auth/session/all - Logout all sessions
 * GET /auth/session/list - List all user sessions
 */

export const sessionRouter = new Hono();

// Request schemas
const refreshSessionSchema = z.object({
  refreshToken: z.string(),
});

/**
 * GET /auth/session
 * Get current session info (requires valid session)
 */
sessionRouter.get('/', async (c) => {
  try {
    // Get session token from cookie or Authorization header
    const sessionToken = 
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return c.json({ error: 'No session token provided' }, 401);
    }
    
    // Validate session
    const session = await validateSession(sessionToken);
    
    if (!session) {
      return c.json({ error: 'Invalid or expired session' }, 401);
    }
    
    return c.json({
      userId: session.userId,
      sessionId: session.sessionId,
      role: session.role,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error getting session info');
    return c.json({ error: 'Failed to get session info' }, 500);
  }
});

/**
 * POST /auth/session/refresh
 * Refresh session using refresh token
 */
sessionRouter.post('/refresh', async (c) => {
  try {
    const body = await c.req.json();
    const { refreshToken } = refreshSessionSchema.parse(body);
    
    // Refresh session
    const newSession = await refreshSession(refreshToken);
    
    if (!newSession) {
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }
    
    // Set new session cookie
    c.header('Set-Cookie',
      `session=${newSession.sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
    );
    
    return c.json({
      success: true,
      sessionToken: newSession.sessionToken,
      refreshToken: newSession.refreshToken,
      expiresAt: newSession.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    logger.error({ err: error }, 'Error refreshing session');
    return c.json({ error: 'Failed to refresh session' }, 500);
  }
});

/**
 * DELETE /auth/session
 * Logout current session
 */
sessionRouter.delete('/', async (c) => {
  try {
    // Get session token
    const sessionToken = 
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return c.json({ error: 'No session token provided' }, 401);
    }
    
    // Validate and get session info
    const session = await validateSession(sessionToken);
    
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }
    
    // Revoke session
    await revokeSession(session.sessionId);
    
    // Clear session cookie
    c.header('Set-Cookie',
      'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    );
    
    logger.info({ sessionId: session.sessionId }, 'Session logged out');
    
    return c.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    logger.error({ err: error }, 'Error logging out');
    return c.json({ error: 'Failed to logout' }, 500);
  }
});

/**
 * DELETE /auth/session/all
 * Logout all sessions (revoke all user sessions)
 */
sessionRouter.delete('/all', async (c) => {
  try {
    // Get session token
    const sessionToken = 
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return c.json({ error: 'No session token provided' }, 401);
    }
    
    // Validate and get session info
    const session = await validateSession(sessionToken);
    
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }
    
    // Revoke all user sessions
    await revokeAllSessions(session.userId);
    
    // Clear session cookie
    c.header('Set-Cookie',
      'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    );
    
    logger.info({ userId: session.userId }, 'All sessions logged out');
    
    return c.json({ success: true, message: 'Logged out from all devices' });
  } catch (error) {
    logger.error({ err: error }, 'Error logging out all sessions');
    return c.json({ error: 'Failed to logout from all devices' }, 500);
  }
});

/**
 * GET /auth/session/list
 * List all active sessions for current user
 */
sessionRouter.get('/list', async (c) => {
  try {
    // Get session token
    const sessionToken = 
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return c.json({ error: 'No session token provided' }, 401);
    }
    
    // Validate and get session info
    const session = await validateSession(sessionToken);
    
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }
    
    // List user sessions
    const sessions = await listUserSessions(session.userId);
    
    return c.json({ sessions });
  } catch (error) {
    logger.error({ err: error }, 'Error listing sessions');
    return c.json({ error: 'Failed to list sessions' }, 500);
  }
});

