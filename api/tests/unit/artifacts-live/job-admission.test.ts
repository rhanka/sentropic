import { describe, expect, it, vi } from 'vitest';
import { fixture, key, memoryRows } from './fixture';
import { LiveError } from '../../../src/services/artifacts/live/records';
import { LiveHostError } from '@sentropic/artifacts/live-host';
import { createRemoteLive } from '../../../src/services/artifacts/live/remote-live';

/** A never-reconciled binding whose view is backed by a real remote row, seeded from the admitted job. */
function seededFixture() {
  const f = fixture();
  const live = createRemoteLive(memoryRows());
  vi.mocked(f.ports.binding).mockImplementation(async k => {
    const s = await live.session(k);
    return { ...f.binding, generation: s.generation, ownerId: s.ownerId };
  });
  vi.mocked(f.ports.seedBinding).mockImplementation((k, seed) => live.reconciled(k, seed));
  vi.mocked(f.ports.seedSession).mockImplementation(k => live.session(k).catch(() => undefined));
  return { f, live };
}

describe('builder job admission (M1 pending job)', () => {
  it('resolves the job with the attempt fence of this run and builds that attempt', async () => {
    const f = fixture(); await f.controller.buildOnly(key, 'job-1');
    const [, jobId, fence] = vi.mocked(f.ports.publication.job).mock.calls[0];
    expect(jobId).toBe('job-1'); expect(fence).toMatchObject({ attempt: 1 });
    const [, , attempt, runtime] = vi.mocked(f.ports.publication.commit).mock.calls[0];
    expect({ runId: runtime.sessionId, attempt: attempt.leaseEpoch }).toEqual(fence);
  });
  it.each([
    ['another pending job', { jobId: 'job-2' }],
    ['another binding generation', { generation: 2 }],
  ])('refuses %s before any pod exists and leaves the binding dormant', async (_name, change) => {
    const f = fixture();
    vi.mocked(f.ports.publication.job).mockImplementationOnce(async (_key, jobId) =>
      ({ jobId, generation: 1, headSha: 'A', expectedReleaseId: 'release-B', ...change }));
    await expect(f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ code: 'git_live_conflict', reason: 'job_not_pending' });
    expect(f.core.create).not.toHaveBeenCalled(); expect(f.ports.worker.build).not.toHaveBeenCalled();
    expect((await f.state())?.runtime).toMatchObject({ phase: 'DORMANT', podUid: null, attempt: null });
    await f.controller.buildOnly(key, 'job-1');
    expect(f.published).toEqual(['A']);
  });
  it('records the job binding at job.generation right after resolving the job, before any forge read (R1)', async () => {
    const f = fixture(); await f.controller.buildOnly(key, 'job-1');
    expect(f.ports.jobBinding).toHaveBeenCalledWith(key, 'job-1', 1);
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0]!;
    expect(order(f.ports.publication.job)).toBeLessThan(order(f.ports.jobBinding));
    expect(order(f.ports.jobBinding)).toBeLessThan(order(f.ports.forge.reachable));
    expect(f.published).toEqual(['A']);
  });
  it('seeds the binding view from the admitted job when never reconciled, then builds and publishes', async () => {
    const { f, live } = seededFixture();
    await f.controller.buildOnly(key, 'job-1');
    expect(f.published).toEqual(['A']); expect(f.core.create).toHaveBeenCalled();
    expect(f.events).toEqual(expect.arrayContaining(['checkpoint', 'clean', 'prepare:A', 'build', 'verify']));
    expect(f.ports.seedBinding).toHaveBeenCalledWith(key,
      expect.objectContaining({ generation: 1, ownerId: 'owner' }));
    expect(await live.session(key)).toMatchObject({ generation: 1, ownerId: 'owner' });
    // The run re-resolved the job with the seeded run id, so the host fence still matches.
    const [, , fence] = vi.mocked(f.ports.publication.job).mock.calls[0];
    const [, , attempt, runtime] = vi.mocked(f.ports.publication.commit).mock.calls[0];
    expect({ runId: runtime.sessionId, attempt: attempt.leaseEpoch }).toEqual(fence);
  });
  it('seeds epochs 0 so the host first live session is accepted', async () => {
    const { f, live } = seededFixture();
    await f.controller.buildOnly(key, 'job-1');
    expect(f.published).toEqual(['A']);
    expect(await live.session(key)).toMatchObject({ generation: 1, ownerId: 'owner', leaseEpoch: 0, routeEpoch: 0 });
  });
  it('keeps the fence monotonic on a reconcile after a seeded build', async () => {
    const { f, live } = seededFixture();
    await f.controller.buildOnly(key, 'job-1');
    expect(f.published).toEqual(['A']);
    // A later live reconcile at the same generation with another owner stays stale, even at low counters.
    await expect(live.reconciled(key, { generation: 1, ownerId: 'intruder',
      liveSessionId: 'live-1', leaseEpoch: 1, routeEpoch: 1 }))
      .rejects.toMatchObject({ code: 'git_live_conflict', reason: 'stale_session' });
    // The host's first live session at (lease 1, route 1) is accepted (the live session takes over).
    await expect(live.reconciled(key, { generation: 1, ownerId: 'owner',
      liveSessionId: 'live-1', leaseEpoch: 1, routeEpoch: 1 }))
      .resolves.toMatchObject({ liveSessionId: 'live-1' });
    // A replay with lower counters stays stale.
    await expect(live.reconciled(key, { generation: 1, ownerId: 'owner',
      liveSessionId: 'live-1', leaseEpoch: 0, routeEpoch: 0 }))
      .rejects.toMatchObject({ code: 'git_live_conflict', reason: 'stale_session' });
  });
  it('reuses the frozen host fence when admission refuses the first seeded attempt', async () => {
    const { f } = seededFixture();
    vi.spyOn(f.ports.admission, 'acquire').mockRejectedValueOnce(new LiveError('builder_unavailable', 'queued'));
    await expect(f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ reason: 'queued' });
    // A refusal writes no runtime state: the retry re-resolves with the identical fence, never job_not_pending.
    expect(await f.state()).toBeUndefined();
    await f.controller.buildOnly(key, 'job-1');
    expect(f.published).toEqual(['A']);
    const fences = vi.mocked(f.ports.publication.job).mock.calls.map(([, , fence]) => fence);
    expect(fences).toHaveLength(2); expect(fences[1]).toEqual(fences[0]); expect(fences[0]).toMatchObject({ attempt: 1 });
  });
  it('reuses the frozen host fence when the draft read fails on the first seeded attempt', async () => {
    const { f } = seededFixture();
    vi.mocked(f.ports.drafts.current).mockRejectedValueOnce(new LiveError('git_live_draft_conflict'));
    await expect(f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ code: 'git_live_draft_conflict' });
    expect(await f.state()).toBeUndefined();
    await f.controller.buildOnly(key, 'job-1');
    expect(f.published).toEqual(['A']);
    const fences = vi.mocked(f.ports.publication.job).mock.calls.map(([, , fence]) => fence);
    expect(fences).toHaveLength(2); expect(fences[1]).toEqual(fences[0]);
  });
  it('keeps binding_unreconciled when no admitted job exists and writes no phase', async () => {
    const f = fixture();
    vi.mocked(f.ports.binding).mockRejectedValueOnce(new LiveError('git_live_conflict', 'binding_unreconciled'));
    vi.mocked(f.ports.publication.job).mockRejectedValueOnce(new LiveHostError('handoff_mismatch', 'job_not_pending'));
    await expect(f.controller.buildOnly(key, 'job-1')).rejects
      .toMatchObject({ code: 'git_live_conflict', reason: 'binding_unreconciled' });
    expect(f.core.create).not.toHaveBeenCalled(); expect(f.ports.worker.build).not.toHaveBeenCalled();
    expect(f.ports.seedBinding).not.toHaveBeenCalled(); expect(await f.state()).toBeUndefined();
  });
  it('builds a reconciled binding whose host job carries no owner yet', async () => {
    const f = fixture();
    vi.mocked(f.ports.publication.job).mockResolvedValueOnce({ jobId: 'job-1', generation: 1, headSha: 'A',
      expectedReleaseId: 'release-B', ownerId: '' });
    await f.controller.buildOnly(key, 'job-1');
    expect(f.published).toEqual(['A']); expect(f.core.create).toHaveBeenCalled();
  });
  it('keeps binding_unreconciled for an ownerless job when never reconciled', async () => {
    const f = fixture();
    vi.mocked(f.ports.binding).mockRejectedValueOnce(new LiveError('git_live_conflict', 'binding_unreconciled'));
    vi.mocked(f.ports.publication.job).mockResolvedValueOnce({ jobId: 'job-1', generation: 1, headSha: 'A',
      expectedReleaseId: 'release-B', ownerId: '' });
    await expect(f.controller.buildOnly(key, 'job-1')).rejects
      .toMatchObject({ code: 'git_live_conflict', reason: 'binding_unreconciled' });
    expect(f.core.create).not.toHaveBeenCalled(); expect(f.ports.seedBinding).not.toHaveBeenCalled();
    expect(await f.state()).toBeUndefined();
  });
  it('refuses a job without a recordable binding before any forge read or pod', async () => {
    const f = fixture(); vi.mocked(f.ports.jobBinding).mockRejectedValueOnce(new LiveError('binding_conflict'));
    await expect(f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ code: 'binding_conflict' });
    expect(f.ports.forge.reachable).not.toHaveBeenCalled(); expect(f.core.create).not.toHaveBeenCalled();
    expect((await f.state())?.runtime.phase).toBe('DORMANT');
  });
  it('refuses an unreachable job head before any pod exists', async () => {
    const f = fixture(); vi.mocked(f.ports.forge.reachable).mockResolvedValueOnce(false);
    await expect(f.controller.buildOnly(key, 'job-1')).rejects.toMatchObject({ code: 'git_head_moved' });
    expect(f.core.create).not.toHaveBeenCalled();
    expect((await f.state())?.runtime.phase).toBe('DORMANT');
  });
});
