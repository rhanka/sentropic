import { logger } from '../../logger';
import { closeRemoteSessionAuthority, getRemoteSessionAuthority } from './remote-private-session';

export interface RemoteSessionRevocation { sessionIds: string[]; userId?: string }

// Only the issuer invokes this port. Failure closes remote authority until operator recovery.
export function persistRemoteSessionRevocation(input: RemoteSessionRevocation): boolean {
  let failed = false;
  try {
    const authority = getRemoteSessionAuthority();
    if (!authority) throw new Error('issuer_required');
    for (const id of input.sessionIds) {
      try { authority.revoke(id); } catch { failed = true; }
    }
    if (input.userId) {
      try { authority.revokeUser(input.userId); } catch { failed = true; }
    }
  } catch { failed = true; }
  if (failed) {
    closeRemoteSessionAuthority();
    logger.error({ code: 'authority_unavailable' }, 'Remote session revocation requires issuer recovery');
  }
  return !failed;
}

// Called after the DB delete: private storage must never prevent ordinary logout.
export async function tombstoneRemoteSessions(input: RemoteSessionRevocation): Promise<void> {
  if (process.env.REMOTE_ACTION_ROLE === 'auth-idp') persistRemoteSessionRevocation(input);
}
