import type { LockSnapshot } from '$lib/utils/object-lock';

export type LockAcquireResult = { lock: LockSnapshot | null; acquired: boolean };

const heldBy = (lock: LockSnapshot | null | undefined, userId: string | null | undefined) =>
  !!lock && !!userId && lock.lockedBy.userId === userId;

/**
 * Tracks whether a lock page still intends to keep renewing its lock.
 *
 * Renewal (periodic tick, SSE reconnect ping) only re-acquires while intent is armed.
 * An explicit release invalidates intent and every renewal already in flight, so a
 * missed release notification can never lead to a silent re-acquisition.
 */
export function createLockRenewal() {
  let intentKey: string | null = null;
  let epoch = 0;

  return {
    hasIntent: (key: string) => intentKey === key,

    /** Explicit acquisition (page load, legitimate recovery): arm when this user holds the lock. */
    acquired(key: string, lock: LockSnapshot | null, userId: string | null | undefined) {
      if (heldBy(lock, userId)) intentKey = key;
    },

    /** Lock update from the server: arm only on a transition to this user (unlock hand-over). */
    observed(
      key: string,
      previous: LockSnapshot | null,
      next: LockSnapshot | null,
      userId: string | null | undefined
    ) {
      if (heldBy(next, userId) && !heldBy(previous, userId)) intentKey = key;
    },

    /** Explicit release or hand-over: stop renewing and invalidate pending renewals. */
    release() {
      intentKey = null;
      epoch += 1;
    },

    /**
     * Re-acquire a lock this page intends to keep. Returns null when renewal is not intended
     * or was invalidated while the request was in flight; a late re-acquisition of a lock the
     * user no longer intends to hold is released again.
     */
    async renew(
      key: string,
      userId: string,
      acquire: () => Promise<LockAcquireResult>,
      release: () => Promise<unknown>
    ): Promise<LockAcquireResult | null> {
      if (intentKey !== key) return null;
      const startedAt = epoch;
      const res = await acquire();
      const holds = heldBy(res.lock, userId);
      if (startedAt !== epoch) {
        if (holds && intentKey !== key) {
          try {
            await release();
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
