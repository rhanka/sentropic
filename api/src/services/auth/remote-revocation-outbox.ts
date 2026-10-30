import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { db } from '../../db/client';
import { settings, userSessions } from '../../db/schema';
import type { RemoteSessionRevocation } from './remote-revocation';

const prefix = 'remote_session_revocation:';
// Soft references survive account/workspace deletion. No credentials are stored here.
export async function queueRemoteRevocation(input: RemoteSessionRevocation, tx: Pick<typeof db, 'insert'> = db) {
  if (process.env.REMOTE_ACTION_ROLE === 'auth-idp'
    || (!process.env.REMOTE_ACTION_REVOCATION_ISSUER && process.env.REMOTE_ACTION_ROLE !== 'product')) return;
  const key = `${prefix}${randomUUID()}`;
  await tx.insert(settings).values({ key, value: JSON.stringify(input) });
  return key;
}
export async function deleteAndQueueRemoteSessions(scope: { sessionId: string } | { userId: string }) {
  return db.transaction(async tx => {
    const rows = await tx.delete(userSessions).where('sessionId' in scope
      ? eq(userSessions.id, scope.sessionId) : eq(userSessions.userId, scope.userId)).returning({ id: userSessions.id });
    const input = 'sessionId' in scope ? { sessionIds: [scope.sessionId] }
      : { sessionIds: rows.map(row => row.id), userId: scope.userId };
    const key = await queueRemoteRevocation(input, tx);
    return { rows, input, key };
  });
}
export const pendingRemoteRevocations = () => db.select().from(settings)
  .where(like(settings.key, `${prefix}%`)).orderBy(settings.updatedAt).limit(20);
export const acknowledgeRemoteRevocation = (key: string) => db.delete(settings).where(eq(settings.key, key));
