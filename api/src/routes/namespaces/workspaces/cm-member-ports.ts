import { IdentityConflictError, IdentityNotFoundError, type WorkspacesRouterPorts } from '@sentropic/cluster-mesh';
import type { Handler } from 'hono';
import { z } from 'zod';
import { CmIdentityForbiddenError } from '../../../services/identity/cm-deletion-authorization';
import { changeCmWorkspaceMember, CmWorkspaceMembershipPolicyError,
  listCmWorkspaceMemberViews } from '../../../services/identity/cm-workspace-members';
import { notifyWorkspaceMembershipEvent } from '../../../services/workspace-provisioning';

const role = z.enum(['viewer', 'commenter', 'editor', 'admin']);
const add = z.object({ email: z.string().email(), role });
const update = z.object({ role });
const handle = (operation: Handler): [Handler] => [async (c, next) => {
  try { return await operation(c, next); }
  catch (error) {
    if (error instanceof CmIdentityForbiddenError) return c.json({ error: 'Insufficient permissions' }, 403);
    if (error instanceof IdentityNotFoundError) return c.json({ message: 'Not found' }, 404);
    if (error instanceof IdentityConflictError) return c.json({ error: 'Membership conflict' }, 409);
    if (error instanceof CmWorkspaceMembershipPolicyError) return c.json({ message: error.message }, 400);
    return c.json({ error: 'Identity service unavailable' }, 503);
  }
}];

export const cmMemberPorts: Pick<WorkspacesRouterPorts['workspaces'],
  'listMembers' | 'listMentions' | 'addMember' | 'updateMember' | 'removeMember'> = {
  listMembers: handle(async c => c.json({ items: await listCmWorkspaceMemberViews(c.get('user').userId, c.req.param('id')!) })),
  listMentions: handle(async c => {
    const rows = await listCmWorkspaceMemberViews(c.get('user').userId, c.req.param('id')!);
    return c.json({ items: rows.map(({ userId, email, displayName, role }) => ({ userId, email, displayName, role })) });
  }),
  addMember: handle(async c => {
    const parsed = add.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ message: 'Invalid body' }, 400);
    const workspaceId = c.req.param('id')!;
    const result = await changeCmWorkspaceMember({ actorId: c.get('user').userId, workspaceId,
      action: { kind: 'add', ...parsed.data } });
    await notifyWorkspaceMembershipEvent(workspaceId, result.userId, { action: 'added', role: parsed.data.role });
    return c.json({ success: true });
  }),
  updateMember: handle(async c => {
    const parsed = update.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ message: 'Invalid body' }, 400);
    const workspaceId = c.req.param('id')!;
    const result = await changeCmWorkspaceMember({ actorId: c.get('user').userId, workspaceId,
      action: { kind: 'set_role', userId: c.req.param('userId')!, role: parsed.data.role } });
    await notifyWorkspaceMembershipEvent(workspaceId, result.userId, { action: 'role_updated', role: parsed.data.role });
    return c.json({ success: true });
  }),
  removeMember: handle(async c => {
    const workspaceId = c.req.param('id')!;
    const result = await changeCmWorkspaceMember({ actorId: c.get('user').userId, workspaceId,
      action: { kind: 'remove', userId: c.req.param('userId')! } });
    await notifyWorkspaceMembershipEvent(workspaceId, result.userId, { action: 'removed' });
    return c.body(null, 204);
  }),
};
