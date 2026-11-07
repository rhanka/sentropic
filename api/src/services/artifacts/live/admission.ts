import type { LivePorts } from './ports';
import { LiveError, type LiveKey } from './records';

/** Cluster-wide worker admission. A refused caller is queued by retry: `builder_unavailable` with reason `queued`. */
export interface LiveAdmission {
  /** Resolves when `key` holds a slot (idempotent); otherwise throws `builder_unavailable`/`queued`. */
  acquire(key: LiveKey, ownerId: string): Promise<void>;
  /** Frees the slot only if `key` holds it. */
  release(key: LiveKey): Promise<void>;
}
const idOf = (key: LiveKey) => `${key.storageScopeId}\u0000${key.artifactId}`;

/**
 * Fair across users: when a slot is free, the waiting user whose last grant is oldest wins (never granted = first),
 * then the earliest arrival. A waiter that stops retrying for `waiterTtlMs` is dropped. Slot ownership survives an
 * API restart: before its first decision the policy reads `holders` (every runtime that is not DORMANT) and refuses
 * while that read fails. Fairness history may reset. One controller replica per environment owns this state.
 */
export function createFairAdmission(options: { capacity: number; waiterTtlMs: number; now(): number;
  holders(): Promise<Array<{ key: LiveKey; ownerId: string }>> }): LiveAdmission {
  if (!Number.isInteger(options.capacity) || options.capacity < 1) throw new Error('Live admission capacity must be a positive integer');
  const holders = new Map<string, string>();
  const waiters = new Map<string, { ownerId: string; arrived: number; seen: number }>();
  const lastGrant = new Map<string, number>();
  const refuse = (): never => { throw new LiveError('builder_unavailable', 'queued'); };
  let seeded: Promise<void> | undefined;
  const seed = () => seeded ??= options.holders().then(running => {
    for (const { key, ownerId } of running) { holders.set(idOf(key), ownerId); lastGrant.set(ownerId, options.now()); }
  }, () => { seeded = undefined; throw new LiveError('builder_unavailable'); });
  return {
    async acquire(key, ownerId) {
      await seed();
      const id = idOf(key); const now = options.now();
      if (holders.has(id)) return;
      for (const [waiting, entry] of waiters) if (now - entry.seen > options.waiterTtlMs) waiters.delete(waiting);
      const entry = waiters.get(id) ?? { ownerId, arrived: now, seen: now };
      entry.ownerId = ownerId; entry.seen = now; waiters.set(id, entry);
      if (holders.size >= options.capacity) return refuse();
      const rank = (e: { ownerId: string; arrived: number }) => [lastGrant.get(e.ownerId) ?? -1, e.arrived];
      const [first] = [...waiters.entries()].sort(([, x], [, y]) => {
        const [xg, xa] = rank(x); const [yg, ya] = rank(y); return xg - yg || xa - ya; });
      if (first[0] !== id) return refuse();
      waiters.delete(id); holders.set(id, ownerId); lastGrant.set(ownerId, now);
    },
    async release(key) {
      try { await seed(); } catch { return; } // nothing seeded yet: the next read sees this runtime DORMANT
      holders.delete(idOf(key));
    },
  };
}
/** A refused or failed start that left no session frees the slot; an active or uncertain (RECOVERING) pod keeps it. */
export async function releaseIfDormant(ports: Pick<LivePorts, 'store' | 'admission'>, key: LiveKey) {
  const stored = await ports.store.read(key);
  if (!stored || stored.runtime.phase === 'DORMANT') await ports.admission.release(key);
}
