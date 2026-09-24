import type { LockSnapshot } from '$lib/utils/object-lock';

export type LockAcquireResult = { lock: LockSnapshot | null; acquired: boolean };

const heldBy = (lock: LockSnapshot | null | undefined, userId: string | null | undefined) =>
  !!lock && !!userId && lock.lockedBy.userId === userId;

/**
 * Tracks whether a lock page still intends to keep (and auto-acquire) its lock.
 *
 * Only an explicit acquisition or an unlock hand-over requested by this user arms renewal.
 * An explicit release disarms renewal, invalidates every renewal already in flight, and
 * suppresses automatic re-acquisition until another holder is observed or the page
 * explicitly acquires again. Lock notifications produced by a pending renewal or by its
 * compensating cleanup therefore never re-arm a released lock.
 */
export function createLockRenewal() {
  let intentKey: string | null = null;
  let suppressedKey: string | null = null;
  let lastHolder: { key: string; userId: string | null } | null = null;
  let epoch = 0;

  return {
    hasIntent: (key: string) => intentKey === key,

    /** Whether a free lock may be auto-acquired (false after an explicit release). */
    autoAcquireAllowed: (key: string) => suppressedKey !== key,

    /** Explicit acquisition attempt (page load, legitimate recovery). */
    acquired(key: string, lock: LockSnapshot | null, userId: string | null | undefined) {
      if (suppressedKey === key) suppressedKey = null;
      if (heldBy(lock, userId)) intentKey = key;
    },

    /** Lock update from the server. */
    observed(
      key: string,
      previous: LockSnapshot | null,
      next: LockSnapshot | null,
      userId: string | null | undefined
    ) {
      lastHolder = { key, userId: next?.lockedBy.userId ?? null };
      if (next && !heldBy(next, userId) && suppressedKey === key) suppressedKey = null;
      const handover =
        heldBy(next, userId) &&
        !!previous &&
        !heldBy(previous, userId) &&
        !!userId &&
        previous.unlockRequestedByUserId === userId;
      if (handover) intentKey = key;
    },

    /** Explicit release or hand-over: stop renewing and invalidate pending renewals. */
    release(key: string | null) {
      intentKey = null;
      suppressedKey = key;
      epoch += 1;
    },

    /**
     * Re-acquire a lock this page intends to keep. Returns null when renewal is not intended
     * or was invalidated while the request was in flight. A late re-acquisition is undone
     * with a release conditional on that exact lock still being held by this user, unless
     * another holder has been observed meanwhile.
     */
    async renew(
      key: string,
      userId: string,
      acquire: () => Promise<LockAcquireResult>,
      releaseOwn: (lockId: string) => Promise<unknown>
    ): Promise<LockAcquireResult | null> {
      if (intentKey !== key) return null;
      const startedAt = epoch;
      const res = await acquire();
      const holds = heldBy(res.lock, userId);
      if (startedAt !== epoch) {
        const otherHolderSeen =
          lastHolder?.key === key && lastHolder.userId !== null && lastHolder.userId !== userId;
        if (holds && res.lock && intentKey !== key && !otherHolderSeen) {
          try {
            await releaseOwn(res.lock.id);
          } catch {
            // the server-side TTL remains the fallback
          }
        }
        return null;
      }
      if (!holds) intentKey = null;
      return res;
    },
  };
}

export type LockRenewal = ReturnType<typeof createLockRenewal>;
