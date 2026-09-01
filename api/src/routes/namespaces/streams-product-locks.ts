import { and, eq, gt } from 'drizzle-orm';

import { db } from '../../db/client';
import { objectLocks, users } from '../../db/schema';
import { listPresence } from '../../services/lock-presence';
import { clearLocksForUser } from '../../services/lock-service';
import type { StreamsLocksPort } from './streams-ports';

export const productStreamsLocksPort: StreamsLocksPort = {
  clearForUser: (userId) => clearLocksForUser(userId),
  readPresence: async (input) => listPresence(input),
  async readSnapshot({ objectType, objectId, workspaceId }) {
    const [row] = await db
      .select({
        id: objectLocks.id,
        workspaceId: objectLocks.workspaceId,
        objectType: objectLocks.objectType,
        objectId: objectLocks.objectId,
        lockedAt: objectLocks.lockedAt,
        expiresAt: objectLocks.expiresAt,
        lockedByUserId: objectLocks.lockedByUserId,
        lockedByEmail: users.email,
        lockedByDisplayName: users.displayName,
        unlockRequestedAt: objectLocks.unlockRequestedAt,
        unlockRequestedByUserId: objectLocks.unlockRequestedByUserId,
        unlockRequestMessage: objectLocks.unlockRequestMessage,
      })
      .from(objectLocks)
      .innerJoin(users, eq(objectLocks.lockedByUserId, users.id))
      .where(and(
        eq(objectLocks.workspaceId, workspaceId),
        eq(objectLocks.objectType, objectType),
        eq(objectLocks.objectId, objectId),
        gt(objectLocks.expiresAt, new Date()),
      ))
      .limit(1);
    if (!row?.id) return null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      objectType: row.objectType,
      objectId: row.objectId,
      lockedAt: row.lockedAt,
      expiresAt: row.expiresAt,
      lockedBy: {
        userId: row.lockedByUserId,
        email: row.lockedByEmail ?? null,
        displayName: row.lockedByDisplayName ?? null,
      },
      unlockRequestedAt: row.unlockRequestedAt ?? null,
      unlockRequestedByUserId: row.unlockRequestedByUserId ?? null,
      unlockRequestMessage: row.unlockRequestMessage ?? null,
    };
  },
};
