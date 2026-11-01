import { logger } from '../logger';
import { retryRemoteRevocations, tombstoneRemoteSessions } from './auth/remote-revocation';
import { deleteAndQueueRemoteSessions } from './auth/remote-revocation-outbox';
import { listCmUsers, updateCmUser } from './identity/cm-users';

export async function runAdminApprovalSweep(): Promise<{ expiredCount: number }> {
  const now = new Date();

  // Lot A4: account status lives in the CM identity store; no legacy reads.
  const expired = (await listCmUsers()).filter(
    (u) => u.accountStatus === 'pending_admin_approval' && u.approvalDueAt !== null && u.approvalDueAt < now
  );

  await retryRemoteRevocations();
  if (expired.length === 0) return { expiredCount: 0 };

  const ids = expired.map((u) => u.id);

  for (const id of ids) {
    await updateCmUser(id, { accountStatus: 'approval_expired_readonly', updatedAt: now });
  }

  // Revoke all CM sessions so next login uses the reduced effective role immediately.
  const pending = [];
  for (const userId of ids) {
    const { input, key } = await deleteAndQueueRemoteSessions({ userId });
    pending.push({ input, key });
  }
  // Finish all session removals before issuer delivery; one failure must not skip other users.
  const deliveries = await Promise.allSettled(pending.map(({ input, key }) => tombstoneRemoteSessions(input, key)));
  const failedUserIds = ids.filter((_, index) => deliveries[index].status === 'rejected');
  if (failedUserIds.length) logger.error({ code: 'authority_unavailable', userIds: failedUserIds },
    'Admin approval sweep: issuer revocation requires recovery');

  logger.info({ count: ids.length }, 'Admin approval sweep: moved users to read-only and revoked CM sessions');
  return { expiredCount: ids.length };
}
