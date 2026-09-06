import type { TenantContext } from '@sentropic/contracts';
import type { CreateCommentsRouterOptions } from '@sentropic/comments/hono';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client';
import {
  folders,
  initiatives,
  organizations,
  users,
  workspaceMemberships,
} from '../../db/schema';
import type { AuthUser } from '../../middleware/auth';
import { commentEventSink, commentStore } from '../../services/comments/instance';
import { reconcileTenantId } from '../../services/tenancy/resolve-tenant';
import {
  requireWorkspaceAccess,
  requireWorkspaceAdmin,
  requireWorkspaceCommenter,
} from '../../services/workspace-access';

const contextExists = async (
  contextType: string,
  contextId: string,
  workspaceId: string,
): Promise<boolean> => {
  if (contextType === 'organization') {
    const [row] = await db.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, contextId),
      eq(organizations.workspaceId, workspaceId),
    )).limit(1);
    return Boolean(row);
  }
  if (contextType === 'folder' || contextType === 'matrix' || contextType === 'executive_summary') {
    const [row] = await db.select({ id: folders.id }).from(folders).where(and(
      eq(folders.id, contextId),
      eq(folders.workspaceId, workspaceId),
    )).limit(1);
    return Boolean(row);
  }
  if (contextType === 'initiative') {
    const [row] = await db.select({ id: initiatives.id }).from(initiatives).where(and(
      eq(initiatives.id, contextId),
      eq(initiatives.workspaceId, workspaceId),
    )).limit(1);
    return Boolean(row);
  }
  return false;
};

export const createProductCommentsRouterOptions = (): CreateCommentsRouterOptions => ({
  store: commentStore,
  events: commentEventSink,
  authz: {
    resolvePrincipal(context) {
      const user = context.get('user') as AuthUser | undefined;
      return user?.workspaceId && user.userId
        ? { workspaceId: user.workspaceId, userId: user.userId }
        : undefined;
    },
    async authorize({ principal, action }) {
      try {
        if (action === 'read') {
          await requireWorkspaceAccess(principal.userId, principal.workspaceId);
        } else if (action === 'comment') {
          await requireWorkspaceCommenter(principal.userId, principal.workspaceId);
        } else {
          await requireWorkspaceAdmin(principal.userId, principal.workspaceId);
        }
        return true;
      } catch {
        return false;
      }
    },
  },
  tenant: {
    async resolve(principal): Promise<TenantContext> {
      const tenantId = await reconcileTenantId({
        workspaceId: principal.workspaceId,
        userId: principal.userId,
        path: 'comments',
      });
      return {
        tenantId,
        workspaceId: principal.workspaceId,
        userId: principal.userId,
      };
    },
    async contextExists({ contextType, contextId, workspaceId }) {
      return contextExists(contextType, contextId, workspaceId);
    },
    async memberExists({ userId, workspaceId }) {
      const [row] = await db.select({ userId: workspaceMemberships.userId })
        .from(workspaceMemberships)
        .where(and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, userId),
        ))
        .limit(1);
      return Boolean(row);
    },
    async resolveUsers({ userIds }) {
      if (userIds.length === 0) return [];
      return db.select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      }).from(users).where(inArray(users.id, [...userIds]));
    },
  },
});
