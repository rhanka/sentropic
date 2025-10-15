import type { Context, Next } from 'hono';
import type { AuthUser } from './auth';
import { logger } from '../logger';

/**
 * RBAC Middleware
 * 
 * Role-Based Access Control for API routes.
 * Requires authentication middleware to be applied first.
 * 
 * Role Hierarchy:
 * - admin_app: Full system access, user management
 * - admin_org: Organization-level admin, manage folders/users in org
 * - editor: Edit use cases, folders, companies
 * - guest: Read-only access
 */

export type Role = 'admin_app' | 'admin_org' | 'editor' | 'guest';

// Role hierarchy (higher number = more permissions)
const ROLE_LEVELS: Record<Role, number> = {
  admin_app: 4,
  admin_org: 3,
  editor: 2,
  guest: 1,
};

/**
 * Check if user has required role or higher
 */
function hasRole(userRole: string, requiredRole: Role): boolean {
  const userLevel = ROLE_LEVELS[userRole as Role] || 0;
  const requiredLevel = ROLE_LEVELS[requiredRole];
  return userLevel >= requiredLevel;
}

/**
 * Require specific role middleware
 * 
 * @param role - Minimum required role
 * @returns Middleware function
 */
export function requireRole(role: Role) {
  return async (c: Context, next: Next) => {
    try {
      const user = c.get('user') as AuthUser | undefined;
      
      if (!user) {
        logger.warn({ path: c.req.path, requiredRole: role }, 'No user in context (auth middleware missing?)');
        return c.json({ error: 'Authentication required' }, 401);
      }
      
      if (!hasRole(user.role, role)) {
        logger.warn({
          path: c.req.path,
          userId: user.userId,
          userRole: user.role,
          requiredRole: role,
        }, 'Insufficient permissions');
        
        return c.json({ 
          error: 'Insufficient permissions',
          required: role,
          current: user.role,
        }, 403);
      }
      
      await next();
    } catch (error) {
      logger.error({ err: error, path: c.req.path }, 'RBAC middleware error');
      return c.json({ error: 'Authorization failed' }, 500);
    }
  };
}

/**
 * Require any of the specified roles
 * 
 * @param roles - Array of acceptable roles
 * @returns Middleware function
 */
export function requireAnyRole(roles: Role[]) {
  return async (c: Context, next: Next) => {
    try {
      const user = c.get('user') as AuthUser | undefined;
      
      if (!user) {
        logger.warn({ path: c.req.path, requiredRoles: roles }, 'No user in context');
        return c.json({ error: 'Authentication required' }, 401);
      }
      
      const hasAnyRole = roles.some(role => hasRole(user.role, role));
      
      if (!hasAnyRole) {
        logger.warn({
          path: c.req.path,
          userId: user.userId,
          userRole: user.role,
          requiredRoles: roles,
        }, 'Insufficient permissions');
        
        return c.json({ 
          error: 'Insufficient permissions',
          required: roles,
          current: user.role,
        }, 403);
      }
      
      await next();
    } catch (error) {
      logger.error({ err: error, path: c.req.path }, 'RBAC middleware error');
      return c.json({ error: 'Authorization failed' }, 500);
    }
  };
}

/**
 * Require admin role (admin_app or admin_org)
 */
export const requireAdmin = requireAnyRole(['admin_app', 'admin_org']);

/**
 * Require editor role or higher
 */
export const requireEditor = requireRole('editor');

/**
 * Helper to check if user is admin_app
 */
export function isAdminApp(user: AuthUser): boolean {
  return user.role === 'admin_app';
}

/**
 * Helper to check if user is admin (app or org)
 */
export function isAdmin(user: AuthUser): boolean {
  return user.role === 'admin_app' || user.role === 'admin_org';
}

