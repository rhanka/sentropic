import { ApiError, apiDelete, apiGet, apiPost } from '$lib/utils/api';

export type LockObjectType = 'organization' | 'folder' | 'usecase';

export type LockSnapshot = {
  id: string;
  workspaceId: string;
  objectType: LockObjectType;
  objectId: string;
  lockedAt: string | Date;
  expiresAt: string | Date;
  lockedBy: {
    userId: string;
    email: string | null;
    displayName: string | null;
  };
  unlockRequestedAt: string | Date | null;
  unlockRequestedByUserId: string | null;
  unlockRequestMessage: string | null;
};

export async function fetchLock(objectType: LockObjectType, objectId: string): Promise<LockSnapshot | null> {
  const qs = new URLSearchParams({ objectType, objectId }).toString();
  const res = await apiGet<{ lock: LockSnapshot | null }>(`/locks?${qs}`);
  return res?.lock ?? null;
}

export async function acquireLock(
  objectType: LockObjectType,
  objectId: string,
  ttlMs?: number
): Promise<{ lock: LockSnapshot | null; acquired: boolean }> {
  try {
    const res = await apiPost<{ lock: LockSnapshot | null; acquired: boolean }>(
      '/locks',
      ttlMs ? { objectType, objectId, ttlMs } : { objectType, objectId }
    );
    return { lock: res?.lock ?? null, acquired: Boolean(res?.acquired) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const data = err.data as { lock?: LockSnapshot | null } | undefined;
      return { lock: data?.lock ?? null, acquired: false };
    }
    throw err;
  }
}

export async function releaseLock(objectType: LockObjectType, objectId: string): Promise<void> {
  const qs = new URLSearchParams({ objectType, objectId }).toString();
  await apiDelete(`/locks?${qs}`);
}

export async function requestUnlock(
  objectType: LockObjectType,
  objectId: string,
  message?: string
): Promise<{ requested: boolean; lock: LockSnapshot | null }> {
  const res = await apiPost<{ requested: boolean; lock: LockSnapshot | null }>('/locks/request-unlock', {
    objectType,
    objectId,
    message
  });
  return { requested: Boolean(res?.requested), lock: res?.lock ?? null };
}

export async function forceUnlock(objectType: LockObjectType, objectId: string): Promise<{ forced: boolean }> {
  const res = await apiPost<{ forced: boolean }>('/locks/force-unlock', { objectType, objectId });
  return { forced: Boolean(res?.forced) };
}
