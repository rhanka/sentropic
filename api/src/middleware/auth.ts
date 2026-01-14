import type { Context, Next } from 'hono';
import { validateSession } from '../services/session-manager';
import { logger } from '../logger';
import { ensureWorkspaceForUser } from '../services/workspace-service';
import { getWorkspaceRole, isWorkspaceDeleted } from '../services/workspace-access';

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
  workspaceId: string;
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
    
    const path = c.req.path || '';
    const isWorkspaceBootstrapPath = path.includes('/workspaces') || path.includes('/me');
    const allowHiddenWorkspace = isWorkspaceBootstrapPath || path.includes('/health');

    // Attach user info to context (workspace is selected from query param if provided)
    let { workspaceId } = await ensureWorkspaceForUser(session.userId, { createIfMissing: false });

    const requested = (c.req.query('workspace_id') || '').trim();
    if (requested) {
      const role = await getWorkspaceRole(session.userId, requested);
      if (!role) {
        // If the client has a stale localStorage workspace_id, allow bootstrap endpoints to recover.
        if (!isWorkspaceBootstrapPath) {
          // opaque
          return c.json({ message: 'Not found' }, 404);
        }
      }
      if (role) workspaceId = requested;
    }

    if (!workspaceId && !isWorkspaceBootstrapPath) {
      return c.json({ message: 'No workspace available', code: 'WORKSPACE_REQUIRED' }, 409);
    }

    if (workspaceId && !allowHiddenWorkspace) {
      const hidden = await isWorkspaceDeleted(workspaceId);
      if (hidden) {
        return c.json({ message: 'Workspace is hidden', code: 'WORKSPACE_HIDDEN' }, 409);
      }
    }

    c.set('user', {
      userId: session.userId,
      sessionId: session.sessionId,
      role: session.role,
      workspaceId: workspaceId ?? '',
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
        const { workspaceId } = await ensureWorkspaceForUser(session.userId, { createIfMissing: false });
        if (workspaceId) {
          c.set('user', {
            userId: session.userId,
            sessionId: session.sessionId,
            role: session.role,
            workspaceId,
          });
        }
      }
    }
    
    await next();
  } catch (error) {
    logger.error({ err: error, path: c.req.path }, 'Optional auth middleware error');
    // Don't block request on error, just continue without user
    await next();
  }
}

