import { and, eq, gt, lt } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { objectLocks, users } from '../db/schema';
import { createId } from '../utils/id';
import { hasWorkspaceRole } from './workspace-access';

export type LockObjectType = 'organization' | 'folder' | 'usecase';

export type LockSnapshot = {
  id: string;
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
  lockedAt: Date;
  expiresAt: Date;
  lockedBy: {
    userId: string;
    email: string | null;
    displayName: string | null;
  };
  unlockRequestedAt: Date | null;
  unlockRequestedByUserId: string | null;
  unlockRequestMessage: string | null;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;

type HttpError = Error & { status: number };
function httpError(status: number, message: string): HttpError {
  const e = new Error(message) as HttpError;
  e.status = status;
  return e;
}

function normalizeObjectType(value: string): LockObjectType | null {
  const v = (value || '').trim().toLowerCase();
  if (v === 'organization') return 'organization';
  if (v === 'folder') return 'folder';
  if (v === 'usecase') return 'usecase';
  return null;
}

function escapeNotifyPayload(payload: string): string {
  return payload.replace(/'/g, "''");
}

export async function getActiveLock(
  workspaceId: string,
  objectType: LockObjectType,
  objectId: string
): Promise<LockSnapshot | null> {
  const now = new Date();
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
    .where(
      and(
        eq(objectLocks.workspaceId, workspaceId),
        eq(objectLocks.objectType, objectType),
        eq(objectLocks.objectId, objectId),
        gt(objectLocks.expiresAt, now)
      )
    )
    .limit(1);

  if (!row?.id) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    objectType: normalizeObjectType(String(row.objectType)) ?? objectType,
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
}

export async function acquireLock(options: {
  userId: string;
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
  ttlMs?: number;
}): Promise<{ lock: LockSnapshot; acquired: boolean }> {
  const now = new Date();
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(5_000, options.ttlMs as number) : DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs);

  // Remove expired lock for the same object, then attempt acquisition.
  const result = await db.transaction(async (tx) => {
    await tx
      .delete(objectLocks)
      .where(
        and(
          eq(objectLocks.workspaceId, options.workspaceId),
          eq(objectLocks.objectType, options.objectType),
          eq(objectLocks.objectId, options.objectId),
          lt(objectLocks.expiresAt, now)
        )
      );

    const [existing] = await tx
      .select({
        id: objectLocks.id,
        lockedByUserId: objectLocks.lockedByUserId,
        expiresAt: objectLocks.expiresAt,
      })
      .from(objectLocks)
      .where(
        and(
          eq(objectLocks.workspaceId, options.workspaceId),
          eq(objectLocks.objectType, options.objectType),
          eq(objectLocks.objectId, options.objectId),
          gt(objectLocks.expiresAt, now)
        )
      )
      .limit(1);

    if (existing?.id) {
      // Idempotent refresh if the lock is already owned by the same user.
      if (existing.lockedByUserId === options.userId) {
        await tx
          .update(objectLocks)
          .set({ expiresAt, updatedAt: now })
          .where(eq(objectLocks.id, existing.id));
        return { type: 'refresh' as const };
      }
      return { type: 'conflict' as const, lockId: existing.id };
    }

    const id = createId();
    await tx.insert(objectLocks).values({
      id,
      workspaceId: options.workspaceId,
      objectType: options.objectType,
      objectId: options.objectId,
      lockedByUserId: options.userId,
      lockedAt: now,
      expiresAt,
      updatedAt: now,
    });
    return { type: 'acquired' as const };
  });

  const lock = await getActiveLock(options.workspaceId, options.objectType, options.objectId);
  if (!lock) {
    // Should be extremely rare; treat as server error
    throw new Error('Failed to acquire lock');
  }

  if (result.type === 'conflict') {
    return { lock, acquired: false };
  }

  // Notify clients for lock state changes (best-effort)
  await notifyLockEvent(options.workspaceId, options.objectType, options.objectId);
  return { lock, acquired: true };
}

export async function releaseLock(options: {
  userId: string;
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
}): Promise<{ released: boolean }> {
  const now = new Date();
  const [existing] = await db
    .select({ id: objectLocks.id, lockedByUserId: objectLocks.lockedByUserId })
    .from(objectLocks)
    .where(
      and(
        eq(objectLocks.workspaceId, options.workspaceId),
        eq(objectLocks.objectType, options.objectType),
        eq(objectLocks.objectId, options.objectId),
        gt(objectLocks.expiresAt, now)
      )
    )
    .limit(1);

  if (!existing?.id) return { released: false };

  const isAdmin = await hasWorkspaceRole(options.userId, options.workspaceId, 'admin');
  if (existing.lockedByUserId !== options.userId && !isAdmin) {
    throw httpError(403, 'Insufficient permissions');
  }

  await db.delete(objectLocks).where(eq(objectLocks.id, existing.id));
  await notifyLockEvent(options.workspaceId, options.objectType, options.objectId);
  return { released: true };
}

export async function requestUnlock(options: {
  userId: string;
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
  message?: string;
}): Promise<{ requested: boolean; lock: LockSnapshot | null }> {
  const now = new Date();
  const lock = await getActiveLock(options.workspaceId, options.objectType, options.objectId);
  if (!lock) return { requested: false, lock: null };

  if (lock.lockedBy.userId === options.userId) {
    return { requested: false, lock };
  }

  await db
    .update(objectLocks)
    .set({
      unlockRequestedAt: now,
      unlockRequestedByUserId: options.userId,
      unlockRequestMessage: (options.message || '').trim() || null,
      updatedAt: now,
    })
    .where(eq(objectLocks.id, lock.id));

  await notifyLockEvent(options.workspaceId, options.objectType, options.objectId);
  return { requested: true, lock: await getActiveLock(options.workspaceId, options.objectType, options.objectId) };
}

export async function forceUnlock(options: {
  userId: string;
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
}): Promise<{ forced: boolean }> {
  const lock = await getActiveLock(options.workspaceId, options.objectType, options.objectId);
  if (!lock) return { forced: false };

  const isAdmin = await hasWorkspaceRole(options.userId, options.workspaceId, 'admin');
  if (!isAdmin) {
    throw httpError(403, 'Insufficient permissions');
  }

  await db.delete(objectLocks).where(eq(objectLocks.id, lock.id));
  await notifyLockEvent(options.workspaceId, options.objectType, options.objectId);
  return { forced: true };
}

export async function notifyLockEvent(workspaceId: string, objectType: LockObjectType, objectId: string): Promise<void> {
  const payload = JSON.stringify({
    workspace_id: workspaceId,
    object_type: objectType,
    object_id: objectId,
  });

  const client = await pool.connect();
  try {
    await client.query(`NOTIFY lock_events, '${escapeNotifyPayload(payload)}'`);
  } finally {
    client.release();
  }
}

