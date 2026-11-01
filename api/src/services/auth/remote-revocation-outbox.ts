import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { db } from '../../db/client';
import { settings } from '../../db/schema';
import type { RemoteSessionRevocation } from './remote-revocation';
import {
  listCmSessionsForUser,
  revokeAllCmSessionsForUser,
  revokeCmSession,
} from '../identity/cm-sessions';

const prefix = 'remote_session_revocation:';
// Soft references survive account/workspace deletion. No credentials are stored here.
export async function queueRemoteRevocation(input: RemoteSessionRevocation, tx: Pick<typeof db, 'insert'> = db) {
  if (process.env.REMOTE_ACTION_ROLE === 'auth-idp'
    || (!process.env.REMOTE_ACTION_REVOCATION_ISSUER && process.env.REMOTE_ACTION_ROLE !== 'product')) return;
  const key = `${prefix}${randomUUID()}`;
  await tx.insert(settings).values({ key, value: JSON.stringify(input) });
  return key;
}
// Lot A4: sessions live in the cluster-mesh identity custody store
// (cm_identity.identity_login_sessions + identity_login_token_bindings).
// The legacy oauth_refresh_revoke_user() function was dropped by control
// migration 0014; OAuth refresh-token revocation is handled by the
// oauth-refresh adapter directly against cm_identity tables.
export async function deleteAndQueueRemoteSessions(scope: { sessionId: string } | { userId: string }) {
  const sessionIds = 'sessionId' in scope
    ? [scope.sessionId]
    : (await listCmSessionsForUser(scope.userId)).map(row => row.id);
  const input: RemoteSessionRevocation = 'sessionId' in scope
    ? { sessionIds }
    : { sessionIds, userId: scope.userId };
  // Queue first (durable outbox on the surviving settings table), then revoke
  // in CM. Both steps are idempotent; a crash between them is recovered by the
  // remote-revocation worker draining the queue.
  const key = await queueRemoteRevocation(input);
  if ('sessionId' in scope) {
    await revokeCmSession(scope.sessionId);
  } else {
    await revokeAllCmSessionsForUser(scope.userId);
  }
  const rows = sessionIds.map(id => ({ id }));
  return { rows, input, key };
}
export const pendingRemoteRevocations = () => db.select().from(settings)
  .where(like(settings.key, `${prefix}%`)).orderBy(settings.updatedAt).limit(20);
export const acknowledgeRemoteRevocation = (key: string) => db.delete(settings).where(eq(settings.key, key));
