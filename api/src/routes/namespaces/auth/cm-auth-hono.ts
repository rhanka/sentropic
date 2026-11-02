import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { workspaces } from '../../../db/schema';
import { revokeAllSessions } from '../../../services/session-manager';
import { findCmUserById, updateCmUser } from '../../../services/identity/cm-users';
import { remoteRevocationError } from '../../../services/auth/remote-revocation-error';
import { deleteOwnCmAccount } from '../../../services/identity/cm-account-deletion';
import { runCmAccountDeletionHttp } from './cm-deletion-http';

// ---------------------------------------------------------------------------
// /me — account lifecycle over the CM stores
// ---------------------------------------------------------------------------

export const accountRouter = new Hono();
accountRouter.onError((error, c) => remoteRevocationError(error, c, true));

accountRouter.get('/', async (c) => {
  const { userId, workspaceId, role } = c.get('user');

  const user = await findCmUserById(userId);

  const [ws] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return c.json({
    user,
    workspace: ws ?? null,
    // role can be dynamically downgraded (approval expired => guest)
    effectiveRole: role,
  });
});

accountRouter.post('/deactivate', async (c) => {
  const { userId } = c.get('user');
  const now = new Date();

  await updateCmUser(userId, {
    accountStatus: 'disabled_by_user',
    disabledAt: now,
    disabledReason: 'user_deactivated',
    updatedAt: now,
  });

  // Revoke sessions immediately
  await revokeAllSessions(userId);

  return c.json({ success: true });
});

accountRouter.delete('/', async (c) => {
  const { userId } = c.get('user');
  return runCmAccountDeletionHttp(c, operationId => deleteOwnCmAccount(userId, operationId));
});

