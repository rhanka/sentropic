import type { Context, Next } from 'hono';
import { logger } from '../logger';
import { authenticateCmHttpRequest, publishCmAuthenticationRefusal } from '../services/identity/cm-http-principal';
import { ensureWorkspaceForUser } from '../services/workspace-service';
import { getWorkspaceRole, isWorkspaceDeleted } from '../services/workspace-access';

/**
 * Authentication uses the shipped `@sentropic/auth-hono` middleware with a
 * transaction-bound CM ports bag. Workspace
 * selection, stale-workspace recovery, and hidden-workspace rules remain app-owned.
 */
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
  authenticatedAt?: string;
  role: string;
  workspaceId: string;
  email?: string | null;
  displayName?: string | null;
}

// Extend Hono context with user info
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    // Set by `createRequireServiceAuth` (@sentropic/auth-hono) on S2S routes (BR-39d).
    serviceClient: { clientId: string; scopes: string[]; jkt: string | null };
  }
}

/**
 * Require authentication middleware
 * Use this on routes that need authentication
 */
export async function requireAuth(c: Context, next: Next) {
  try {
    const result = await authenticateCmHttpRequest(c.req.raw, true);
    if (!result.accepted) return publishCmAuthenticationRefusal(result);
    const validated = result.principal;
    if (!validated) return c.json({ error: 'Authentication required' }, 401);

    const session = { ...validated.session, role: validated.role };
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
      authenticatedAt: validated.sessionRecord.createdAt.toISOString(),
      role: session.role,
      workspaceId: workspaceId ?? '',
      email: validated.session.email ?? null,
      displayName: validated.session.displayName ?? null,
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
    const result = await authenticateCmHttpRequest(c.req.raw, false);
    if (!result.accepted) return publishCmAuthenticationRefusal(result);
    const validated = result.principal;
    if (validated) {
      const { workspaceId } = await ensureWorkspaceForUser(validated.session.userId, { createIfMissing: false });
      if (workspaceId) {
        c.set('user', {
          userId: validated.session.userId,
          sessionId: validated.session.sessionId,
          authenticatedAt: validated.sessionRecord.createdAt.toISOString(),
          role: validated.role,
          workspaceId,
          email: validated.session.email ?? null,
          displayName: validated.session.displayName ?? null,
        });
      }
    }
  } catch {
    logger.error({ path: c.req.path }, 'Optional authentication unavailable');
    return c.json({ error: 'Authentication unavailable' }, 503);
  }
  await next();
}
