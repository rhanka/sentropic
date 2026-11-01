import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { workspaces } from '../../../db/schema';
import { findCmUserById, updateCmUser } from '../../../services/identity/cm-users';
import { findCmWorkspace } from '../../../services/identity/cm-tenancy';
import { listCmSessionsForUser } from '../../../services/identity/cm-sessions';
import { revokeAllSessions } from '../../../services/session-manager';
import { tombstoneRemoteSessions } from '../../../services/auth/remote-revocation';
import { remoteRevocationError } from '../../../services/auth/remote-revocation-error';
import { deleteAccountAtomically } from '../../../services/auth/account-deletion';

// Lot A4: account reads/writes go through the CM identity stores; deletion is
// the A2.3 atomic cascade (createAtomicPersonDeletionV2). The legacy
// public.users / user_sessions / webauthn_* / magic_links tables are dropped
// by control migration 0014 — no legacy fallback.

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

/**
 * DELETE /me
 * Immediate account suppression through the A2.3 atomic cascade: the account
 * is disabled first (the cascade requires a disabled account), then identity
 * AND business rows are removed in one transaction. A failure rolls back
 * everything — no orphan, no partial deletion.
 */
accountRouter.delete('/', async (c) => {
  const { userId, workspaceId } = c.get('user');
  const now = new Date();

  await updateCmUser(userId, {
    accountStatus: 'disabled_by_user',
    disabledAt: now,
    disabledReason: 'user_deleted',
    updatedAt: now,
  });

  const sessionIds = (await listCmSessionsForUser(userId)).map((row) => row.id);
  const { receipt, remoteRevocationKey } = await deleteAccountAtomically({
    userId,
    actorId: userId,
    handlerId: 'self_account',
    workspaceId,
  });

  if (receipt.transaction !== 'committed') {
    return c.json({ error: 'Account deletion rolled back', resultCode: receipt.resultCode }, 409);
  }

  // Only after a successful commit — a rolled-back transaction must not leave
  // a revoked grant or a tombstoned remote session behind for a live account.
  await tombstoneRemoteSessions({ sessionIds, userId }, remoteRevocationKey ?? undefined);

  return c.json({ success: true });
});
