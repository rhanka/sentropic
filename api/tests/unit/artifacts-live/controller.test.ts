import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { publicationBaseline } from '../../../src/services/artifacts/live/records';

describe('artifact live controller', () => {
  it('should project only the current durable draft and ignore exact projection replay', async () => {
    const f = fixture(); const live = await f.controller.start(key); f.draft().revision = 2;
    const projected = await f.controller.project(key, 2);
    expect(projected).toMatchObject({ phase: 'LIVE', sourceRevision: 2, appliedRevision: 2, podUid: live.podUid });
    const count = vi.mocked(f.ports.worker.restore).mock.calls.length;
    await f.controller.project(key, 2); expect(f.ports.worker.restore).toHaveBeenCalledTimes(count);
    await expect(f.controller.project(key, 1)).rejects.toMatchObject({ code: 'git_live_revision_moved' });
  });
  it('should restore the exact durable revision before exposing a route', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    expect(live).toMatchObject({ phase: 'LIVE', sourceRevision: 1, appliedRevision: 1 });
    expect(f.events).toEqual(['checkpoint', 'clean', 'prepare:B', 'restore', 'ready']);
    await expect(f.controller.start(key)).rejects.toMatchObject({ reason: 'transition_busy' });
    expect(f.core.create).toHaveBeenCalledTimes(2); // one pod and its service
  });
  it('should build the last commit in the same pod without restoring the dirty draft', async () => {
    const f = fixture(); await f.controller.start(key); f.events.length = 0;
    f.advance(600_000); await f.controller.idle(key); expect(f.events).toEqual([]);
    f.advance(1); await f.controller.idle(key);
    expect(f.events).toContain('prepare:B'); expect(f.events).toContain('build');
    expect(f.events).not.toContain('restore'); expect(f.published).toEqual([]);
    expect(f.core.create).toHaveBeenCalledTimes(2); expect(f.objects.size).toBe(0);
    expect((await f.state())?.runtime.phase).toBe('DORMANT'); expect(f.draft().dirty).toBe(true);
  });
  it('should exclude heartbeats and status polls from idle activity', async () => {
    const f = fixture(); const live = await f.controller.start(key); f.advance(600_001);
    await f.controller.activity(key, live.sessionId, 'heartbeat'); await f.controller.activity(key, live.sessionId, 'status');
    await f.controller.idle(key); expect(f.ports.worker.build).toHaveBeenCalledOnce();
  });
  it('should honor admitted foreground activity using server time', async () => {
    const f = fixture(); const live = await f.controller.start(key); f.advance(600_001);
    await f.controller.activity(key, live.sessionId, 'foreground'); await f.controller.idle(key);
    expect(f.ports.worker.build).not.toHaveBeenCalled();
  });
  it('should retain a dirty draft and skip idle build on a fast-forward conflict', async () => {
    const f = fixture(); await f.controller.start(key); f.binding.headSha = 'C'; f.advance(600_001);
    await expect(f.controller.idle(key)).rejects.toMatchObject({ code: 'git_live_draft_conflict' });
    expect(f.ports.worker.build).not.toHaveBeenCalled(); expect(f.draft().baseHeadSha).toBe('B');
    expect(f.objects.size).toBe(0);
  });
  it('should reject divergence without losing a draft', async () => {
    const f = fixture(); await f.controller.start(key); f.binding.headSha = 'A'; f.advance(600_001);
    await expect(f.controller.idle(key)).rejects.toMatchObject({ code: 'git_diverged' });
    expect(f.ports.worker.build).not.toHaveBeenCalled(); expect(f.draft().dirty).toBe(true);
  });
  it('should not re-publish B after an explicit historical A publication at head B', async () => {
    const f = fixture(); const live = await f.controller.start(key);
    await f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 });
    await f.ports.store.transaction(key, async unit => { publicationBaseline(unit.state!.progress, 'release-A'); });
    f.binding.releaseId = 'release-A'; f.binding.releaseCommit = 'A';
    await f.controller.start(key); f.advance(600_001); await f.controller.idle(key);
    expect(f.ports.worker.build).toHaveBeenCalledOnce(); expect(f.binding.releaseCommit).toBe('A'); expect(f.published).toEqual([]);
    f.draft().dirty = false; f.binding.headSha = 'C';
    await f.controller.start(key); f.advance(600_001); await f.controller.idle(key);
    expect(f.published).toEqual(['C']); expect((await f.state())?.progress.publicationBaselineSeq).toBe(1);
    await f.controller.start(key); f.advance(600_001); await f.controller.idle(key); expect(f.published).toEqual(['C']);
  });
  it('should build without publication when autoPublish is false', async () => {
    const f = fixture(); f.binding.initialUnpublishedBranchEligible = true; f.binding.autoPublish = false;
    await f.controller.start(key); f.advance(600_001); await f.controller.idle(key);
    expect(f.ports.worker.build).toHaveBeenCalledOnce(); expect(f.published).toEqual([]);
    expect((await f.state())?.progress.initialUnpublishedBranchEligible).toBe(true);
  });
  it('should allow the separately persisted initial branch exception once', async () => {
    const f = fixture(); f.binding.releaseId = null; f.binding.releaseCommit = null; f.binding.initialUnpublishedBranchEligible = true;
    await f.controller.start(key); f.advance(600_001); await f.controller.idle(key);
    expect(f.published).toEqual(['B']); expect((await f.state())?.progress.initialUnpublishedBranchEligible).toBe(false);
  });
  it('should keep eligibility on a losing release CAS', async () => {
    const f = fixture(); f.binding.initialUnpublishedBranchEligible = true; f.binding.releaseCommit = 'A';
    await f.controller.start(key); f.ports.worker.verify = vi.fn(async () => { f.binding.releaseId = 'other'; });
    f.advance(600_001); await expect(f.controller.idle(key)).rejects.toMatchObject({ code: 'pointer_conflict' });
    expect(f.published).toEqual([]); expect((await f.state())?.progress.initialUnpublishedBranchEligible).toBe(true);
  });
  it('should teardown after revocation without returning source metadata', async () => {
    const f = fixture(); const live = await f.controller.start(key); f.binding.healthy = false;
    expect(await f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 }))
      .toEqual({ liveSessionId: live.sessionId, state: 'stopped' });
    expect(f.ports.worker.build).not.toHaveBeenCalled(); expect(f.objects.size).toBe(0);
  });
});
