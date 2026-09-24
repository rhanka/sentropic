import { describe, expect, it, vi } from 'vitest';
import { createLockRenewal, type LockAcquireResult } from '$lib/utils/lock-renewal';
import type { LockSnapshot } from '$lib/utils/object-lock';

const snapshot = (
  userId: string,
  options: { id?: string; unlockRequestedBy?: string } = {}
): LockSnapshot => ({
  id: options.id ?? 'lock-1',
  workspaceId: 'workspace-a',
  objectType: 'initiative',
  objectId: 'object-a',
  lockedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:01:00.000Z',
  lockedBy: { userId, email: null, displayName: null },
  unlockRequestedAt: options.unlockRequestedBy ? '2026-01-01T00:00:30.000Z' : null,
  unlockRequestedByUserId: options.unlockRequestedBy ?? null,
  unlockRequestMessage: null,
});

const held = (userId: string, id?: string): LockAcquireResult => ({
  lock: snapshot(userId, { id }),
  acquired: true,
});
const conflict = (userId: string): LockAcquireResult => ({ lock: snapshot(userId), acquired: false });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const KEY = 'object-a';

describe('createLockRenewal', () => {
  it('does not reacquire after an explicit release whose notification was missed', async () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    renewal.release(KEY);

    // The page still caches the lock as its own (lock_update null was missed): the reconnect
    // ping and the periodic tick both attempt a renewal.
    const acquire = vi.fn(async () => held('user-a'));
    const release = vi.fn(async () => undefined);
    await expect(renewal.renew(KEY, 'user-a', acquire, release)).resolves.toBeNull();
    await expect(renewal.renew(KEY, 'user-a', acquire, release)).resolves.toBeNull();
    expect(acquire).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(renewal.autoAcquireAllowed(KEY)).toBe(false);
  });

  it('releases again, by lock id, a renewal that was in flight during the explicit release', async () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    const pending = deferred<LockAcquireResult>();
    const release = vi.fn(async (_lockId: string) => undefined);

    const renewing = renewal.renew(KEY, 'user-a', () => pending.promise, release);
    renewal.release(KEY);
    pending.resolve(held('user-a', 'lock-late'));

    await expect(renewing).resolves.toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('lock-late');
  });

  it('keeps the release across the pending renewal notification (release, own notification, delayed response)', async () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    const pending = deferred<LockAcquireResult>();
    const release = vi.fn(async (_lockId: string) => undefined);
    const renewing = renewal.renew(KEY, 'user-a', () => pending.promise, release);

    renewal.release(KEY);
    renewal.observed(KEY, snapshot('user-a'), null, 'user-a'); // release notification
    renewal.observed(KEY, null, snapshot('user-a', { id: 'lock-late' }), 'user-a'); // pending renewal inserted
    expect(renewal.hasIntent(KEY)).toBe(false);

    pending.resolve(held('user-a', 'lock-late'));
    await expect(renewing).resolves.toBeNull();
    expect(release).toHaveBeenCalledWith('lock-late');

    // Cleanup notification: the lock is free again, but auto-acquisition stays suppressed.
    renewal.observed(KEY, snapshot('user-a', { id: 'lock-late' }), null, 'user-a');
    expect(renewal.autoAcquireAllowed(KEY)).toBe(false);
    const acquire = vi.fn(async () => held('user-a'));
    await expect(renewal.renew(KEY, 'user-a', acquire, release)).resolves.toBeNull();
    expect(acquire).not.toHaveBeenCalled();
  });

  it('keeps the release when the delayed response precedes its cleanup notification', async () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    const pending = deferred<LockAcquireResult>();
    const release = vi.fn(async (_lockId: string) => undefined);
    const renewing = renewal.renew(KEY, 'user-a', () => pending.promise, release);

    renewal.release(KEY);
    pending.resolve(held('user-a', 'lock-late'));
    await expect(renewing).resolves.toBeNull();
    expect(release).toHaveBeenCalledWith('lock-late');

    renewal.observed(KEY, snapshot('user-a'), snapshot('user-a', { id: 'lock-late' }), 'user-a');
    renewal.observed(KEY, snapshot('user-a', { id: 'lock-late' }), null, 'user-a');
    expect(renewal.hasIntent(KEY)).toBe(false);
    expect(renewal.autoAcquireAllowed(KEY)).toBe(false);
  });

  it('never cleans up after a hand-over: admin releases to another editor, then a delayed response arrives', async () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('admin-a'), 'admin-a');
    const pending = deferred<LockAcquireResult>();
    const release = vi.fn(async (_lockId: string) => undefined);
    const renewing = renewal.renew(KEY, 'admin-a', () => pending.promise, release);

    renewal.release(KEY); // accept-unlock
    renewal.observed(KEY, snapshot('admin-a', { unlockRequestedBy: 'editor-b' }), snapshot('editor-b'), 'admin-a');
    pending.resolve(held('admin-a')); // renewal served before the hand-over, answered late

    await expect(renewing).resolves.toBeNull();
    expect(release).not.toHaveBeenCalled();
    expect(renewal.hasIntent(KEY)).toBe(false);
  });

  it('still recovers a lock cleared server-side while the page intends to hold it', async () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    const acquire = vi.fn(async () => held('user-a'));
    const release = vi.fn(async () => undefined);

    await expect(renewal.renew(KEY, 'user-a', acquire, release)).resolves.toEqual(held('user-a'));
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(renewal.hasIntent(KEY)).toBe(true);
    expect(renewal.autoAcquireAllowed(KEY)).toBe(true);
  });

  it('re-arms and lifts suppression after a new explicit acquisition following a release', async () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    renewal.release(KEY);
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    expect(renewal.autoAcquireAllowed(KEY)).toBe(true);
    const acquire = vi.fn(async () => held('user-a'));

    await expect(renewal.renew(KEY, 'user-a', acquire, vi.fn())).resolves.toEqual(held('user-a'));
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('keeps another holder protected: a 409 conflict stops renewal without releasing', async () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    const acquire = vi.fn(async () => conflict('user-b'));
    const release = vi.fn(async () => undefined);

    await expect(renewal.renew(KEY, 'user-a', acquire, release)).resolves.toEqual(conflict('user-b'));
    expect(release).not.toHaveBeenCalled();
    expect(renewal.hasIntent(KEY)).toBe(false);
    await expect(renewal.renew(KEY, 'user-a', acquire, release)).resolves.toBeNull();
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('never arms for a lock held by another user', () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-b'), 'user-a');
    expect(renewal.hasIntent(KEY)).toBe(false);
    renewal.observed(KEY, null, snapshot('user-b'), 'user-a');
    expect(renewal.hasIntent(KEY)).toBe(false);
  });

  it('arms only on a hand-over this user requested, never on a null-to-own notification', () => {
    const renewal = createLockRenewal();
    renewal.observed(KEY, null, snapshot('user-a'), 'user-a');
    expect(renewal.hasIntent(KEY)).toBe(false);
    renewal.observed(KEY, snapshot('user-b'), snapshot('user-a'), 'user-a');
    expect(renewal.hasIntent(KEY)).toBe(false);

    renewal.observed(KEY, snapshot('user-b', { unlockRequestedBy: 'user-a' }), snapshot('user-a'), 'user-a');
    expect(renewal.hasIntent(KEY)).toBe(true);

    renewal.release(KEY);
    renewal.observed(KEY, snapshot('user-a'), snapshot('user-a'), 'user-a');
    expect(renewal.hasIntent(KEY)).toBe(false);
  });

  it('resumes auto-acquisition once another holder has been observed after the release', () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    renewal.release(KEY);
    renewal.observed(KEY, snapshot('user-a'), null, 'user-a');
    expect(renewal.autoAcquireAllowed(KEY)).toBe(false);
    renewal.observed(KEY, null, snapshot('user-b'), 'user-a');
    expect(renewal.autoAcquireAllowed(KEY)).toBe(true);
  });

  it('does not renew or release a different target', async () => {
    const renewal = createLockRenewal();
    renewal.acquired(KEY, snapshot('user-a'), 'user-a');
    const acquire = vi.fn(async () => held('user-a'));
    await expect(renewal.renew('object-b', 'user-a', acquire, vi.fn())).resolves.toBeNull();
    expect(acquire).not.toHaveBeenCalled();
    renewal.release('object-b');
    expect(renewal.autoAcquireAllowed(KEY)).toBe(true);
  });
});
