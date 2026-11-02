import { logger } from '../logger';
import { drainCmRevocations } from './identity/cm-revocation-worker';
import { cmAuthSessionService } from './identity/cm-session-facade';
import { listCmUsers, updateCmUser } from './identity/cm-users';

export async function runAdminApprovalSweep(): Promise<{ expiredCount: number }> {
  const now = new Date();
  await drainCmRevocations();

  // Lot A4: account status lives in the CM identity store; no legacy reads.
  const expired = (await listCmUsers()).filter(
    (u) => u.accountStatus === 'pending_admin_approval' && u.approvalDueAt !== null && u.approvalDueAt < now
  );

  if (expired.length === 0) return { expiredCount: 0 };

  const ids = expired.map((u) => u.id);

  for (const id of ids) {
    await updateCmUser(id, { accountStatus: 'approval_expired_readonly', updatedAt: now });
  }

  // Revoke all CM sessions so next login uses the reduced effective role immediately.
  for (const userId of ids) {
    await cmAuthSessionService.revokeAllSessions(userId);
  }

  logger.info({ count: ids.length }, 'Admin approval sweep: moved users to read-only and revoked CM sessions');
  return { expiredCount: ids.length };
}
