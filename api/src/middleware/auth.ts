import type { Context, Next } from 'hono';
import { validateSession } from '../services/session-manager';
import { logger } from '../logger';

/**
 * Authentication Middleware
 * 
 * Extracts and validates session token from cookie or Authorization header.
 * Attaches user info to request context if valid.
 * Returns 401 Unauthorized if token is missing or invalid.
 */

export interface AuthUser {
  userId: string;
  sessionId: string;
  role: string;
}

// Extend Hono context with user info
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

/**
 * Require authentication middleware
 * Use this on routes that need authentication
 */
export async function requireAuth(c: Context, next: Next) {
  try {
    // Debug logs disabled to reduce noise in API logs
    // const cookieHeader = c.req.header('cookie');
    // logger.debug({ 
    //   path: c.req.path,
    //   cookieHeader: cookieHeader || 'no cookies'
    // }, 'Auth middleware debug');
    
    // Extract session token from cookie or Authorization header
    const sessionToken = 
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');
    
    if (!sessionToken) {
      logger.debug({ path: c.req.path }, 'No session token provided');
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    // Validate session
    const session = await validateSession(sessionToken);
    
    if (!session) {
      logger.debug({ path: c.req.path }, 'Invalid or expired session');
      return c.json({ error: 'Invalid or expired session' }, 401);
    }
    
    // Attach user info to context
    c.set('user', {
      userId: session.userId,
      sessionId: session.sessionId,
      role: session.role,
    });
    
    await next();
  } catch (error) {
    logger.error({ err: error, path: c.req.path }, 'Authentication middleware error');
    return c.json({ error: 'Authentication failed' }, 500);
  }
}

/**
 * Optional authentication middleware
 * Attaches user info if token is valid, but doesn't block if missing/invalid
 */
export async function optionalAuth(c: Context, next: Next) {
  try {
    // Extract session token
    const sessionToken = 
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ||
      c.req.header('authorization')?.replace('Bearer ', '');
    
    if (sessionToken) {
      // Validate session
      const session = await validateSession(sessionToken);
      
      if (session) {
        // Attach user info to context
        c.set('user', {
          userId: session.userId,
          sessionId: session.sessionId,
          role: session.role,
        });
      }
    }
    
    await next();
  } catch (error) {
    logger.error({ err: error, path: c.req.path }, 'Optional auth middleware error');
    // Don't block request on error, just continue without user
    await next();
  }
}

