import { db } from '../db/client';
import { userSessions, users } from '../db/schema';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { logger } from '../logger';
import { retryRemoteRevocations, tombstoneRemoteSessions } from './auth/remote-revocation';
import { queueRemoteRevocation } from './auth/remote-revocation-outbox';

export async function runAdminApprovalSweep(): Promise<{ expiredCount: number }> {
  const now = new Date();

  const expired = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.accountStatus, 'pending_admin_approval'),
        lt(users.approvalDueAt, now)
      )
    );

  await retryRemoteRevocations();
  if (expired.length === 0) return { expiredCount: 0 };

  const ids = expired.map((u) => u.id);

  await db
    .update(users)
    .set({
      accountStatus: 'approval_expired_readonly',
      updatedAt: now,
    })
    .where(inArray(users.id, ids));

  // Revoke all sessions so next login uses the reduced effective role immediately.
  const pending = await db.transaction(async tx => {
    const deleted = await tx.delete(userSessions).where(inArray(userSessions.userId, ids))
      .returning({ id: userSessions.id, userId: userSessions.userId });
    const intents = [];
    for (const userId of ids) {
      const input = { userId, sessionIds: deleted.filter(row => row.userId === userId).map(row => row.id) };
      intents.push({ input, key: await queueRemoteRevocation(input, tx) });
    }
    return intents;
  });
  // Finish all database removals before issuer delivery; one failure must not skip other users.
  const deliveries = await Promise.allSettled(pending.map(({ input, key }) => tombstoneRemoteSessions(input, key)));
  const failedUserIds = ids.filter((_, index) => deliveries[index].status === 'rejected');
  if (failedUserIds.length) logger.error({ code: 'authority_unavailable', userIds: failedUserIds },
    'Admin approval sweep: issuer revocation requires recovery');

  logger.info({ count: ids.length }, 'Admin approval sweep: moved users to read-only and removed database sessions');
  return { expiredCount: ids.length };
}


