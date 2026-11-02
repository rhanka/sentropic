import { IdentityNotFoundError, MembershipTransitionError, SelfActionForbiddenError,
  TenantNotActiveError, type WorkspacesRouterPorts } from '@sentropic/cluster-mesh';
import type { Handler } from 'hono';
import { CmIdentityForbiddenError } from '../../../services/identity/cm-deletion-authorization';
import { decideMembership, listTenantClients, listTenantMemberships, requestMembership,
  type MembershipDecision, type MembershipStatus } from '../../../services/identity/cm-membership';

const statuses: readonly MembershipStatus[] = ['invited', 'requested', 'approved', 'rejected', 'suspended'];
const handle = (operation: Handler): [Handler] => [async (c, next) => {
  try { return await operation(c, next); }
  catch (error) {
    if (error instanceof CmIdentityForbiddenError) return c.json({ error: 'Forbidden' }, 403);
    if (error instanceof IdentityNotFoundError) return c.json({ error: 'Not found' }, 404);
    if (error instanceof MembershipTransitionError) return c.json({ error: 'Invalid transition' }, 409);
    if (error instanceof TenantNotActiveError) return c.json({ error: 'Tenant not active' }, 409);
    if (error instanceof SelfActionForbiddenError) return c.json({ error: 'Cannot decide own membership' }, 400);
    return c.json({ error: 'Identity service unavailable' }, 503);
  }
}];
const decision = (action: MembershipDecision) => handle(async c => {
  const actor = c.get('user');
  const result = await decideMembership(actor.userId, actor.role, c.req.param('tenantId')!, c.req.param('userId')!, action);
  return c.json({ success: true, ...result });
});

/** HTTP projection only; CM owns the membership state machine and audit. */
export const cmTenantPorts: WorkspacesRouterPorts['tenants'] = {
  requestMembership: handle(async c => c.json(await requestMembership(c.get('user').userId, c.req.param('tenantId')!), 202)),
  listMemberships: handle(async c => {
    const status = c.req.query('status');
    if (status && !statuses.includes(status as MembershipStatus)) return c.json({ error: 'Invalid status' }, 400);
    const actor = c.get('user');
    const items = await listTenantMemberships(actor.userId, actor.role, c.req.param('tenantId')!, status as MembershipStatus | undefined);
    return c.json({ items });
  }),
  listClients: handle(async c => {
    const actor = c.get('user');
    return c.json({ items: await listTenantClients(actor.userId, actor.role, c.req.param('tenantId')!) });
  }),
  approveMembership: decision('approve'),
  rejectMembership: decision('reject'),
  suspendMembership: decision('suspend'),
};
