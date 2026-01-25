import type { Context, Next } from 'hono';
import type { AuthUser } from './auth';
import { requireWorkspaceAccess, requireWorkspaceAdmin, requireWorkspaceEditor } from '../services/workspace-access';

export function requireWorkspaceEditorRole() {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    try {
      await requireWorkspaceEditor(user.userId, user.workspaceId);
    } catch {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    await next();
  };
}

export function requireWorkspaceAdminRole() {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    try {
      await requireWorkspaceAdmin(user.userId, user.workspaceId);
    } catch {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    await next();
  };
}

export function requireWorkspaceAccessRole() {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    try {
      await requireWorkspaceAccess(user.userId, user.workspaceId);
    } catch {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    await next();
  };
}


