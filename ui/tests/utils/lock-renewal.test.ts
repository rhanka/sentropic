import { describe, expect, it, vi } from 'vitest';
import { createLockRenewal, type LockAcquireResult } from '$lib/utils/lock-renewal';
import type { LockSnapshot } from '$lib/utils/object-lock';

const snapshot = (userId: string): LockSnapshot => ({
  id: 'lock-1',
  workspaceId: 'workspace-a',
  objectType: 'initiative',
  objectId: 'object-a',
  lockedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:01:00.000Z',
  lockedBy: { userId, email: null, displayName: null },
  unlockRequestedAt: null,
  unlockRequestedByUserId: null,
  unlockRequestMessage: null,
});

const held = (userId: string): LockAcquireResult => ({ lock: snapshot(userId), acquired: true });
const conflict = (userId: string): LockAcquireResult => ({ lock: snapshot(userId), acquired: false });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('createLockRenewal', () => {
  it('does not reacquire after an explicit release whose notification was missed', async () => {
    const renewal = createLockRenewal();
    renewal.acquired('object-a', snapshot('user-a'), 'user-a');
    renewal.release();

    // The page still caches the lock as its own (lock_update null was missed): the reconnect
    // ping and the periodic tick both attempt a renewal.
    const acquire = vi.fn(async () => held('user-a'));
    const release = vi.fn(async () => undefined);
    await expect(renewal.renew('object-a', 'user-a', acquire, release)).resolves.toBeNull();
    await expect(renewal.renew('object-a', 'user-a', acquire, release)).resolves.toBeNull();
    expect(acquire).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('ignores and releases again a renewal that was in flight during the explicit release', async () => {
    const renewal = createLockRenewal();
    renewal.acquired('object-a', snapshot('user-a'), 'user-a');
    const pending = deferred<LockAcquireResult>();
    const release = vi.fn(async () => undefined);

    const renewing = renewal.renew('object-a', 'user-a', () => pending.promise, release);
    renewal.release();
    pending.resolve(held('user-a'));

    await expect(renewing).resolves.toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('still recovers a lock cleared server-side while the page intends to hold it', async () => {
    const renewal = createLockRenewal();
    renewal.acquired('object-a', snapshot('user-a'), 'user-a');
    const acquire = vi.fn(async () => held('user-a'));
    const release = vi.fn(async () => undefined);

    await expect(renewal.renew('object-a', 'user-a', acquire, release)).resolves.toEqual(held('user-a'));
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(renewal.hasIntent('object-a')).toBe(true);
  });

  it('re-arms after a new explicit acquisition following a release', async () => {
    const renewal = createLockRenewal();
    renewal.acquired('object-a', snapshot('user-a'), 'user-a');
    renewal.release();
    renewal.acquired('object-a', snapshot('user-a'), 'user-a');
    const acquire = vi.fn(async () => held('user-a'));

    await expect(renewal.renew('object-a', 'user-a', acquire, vi.fn())).resolves.toEqual(held('user-a'));
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('keeps another holder protected: a 409 conflict stops renewal without releasing', async () => {
    const renewal = createLockRenewal();
    renewal.acquired('object-a', snapshot('user-a'), 'user-a');
    const acquire = vi.fn(async () => conflict('user-b'));
    const release = vi.fn(async () => undefined);

    await expect(renewal.renew('object-a', 'user-a', acquire, release)).resolves.toEqual(conflict('user-b'));
    expect(release).not.toHaveBeenCalled();
    expect(renewal.hasIntent('object-a')).toBe(false);
    await expect(renewal.renew('object-a', 'user-a', acquire, release)).resolves.toBeNull();
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('never arms for a lock held by another user', () => {
    const renewal = createLockRenewal();
    renewal.acquired('object-a', snapshot('user-b'), 'user-a');
    expect(renewal.hasIntent('object-a')).toBe(false);
    renewal.observed('object-a', null, snapshot('user-b'), 'user-a');
    expect(renewal.hasIntent('object-a')).toBe(false);
  });

  it('arms on an unlock hand-over but not on a stale update of the released lock', () => {
    const renewal = createLockRenewal();
    renewal.observed('object-a', snapshot('user-b'), snapshot('user-a'), 'user-a');
    expect(renewal.hasIntent('object-a')).toBe(true);

    renewal.release();
    renewal.observed('object-a', snapshot('user-a'), snapshot('user-a'), 'user-a');
    expect(renewal.hasIntent('object-a')).toBe(false);
  });

  it('does not renew or release a different target', async () => {
    const renewal = createLockRenewal();
    renewal.acquired('object-a', snapshot('user-a'), 'user-a');
    const acquire = vi.fn(async () => held('user-a'));
    await expect(renewal.renew('object-b', 'user-a', acquire, vi.fn())).resolves.toBeNull();
    expect(acquire).not.toHaveBeenCalled();
  });
});
