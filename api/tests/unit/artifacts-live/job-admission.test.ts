import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { LiveError } from '../../../src/services/artifacts/live/records';

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
