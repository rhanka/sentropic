import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  assertTenantAdmin,
  decideMembership,
  listTenantClients,
  listTenantMemberships,
  requestMembership,
  InvalidMembershipTransitionError,
  MembershipNotFoundError,
  TenantAdminRequiredError,
  type MembershipDecision,
  type MembershipStatus,
} from '../../services/auth/tenant-membership';

// BR-39e Lot 2 — tenant membership acceptance routes. Mounted under `/tenants` behind
// `requireAuth`. Tenant-scoped authorization is enforced inside the service (the global
// `requireRole` is not tenant-aware): approve/reject/suspend/list require an `approved`
// admin membership of the path tenant (or global `admin_app`).

export const tenantsRouter = new Hono();

const VALID_STATUSES: MembershipStatus[] = ['invited', 'requested', 'approved', 'rejected', 'suspended'];

function mapServiceError(c: Context, error: unknown) {
  if (error instanceof TenantAdminRequiredError) return c.json({ error: 'Forbidden' }, 403);
  if (error instanceof MembershipNotFoundError) return c.json({ error: 'Not found' }, 404);
  if (error instanceof InvalidMembershipTransitionError) return c.json({ error: 'Invalid transition' }, 409);
  throw error;
}

// Any authenticated user may request to join a tenant. Anti-enumeration: the response is the
// same opaque 202 whether or not the tenant exists.
tenantsRouter.post('/:tenantId/memberships', async (c) => {
  const user = c.get('user');
  const tenantId = c.req.param('tenantId');
  const result = await requestMembership(user.userId, tenantId);
  return c.json(result, 202);
});

// Tenant-admin: list memberships (optionally ?status=requested) to drive the acceptance UI.
tenantsRouter.get('/:tenantId/memberships', async (c) => {
  const user = c.get('user');
  const tenantId = c.req.param('tenantId');
  const statusParam = c.req.query('status');
  if (statusParam && !VALID_STATUSES.includes(statusParam as MembershipStatus)) {
    return c.json({ error: 'Invalid status' }, 400);
  }
  try {
    const items = await listTenantMemberships(
      user.userId,
      user.role,
      tenantId,
      statusParam as MembershipStatus | undefined,
    );
    return c.json({ items });
  } catch (error) {
    return mapServiceError(c, error);
  }
});

// Tenant-admin: list the OAuth clients (RPs) registered to this tenant (Lot 4 governance).
tenantsRouter.get('/:tenantId/clients', async (c) => {
  const user = c.get('user');
  const tenantId = c.req.param('tenantId');
  try {
    const items = await listTenantClients(user.userId, user.role, tenantId);
    return c.json({ items });
  } catch (error) {
    return mapServiceError(c, error);
  }
});

function decisionRoute(decision: MembershipDecision) {
  return async (c: Context) => {
    const user = c.get('user');
    const tenantId = c.req.param('tenantId');
    const targetUserId = c.req.param('userId');
    if (!tenantId || !targetUserId) {
      return c.json({ error: 'Bad request' }, 400);
    }
    if (targetUserId === user.userId && decision !== 'suspend') {
      return c.json({ error: 'Cannot decide own membership' }, 400);
    }
    try {
      const result = await decideMembership(user.userId, user.role, tenantId, targetUserId, decision);
      return c.json({ success: true, ...result });
    } catch (error) {
      return mapServiceError(c, error);
    }
  };
}

tenantsRouter.post('/:tenantId/memberships/:userId/approve', decisionRoute('approve'));
tenantsRouter.post('/:tenantId/memberships/:userId/reject', decisionRoute('reject'));
tenantsRouter.post('/:tenantId/memberships/:userId/suspend', decisionRoute('suspend'));

// Re-exported so the mount site can assert tenant-admin on future tenant-scoped routes.
export { assertTenantAdmin };
