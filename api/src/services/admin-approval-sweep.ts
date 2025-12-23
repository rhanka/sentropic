import { db } from '../db/client';
import { userSessions, users } from '../db/schema';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { logger } from '../logger';

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
  await db.delete(userSessions).where(inArray(userSessions.userId, ids));

  logger.info({ count: ids.length }, 'Admin approval sweep: moved users to read-only and revoked sessions');
  return { expiredCount: ids.length };
}


