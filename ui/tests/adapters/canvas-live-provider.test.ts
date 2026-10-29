import { describe, expect, it, vi } from 'vitest';
import { createCanvasProvider, canvasEditable } from '$lib/adapters/canvas-live/provider';
import type * as ObjectLocks from '$lib/utils/object-lock';
import type { StreamHubEvent } from '@sentropic/chat-ui/client/streamTypes';

function fixture() {
  const lock = { id: 'l', workspaceId: 'w', objectType: 'folder' as const, objectId: 'f', lockedAt: 'now', expiresAt: 'later', lockedBy: { userId: 'a', email: null, displayName: 'Alice' }, unlockRequestedAt: null, unlockRequestedByUserId: null, unlockRequestMessage: null };
  const presence = { users: [{ userId: 'a', email: null, displayName: 'Alice' }, { userId: 'b', email: null, displayName: 'Bob' }], total: 2 };
  const locks = { fetchLock: vi.fn(async () => lock), acquireLock: vi.fn(async () => ({ acquired: true, lock })), releaseLock: vi.fn(async () => {}), requestUnlock: vi.fn(async () => ({ requested: true, lock })), acceptUnlock: vi.fn(async () => ({ accepted: true, lock })), forceUnlock: vi.fn(async () => ({ forced: true })), sendPresence: vi.fn(async () => presence), fetchPresence: vi.fn(async () => presence), leavePresence: vi.fn(async () => {}) };
  const handlers = new Map<string, (event: StreamHubEvent) => void>();
  const stream = { set: vi.fn((key: string, handler: (event: StreamHubEvent) => void) => { handlers.set(key, handler); }), delete: vi.fn((key: string) => { handlers.delete(key); }) };
  const onError = vi.fn();
  const provider = createCanvasProvider({ scopeRef: 'folder:f', objectType: 'folder', objectId: 'f', currentActorId: 'a', locks: locks as unknown as typeof ObjectLocks, stream, onError });
  return { provider, locks, lock, presence, stream, handlers, onError, unit: { scopeRef: 'folder:f', unitRef: 'description' } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
describe('canvas collaboration provider', () => {
  it('should adapt all lock operations to the existing object-lock API', async () => {
    const f = fixture();
    expect(await f.provider.acquireLock(f.unit)).toMatchObject({ acquired: true, lock: { unit: f.unit, holder: { actorId: 'a', displayLabel: 'Alice' }, expiresAt: 'later' } });
    expect(await f.provider.refreshLock(f.unit)).toMatchObject({ holder: { actorId: 'a' } });
    await f.provider.releaseLock(f.unit); await f.provider.requestUnlock(f.unit); await f.provider.acceptUnlock(f.unit); await f.provider.forceUnlock(f.unit);
    expect(f.locks.acquireLock).toHaveBeenCalledTimes(2);
    for (const method of ['acquireLock', 'releaseLock', 'requestUnlock', 'acceptUnlock', 'forceUnlock'] as const) expect(f.locks[method]).toHaveBeenCalledWith('folder', 'f');
  });
  it('should exclude self from presence actors while preserving the total and support leave', async () => {
    const f = fixture();
    expect(await f.provider.recordPresence('folder:f')).toMatchObject({ scopeRef: 'folder:f', actors: [{ actorId: 'b' }], total: 2 });
    await f.provider.leavePresence('folder:f'); expect(f.locks.leavePresence).toHaveBeenCalledWith('folder', 'f');
  });
  it('should re-read authoritative locks and presence on SSE changes and stream recovery pings, then unsubscribe', async () => {
    const f = fixture(); const lock = vi.fn(); const presence = vi.fn();
    const stopLock = f.provider.subscribeLock(f.unit, lock); const stopPresence = f.provider.subscribePresence('folder:f', presence);
    await flush(); expect(lock).toHaveBeenCalledTimes(1); expect(presence).toHaveBeenCalledTimes(1);
    const emit = (event: StreamHubEvent) => { for (const handler of f.handlers.values()) handler(event); };
    emit({ type: 'lock_update', objectType: 'folder', objectId: 'f', data: { lock: null } } as StreamHubEvent);
    emit({ type: 'presence_update', objectType: 'folder', objectId: 'f', data: {} } as StreamHubEvent);
    await flush(); expect(lock.mock.lastCall![0].holder.actorId).toBe('a'); expect(presence).toHaveBeenCalledTimes(2);
    emit({ type: 'ping', data: {} }); await flush();
    expect(f.locks.fetchLock).toHaveBeenCalledTimes(3); expect(f.locks.fetchPresence).toHaveBeenCalledTimes(3);
    stopLock(); stopPresence(); emit({ type: 'ping', data: {} }); await flush();
    expect(f.handlers.size).toBe(0); expect(f.onError).not.toHaveBeenCalled();
  });
  it('should deny wrong scope without calling the namespace API', async () => {
    const f = fixture();
    await expect(f.provider.acquireLock({ scopeRef: 'foreign' })).rejects.toThrow('scope-denied');
    await expect(f.provider.recordPresence('foreign')).rejects.toThrow('scope-denied');
    expect(() => f.provider.subscribeLock({ scopeRef: 'foreign' }, vi.fn())).toThrow('scope-denied');
    expect(f.locks.acquireLock).not.toHaveBeenCalled(); expect(f.stream.set).not.toHaveBeenCalled();
  });
  it('should apply L0 locks only to controlled fields and keep two admitted L2 actors editable together', () => {
    const lock = { unit: { scopeRef: 'f' }, holder: { actorId: 'other', kind: 'human' as const, displayLabel: 'Other', color: 'transparent' }, expiresAt: null };
    for (const currentActorId of ['human-a', 'agent-b']) {
      const input = { canEdit: true, admitted: true, currentActorId, lock };
      expect(canvasEditable({ ...input, mode: 'controlled' })).toBe(false);
      expect(canvasEditable({ ...input, mode: 'live' })).toBe(true);
      expect(canvasEditable({ ...input, mode: 'live', canEdit: false })).toBe(false);
      expect(canvasEditable({ ...input, mode: 'live', admitted: false })).toBe(false);
    }
  });
});
