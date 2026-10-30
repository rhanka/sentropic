import type * as ObjectLocks from '$lib/utils/object-lock';
import type { StreamHubClient } from '@sentropic/chat-core/runtime/client/streamTypes';
import * as objectLocks from '$lib/utils/object-lock';
import { streamHub } from '$lib/stores/streamHub';

// Host preparation boundary. Published CL-1M imports/type conformance are gated in H3.
export interface Actor { actorId: string; kind: 'human' | 'agent' | 'nhi'; displayLabel: string; color: string }
export interface Unit { scopeRef: string; unitRef?: string }
export interface LockState { unit: Unit; holder: Actor | null; expiresAt: string | null; unlockRequestedBy?: Actor | null }
export interface PresenceState { scopeRef: string; actors: readonly Actor[]; total: number }
export interface ProviderOptions {
  scopeRef: string; objectType: ObjectLocks.LockObjectType; objectId: string; currentActorId: string;
  locks: typeof ObjectLocks; stream: Pick<StreamHubClient, 'set' | 'delete'>; onError(error: unknown): void;
}
export function createCanvasProvider(options: ProviderOptions): {
  acquireLock(unit: Unit): Promise<{ acquired: boolean; lock: LockState }>;
  refreshLock(unit: Unit): Promise<LockState>;
  releaseLock(unit: Unit): Promise<void>;
  requestUnlock(unit: Unit): Promise<LockState>;
  acceptUnlock(unit: Unit): Promise<LockState>;
  forceUnlock(unit: Unit): Promise<void>;
  recordPresence(scopeRef: string): Promise<PresenceState>;
  leavePresence(scopeRef: string): Promise<void>;
  subscribeLock(unit: Unit, callback: (state: LockState) => void): () => void;
  subscribePresence(scopeRef: string, callback: (state: PresenceState) => void): () => void;
} {
  const { locks, stream, objectType, objectId, scopeRef, currentActorId } = options;
  const assertScope = (scope: string) => { if (scope !== scopeRef) throw new Error('scope-denied'); };
  const assertUnit = (unit: Unit) => {
    assertScope(unit.scopeRef);
    // Existing L0 locks are object-level. H9 owns element-level claims.
    if (unit.unitRef !== undefined) throw new Error('scope-denied');
  };
  const actor = (id: string, label: string | null): Actor => ({ actorId: id, kind: 'human', displayLabel: label ?? id, color: 'transparent' });
  const lockState = (unit: Unit, lock: ObjectLocks.LockSnapshot | null): LockState => ({
    unit: { scopeRef: unit.scopeRef }, holder: lock ? actor(lock.lockedBy.userId, lock.lockedBy.displayName) : null,
    expiresAt: lock ? new Date(lock.expiresAt).toISOString() : null,
    unlockRequestedBy: lock?.unlockRequestedByUserId ? actor(lock.unlockRequestedByUserId, null) : null,
  });
  const presenceState = (snapshot: Awaited<ReturnType<typeof locks.fetchPresence>>): PresenceState => ({
    scopeRef, total: snapshot.total,
    actors: snapshot.users.filter((user) => user.userId !== currentActorId).map((user) => actor(user.userId, user.displayName)),
  });
  const watch = <T>(type: 'lock_update' | 'presence_update', read: () => Promise<T>, callback: (value: T) => void) => {
    const key = `canvas-live:${++subscriptionId}`; let active = true; let version = 0;
    const refresh = () => {
      const request = ++version;
      void read().then((value) => { if (active && request === version) callback(value); })
        .catch((error: unknown) => { if (active && request === version) options.onError(error); });
    };
    stream.set(key, (event) => {
      const source = event as { objectType?: string; objectId?: string };
      // Every ping revalidates snapshots, including the first ping after SSE recovery.
      if (event.type === 'ping' || (event.type === type && source.objectType === objectType && source.objectId === objectId)) refresh();
    });
    refresh();
    return () => { active = false; ++version; stream.delete(key); };
  };
  return {
    async acquireLock(unit) { assertUnit(unit); const result = await locks.acquireLock(objectType, objectId); return { acquired: result.acquired, lock: lockState(unit, result.lock) }; },
    async refreshLock(unit) {
      assertUnit(unit); const current = await locks.fetchLock(objectType, objectId);
      return lockState(unit, current?.lockedBy.userId === currentActorId ? (await locks.acquireLock(objectType, objectId)).lock : current);
    },
    async releaseLock(unit) { assertUnit(unit); await locks.releaseLock(objectType, objectId); },
    async requestUnlock(unit) { assertUnit(unit); return lockState(unit, (await locks.requestUnlock(objectType, objectId)).lock); },
    async acceptUnlock(unit) { assertUnit(unit); return lockState(unit, (await locks.acceptUnlock(objectType, objectId)).lock); },
    async forceUnlock(unit) { assertUnit(unit); await locks.forceUnlock(objectType, objectId); },
    async recordPresence(scope) { assertScope(scope); return presenceState(await locks.sendPresence(objectType, objectId)); },
    async leavePresence(scope) { assertScope(scope); await locks.leavePresence(objectType, objectId); },
    subscribeLock(unit, callback) { assertUnit(unit); return watch('lock_update', async () => lockState(unit, await locks.fetchLock(objectType, objectId)), callback); },
    subscribePresence(scope, callback) { assertScope(scope); return watch('presence_update', async () => presenceState(await locks.fetchPresence(objectType, objectId)), callback); },
  };
}
let subscriptionId = 0;
export function createObjectLockCanvasProvider(options: Omit<ProviderOptions, 'locks' | 'stream'>) {
  return createCanvasProvider({ ...options, locks: objectLocks, stream: streamHub });
}
export function canvasEditable(input: { mode: 'controlled' | 'live'; canEdit: boolean; admitted: boolean; currentActorId: string; lock: LockState }): boolean {
  return input.canEdit && (input.mode === 'live' ? input.admitted : !input.lock.holder || input.lock.holder.actorId === input.currentActorId);
}
