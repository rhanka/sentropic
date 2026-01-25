import type { LockObjectType } from './lock-service';
import { db, pool } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

type PresenceUser = {
  userId: string;
  email: string | null;
  displayName: string | null;
  lastSeen: number;
};

export type PresenceSnapshot = {
  users: Array<{ userId: string; email: string | null; displayName: string | null }>;
  total: number;
};

const PRESENCE_TTL_MS = 90_000;
const presenceByObject = new Map<string, Map<string, PresenceUser>>();

function makeKey(workspaceId: string, objectType: LockObjectType, objectId: string): string {
  return `${workspaceId}:${objectType}:${objectId}`;
}

function prune(map: Map<string, PresenceUser>): void {
  const now = Date.now();
  for (const [userId, entry] of map.entries()) {
    if (now - entry.lastSeen > PRESENCE_TTL_MS) {
      map.delete(userId);
    }
  }
}

function toSnapshot(map?: Map<string, PresenceUser>): PresenceSnapshot {
  if (!map) return { users: [], total: 0 };
  const users = [...map.values()].map((u) => ({
    userId: u.userId,
    email: u.email,
    displayName: u.displayName
  }));
  return { users, total: users.length };
}

async function notifyPresenceEvent(options: {
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
}): Promise<void> {
  const payload = JSON.stringify({
    workspace_id: options.workspaceId,
    object_type: options.objectType,
    object_id: options.objectId,
  }).replace(/'/g, "''");

  const client = await pool.connect();
  try {
    await client.query(`NOTIFY presence_events, '${payload}'`);
  } finally {
    client.release();
  }
}

export async function recordPresence(options: {
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
  user: { userId: string; email: string | null; displayName: string | null };
}): Promise<PresenceSnapshot> {
  let email = options.user.email ?? null;
  let displayName = options.user.displayName ?? null;
  if (!email && !displayName) {
    const [row] = await db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, options.user.userId))
      .limit(1);
    email = row?.email ?? null;
    displayName = row?.displayName ?? null;
  }
  const key = makeKey(options.workspaceId, options.objectType, options.objectId);
  const now = Date.now();
  const map = presenceByObject.get(key) ?? new Map<string, PresenceUser>();
  map.set(options.user.userId, {
    userId: options.user.userId,
    email,
    displayName,
    lastSeen: now
  });
  prune(map);
  if (map.size === 0) {
    presenceByObject.delete(key);
    return { users: [], total: 0 };
  }
  presenceByObject.set(key, map);
  const snapshot = toSnapshot(map);
  await notifyPresenceEvent(options);
  return snapshot;
}

export function listPresence(options: {
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
}): PresenceSnapshot {
  const key = makeKey(options.workspaceId, options.objectType, options.objectId);
  const map = presenceByObject.get(key);
  if (!map) return { users: [], total: 0 };
  prune(map);
  if (map.size === 0) {
    presenceByObject.delete(key);
    return { users: [], total: 0 };
  }
  return toSnapshot(map);
}

export async function removePresence(options: {
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
  userId: string;
}): Promise<PresenceSnapshot> {
  const key = makeKey(options.workspaceId, options.objectType, options.objectId);
  const map = presenceByObject.get(key);
  if (!map) return { users: [], total: 0 };
  map.delete(options.userId);
  prune(map);
  if (map.size === 0) {
    presenceByObject.delete(key);
    await notifyPresenceEvent(options);
    return { users: [], total: 0 };
  }
  presenceByObject.set(key, map);
  const snapshot = toSnapshot(map);
  await notifyPresenceEvent(options);
  return snapshot;
}
