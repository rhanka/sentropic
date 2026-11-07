import { describe, expect, it, vi } from 'vitest';
import { createBuildJobs, RUN_STALE_MS, type BuildJobRecord, type RecordStore } from '../../../src/services/artifacts/live/build-jobs';
import { createHostBuildApi } from '../../../src/services/artifacts/live/host-build-api';
import { LiveError } from '../../../src/services/artifacts/live/records';
import type { HandoffReceipt } from '@sentropic/artifacts/live-host';

function memoryStore(): RecordStore {
  const rows = new Map<string, BuildJobRecord>(); let tail = Promise.resolve();
  return { read: async id => structuredClone(rows.get(id)),
    async update(id, change) {
      const previous = tail; let unlock!: () => void; tail = new Promise(resolve => { unlock = resolve; }); await previous;
      try { const { next, result } = change(structuredClone(rows.get(id))); if (next) rows.set(id, next); return result; } finally { unlock(); }
    } };
}
function setup(build = vi.fn(async () => {})) {
  let now = 0; let n = 0; const background: Promise<void>[] = [];
  const jobs = createBuildJobs(memoryStore(), () => now, () => `token-${++n}`);
  const authenticate = vi.fn(async (request: Request) =>
    request.headers.get('x-test-host') === 'immo' ? { hostId: 'immo', storageScopeId: 'scope-immo' } : null);
  const app = createHostBuildApi({ authenticate, jobs, build, schedule: work => { background.push(work()); } });
  const post = (body: unknown, host = 'immo') => app.request('/v1/builds', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-host': host }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const status = (jobId: string, host = 'immo') => app.request(`/v1/builds/artifact-a/${jobId}`, { headers: { 'x-test-host': host } });
  return { app, jobs, build, post, status, settle: () => Promise.all(background), advance(ms: number) { now += ms; } };
}
const receipt = { nonce: 'n', releaseId: 'release-A' } as unknown as HandoffReceipt;
const k = { storageScopeId: 'scope-immo', artifactId: 'artifact-a' };

describe('host build API (M3-B)', () => {
  it('refuses an unauthenticated host before reading the body', async () => {
    const s = setup(); const response = await s.post({ artifactId: 'artifact-a', jobId: 'job-1' }, 'other');
    expect(response.status).toBe(401); expect(s.build).not.toHaveBeenCalled();
  });
  it('accepts only an artifact and a job id: the scope comes from the host identity, never a caller SHA', async () => {
    const s = setup();
    for (const body of [{ artifactId: 'artifact-a' }, { artifactId: 'artifact-a', jobId: 'job-1', headSha: 'c'.repeat(40) },
      { artifactId: '../x', jobId: 'job-1' }, { artifactId: 'artifact-a', jobId: 'job-1', storageScopeId: 'scope-b' }, 'not json']) {
      expect((await s.post(body)).status).toBe(400);
    }
    expect((await s.post({ artifactId: 'artifact-a', jobId: 'job-1' })).status).toBe(202);
    await s.settle();
    expect(s.build).toHaveBeenCalledWith({ storageScopeId: 'scope-immo', artifactId: 'artifact-a' }, 'job-1');
  });
  it('bounds the request body before parsing', async () => {
    const s = setup(); const response = await s.post({ artifactId: 'artifact-a', jobId: 'job-1', pad: 'x'.repeat(4096) });
    expect(response.status).toBe(413);
  });
  it('runs one build per job; a repeated request joins it and a published job returns its receipt', async () => {
    const s = setup(); let finish!: () => void;
    s.build.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await s.post({ artifactId: 'artifact-a', jobId: 'job-1' });
    const again = await s.post({ artifactId: 'artifact-a', jobId: 'job-1' });
    expect(again.status).toBe(202); expect(await again.json()).toMatchObject({ state: 'accepted' });
    expect(s.build).toHaveBeenCalledTimes(1);
    await s.jobs.record({ storageScopeId: 'scope-immo', artifactId: 'artifact-a' }, { ...receipt, jobId: 'job-1' });
    finish(); await s.settle();
    const done = await s.status('job-1');
    expect(await done.json()).toMatchObject({ jobId: 'job-1', state: 'published', releaseId: 'release-A' });
    expect((await s.post({ artifactId: 'artifact-a', jobId: 'job-1' })).status).toBe(200);
  });
  it('reports a closed failure code on the job, and a failed or stale run can be re-admitted', async () => {
    const s = setup(vi.fn(async () => { throw new LiveError('git_head_moved'); }));
    await s.post({ artifactId: 'artifact-a', jobId: 'job-1' }); await s.settle();
    expect(await (await s.status('job-1')).json()).toMatchObject({ state: 'failed', code: 'git_head_moved' });
    s.build.mockImplementationOnce(() => new Promise<void>(() => {}));
    await s.post({ artifactId: 'artifact-a', jobId: 'job-1' }); expect(s.build).toHaveBeenCalledTimes(2);
    await s.post({ artifactId: 'artifact-a', jobId: 'job-1' }); expect(s.build).toHaveBeenCalledTimes(2);
    s.advance(RUN_STALE_MS); await s.post({ artifactId: 'artifact-a', jobId: 'job-1' }); expect(s.build).toHaveBeenCalledTimes(3);
  });
  it('a stale run cannot overwrite the outcome of the newer run', async () => {
    const s = setup();
    const first = await s.jobs.admit(k, 'job-1'); s.advance(RUN_STALE_MS); const second = await s.jobs.admit(k, 'job-1');
    await s.jobs.fail(k, 'job-1', first.record.token, 'builder_unavailable');
    expect((await s.jobs.read(k, 'job-1'))?.state).toBe('accepted');
    await s.jobs.fail(k, 'job-1', second.record.token, 'builder_unavailable');
    expect((await s.jobs.read(k, 'job-1'))?.state).toBe('failed');
  });
  it('keeps job status scoped to the authenticated host', async () => {
    const s = setup(); await s.post({ artifactId: 'artifact-a', jobId: 'job-1' }); await s.settle();
    expect((await s.status('job-1', 'other')).status).toBe(401);
    expect((await s.status('job-2')).status).toBe(404);
  });
  it('fails a run that ended without publication, so the host can re-admit it', async () => {
    const s = setup(); await s.post({ artifactId: 'artifact-a', jobId: 'job-1' }); await s.settle();
    expect(await (await s.status('job-1')).json()).toMatchObject({ state: 'failed', code: 'git_live_conflict', reason: 'superseded' });
  });
  it('keeps the durable handoff intent and the first receipt of a job', async () => {
    const s = setup(); await s.jobs.admit(k, 'job-1');
    await s.jobs.intend(k, { claims: { jobId: 'job-1' }, signature: 's' } as never);
    expect((await s.jobs.read(k, 'job-1'))?.handoff).toMatchObject({ signature: 's' });
    const first = await s.jobs.record(k, { ...receipt, jobId: 'job-1' });
    expect(await s.jobs.record(k, { ...receipt, jobId: 'job-1', releaseId: 'release-B' })).toEqual(first);
    expect(await s.jobs.read({ ...k, storageScopeId: 'scope-b' }, 'job-1')).toBeUndefined();
  });
});
