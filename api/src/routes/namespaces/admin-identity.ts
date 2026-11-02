import { Hono } from 'hono';
import { z } from 'zod';
import { AccountTransitionError, AdminUserProtectedError, IdentityNotFoundError, SelfActionForbiddenError } from '@sentropic/cluster-mesh';
import { zValidator } from '../../utils/zod-validator';
import { changeCmAccountAsAdmin } from '../../services/identity/cm-account-administration';
import { listCmAdminUserViews } from '../../services/identity/cm-administration-directory';
import { CmIdentityForbiddenError } from '../../services/identity/cm-deletion-authorization';
import { deleteCmAccountAsAdmin } from '../../services/identity/cm-account-deletion';
import { runCmAccountDeletionHttp } from './auth/cm-deletion-http';

export const cmAdminIdentityRouter = new Hono();
cmAdminIdentityRouter.onError((error, c) => {
  if (error instanceof IdentityNotFoundError) return c.json({ error: 'User not found' }, 404);
  if (error instanceof CmIdentityForbiddenError) return c.json({ error: 'Forbidden' }, 403);
  if (error instanceof AccountTransitionError || error instanceof AdminUserProtectedError || error instanceof SelfActionForbiddenError) {
    return c.json({ error: 'Account action refused' }, 400);
  }
  return c.json({ error: 'Identity service unavailable' }, 503);
});
const role = z.enum(['admin_app', 'admin_org', 'editor', 'guest']);
const status = z.enum(['active', 'pending_admin_approval', 'approval_expired_readonly', 'disabled_by_user', 'disabled_by_admin']);

cmAdminIdentityRouter.get('/users', async c => {
  const raw = c.req.query('status');
  const filter = raw ? status.safeParse(raw) : { success: true as const, data: undefined };
  if (!filter.success) return c.json({ error: 'Invalid status' }, 400);
  return c.json({ items: await listCmAdminUserViews(c.get('user').userId, filter.data) });
});
cmAdminIdentityRouter.post('/users/:id/approve', zValidator('json', z.object({ role: role.optional() })), async c => {
  await changeCmAccountAsAdmin({ actorId: c.get('user').userId, userId: c.req.param('id'),
    action: { kind: 'approve', role: c.req.valid('json').role } });
  return c.json({ success: true });
});
cmAdminIdentityRouter.post('/users/:id/disable', zValidator('json', z.object({ reason: z.string().max(256).optional() })), async c => {
  await changeCmAccountAsAdmin({ actorId: c.get('user').userId, userId: c.req.param('id'),
    action: { kind: 'disable', reason: c.req.valid('json').reason } });
  return c.json({ success: true });
});
cmAdminIdentityRouter.post('/users/:id/reactivate', async c => {
  await changeCmAccountAsAdmin({ actorId: c.get('user').userId, userId: c.req.param('id'), action: { kind: 'reactivate' } });
  return c.json({ success: true });
});
cmAdminIdentityRouter.delete('/users/:id', c => runCmAccountDeletionHttp(c, operationId => deleteCmAccountAsAdmin({
  actorId: c.get('user').userId, userId: c.req.param('id'),
}, operationId)));
