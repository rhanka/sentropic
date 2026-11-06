import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
describe('live crash and wake fences', () => {
  it('should cancel an idle build before restoring the saved draft in the same pod', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    const entered = deferred<void>(); const output = deferred<{ candidateDigest: string }>();
    f.ports.worker.build = vi.fn(async () => { entered.resolve(); return output.promise; });
    f.advance(600_001); const idle = f.controller.idle(key); await entered.promise;
    await f.controller.wake(key); output.resolve({ candidateDigest: 'stale' }); await idle;
    expect((await f.state())?.runtime).toMatchObject({ phase: 'LIVE', podUid: live.podUid });
    expect(f.core.create).toHaveBeenCalledTimes(2); expect(f.published).toEqual([]);
    expect(f.ports.worker.restore).toHaveBeenCalledTimes(2);
  });
  it('should retain a committed release when publication wins before wake', async () => {
    const f = fixture(); f.binding.releaseCommit = 'A'; f.binding.initialUnpublishedBranchEligible = true;
    await f.controller.start(key);
    const entered = deferred<void>(); const release = deferred<void>();
    const commit = f.ports.publication.commit;
    f.ports.publication.commit = vi.fn(async (...args) => { entered.resolve(); await release.promise; return commit(...args); });
    f.advance(600_001); const idle = f.controller.idle(key); await entered.promise;
    const wake = f.controller.wake(key); release.resolve(); await Promise.all([idle, wake]);
    expect(f.published).toEqual(['B']); expect((await f.state())?.runtime.phase).toBe('LIVE');
    expect((await f.state())?.progress.initialUnpublishedBranchEligible).toBe(false);
  });
  it('should fence a candidate if head moves during build', async () => {
    const f = fixture(); f.binding.initialUnpublishedBranchEligible = true;
    await f.controller.start(key); f.ports.worker.verify = vi.fn(async () => { f.binding.headSha = 'C'; });
    f.advance(600_001); await expect(f.controller.idle(key)).rejects.toMatchObject({ code: 'git_head_moved' });
    expect(f.published).toEqual([]); expect(f.draft().baseHeadSha).toBe('B');
  });
  it('should block a replacement while old pod termination is uncertain', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    f.core.waitDeleted = vi.fn(async () => { throw new Error('unconfirmed'); });
    await expect(f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 })).rejects.toThrow();
    expect((await f.state())?.runtime.phase).toBe('RECOVERING');
    await expect(f.controller.start(key)).rejects.toMatchObject({ reason: 'transition_busy' });
    expect(f.core.create).toHaveBeenCalledTimes(2);
  });
  it('should reconcile interrupted preparation without claiming build success', async () => {
    const f = fixture(); await f.controller.start(key);
    await f.ports.store.transaction(key, async unit => { unit.state!.runtime.phase = 'BUILDING'; });
    await f.controller.recover(key);
    expect(f.objects.size).toBe(0); expect((await f.state())?.runtime.phase).toBe('DORMANT');
    expect(f.published).toEqual([]); expect(f.draft().dirty).toBe(true);
  });
  it('should preserve the draft if the durable checkpoint is unavailable', async () => {
    const f = fixture(); await f.controller.start(key);
    f.ports.drafts.checkpoint = vi.fn(async () => { throw new Error('store unavailable'); }); f.advance(600_001);
    await expect(f.controller.idle(key)).rejects.toThrow();
    expect(f.objects.size).toBe(2); expect((await f.state())?.runtime.phase).toBe('RECOVERING');
    expect(f.ports.worker.build).not.toHaveBeenCalled();
  });
  it('should reap the absolute lifetime without publishing an active session', async () => {
    const f = fixture(); const live = await f.controller.start(key); f.advance(3_500_000);
    await f.controller.activity(key, live.sessionId, 'read'); f.advance(100_000); await f.controller.reap(key);
    expect(f.objects.size).toBe(0); expect(f.ports.worker.build).not.toHaveBeenCalled();
  });
});
