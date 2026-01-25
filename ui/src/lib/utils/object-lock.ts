import { ApiError, apiDelete, apiGet, apiPost } from '$lib/utils/api';
import { API_BASE_URL } from '$lib/config';
import { browser } from '$app/environment';
import { getScopedWorkspaceIdForUser } from '$lib/stores/workspaceScope';

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

export type PresenceUser = {
  userId: string;
  email: string | null;
  displayName: string | null;
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

export async function acceptUnlock(
  objectType: LockObjectType,
  objectId: string
): Promise<{ accepted: boolean; lock: LockSnapshot | null }> {
  const res = await apiPost<{ accepted: boolean; lock: LockSnapshot | null }>('/locks/accept-unlock', {
    objectType,
    objectId
  });
  return { accepted: Boolean(res?.accepted), lock: res?.lock ?? null };
}

export async function forceUnlock(objectType: LockObjectType, objectId: string): Promise<{ forced: boolean }> {
  const res = await apiPost<{ forced: boolean }>('/locks/force-unlock', { objectType, objectId });
  return { forced: Boolean(res?.forced) };
}

export async function sendPresence(
  objectType: LockObjectType,
  objectId: string
): Promise<{ users: PresenceUser[]; total: number }> {
  const res = await apiPost<{ users: PresenceUser[]; total: number }>('/locks/presence', { objectType, objectId });
  return { users: res?.users ?? [], total: Number(res?.total ?? 0) };
}

export async function fetchPresence(
  objectType: LockObjectType,
  objectId: string
): Promise<{ users: PresenceUser[]; total: number }> {
  const qs = new URLSearchParams({ objectType, objectId }).toString();
  const res = await apiGet<{ users: PresenceUser[]; total: number }>(`/locks/presence?${qs}`);
  return { users: res?.users ?? [], total: Number(res?.total ?? 0) };
}

export async function leavePresence(objectType: LockObjectType, objectId: string): Promise<void> {
  const payload = JSON.stringify({ objectType, objectId });
  const scoped = getScopedWorkspaceIdForUser();
  const url = (() => {
    if (!scoped || !browser) return `${API_BASE_URL}/locks/presence/leave`;
    const u = new URL(`${API_BASE_URL}/locks/presence/leave`, window.location.origin);
    u.searchParams.set('workspace_id', scoped);
    return u.toString();
  })();
  if (browser && typeof navigator !== 'undefined') {
    const apiOrigin = new URL(API_BASE_URL, window.location.origin).origin;
    const isSameOrigin = apiOrigin === window.location.origin;
    if (isSameOrigin && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return;
      } catch {
        // ignore and fallback to fetch/api
      }
    }
    try {
      await fetch(url, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
      });
      return;
    } catch {
      // ignore and fallback to apiPost
    }
  }
  await apiPost('/locks/presence/leave', { objectType, objectId });
}
