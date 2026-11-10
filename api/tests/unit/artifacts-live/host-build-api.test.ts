import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { BUILD_ONLY_PHASES, createBuildJobs, jobForgeBinding, runStaleMs, type BuildJobRecord, type RecordStore } from '../../../src/services/artifacts/live/build-jobs';
import { PHASE_DEADLINE_MS } from '../../../src/services/artifacts/live/deadline';
import { createHostBuildApi } from '../../../src/services/artifacts/live/host-build-api';
import { LiveError } from '../../../src/services/artifacts/live/records';
import { createForgeBindings, forgeConfig } from '../../../src/services/artifacts/live/forge-binding';
import { memoryRows } from './fixture';
import { leaseHost, reposEnv, repository, target } from './forge-fixture';
import type { HandoffReceipt } from '@sentropic/artifacts/live-host';

function memoryStore(): RecordStore {
  const rows = new Map<string, BuildJobRecord>(); let tail = Promise.resolve();
  return { read: async id => structuredClone(rows.get(id)),
    async update(id, change) {
      const previous = tail; let unlock!: () => void; tail = new Promise(resolve => { unlock = resolve; }); await previous;
      try { const { next, result } = change(structuredClone(rows.get(id))); if (next) rows.set(id, next); return result; } finally { unlock(); }
    } };
}
/** The host git binding of the artifact (forge-lease-reader contract §1). */
const binding = { repoId: 'repo-immo', branch: 'artifact/demo', subPath: '' };
function setup(build = vi.fn(async () => {}), check = (_key: unknown, _binding: unknown) => {}) {
  let now = 0; let n = 0; const background: Promise<void>[] = [];
  const jobs = createBuildJobs(memoryStore(), () => now, () => `token-${++n}`, STALE);
  const authenticate = vi.fn((c: Context) =>
    c.req.header('x-test-host') === 'immo' ? { hostId: 'immo', storageScopeId: 'scope-immo' } : null);
  const validate = vi.fn(check);
  const app = createHostBuildApi({ authenticate, jobs, build, validate, schedule: work => { background.push(work()); } });
  const post = (body: unknown, host = 'immo') => app.request('/v1/builds', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-host': host }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const status = (jobId: string, host = 'immo') => app.request(`/v1/builds/artifact-a/${jobId}`, { headers: { 'x-test-host': host } });
  return { app, jobs, build, validate, post, status, settle: () => Promise.all(background), advance(ms: number) { now += ms; } };
}
const receipt = { nonce: 'n', releaseId: 'release-A' } as unknown as HandoffReceipt;
const k = { storageScopeId: 'scope-immo', artifactId: 'artifact-a' };
/** Heavy-gate wait of the test composition. */
const HEAVY_WAIT_MS = 60_000;
const STALE = runStaleMs(HEAVY_WAIT_MS);

describe('host build API (M3-B)', () => {
  it('refuses a service client bound to no host before reading the body', async () => {
    const s = setup(); const response = await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding }, 'other');
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'host_not_bound' }); expect(s.build).not.toHaveBeenCalled();
  });
  it('accepts only an artifact and a job id: the scope comes from the host identity, never a caller SHA', async () => {
    const s = setup();
    for (const body of [{ artifactId: 'artifact-a' }, { artifactId: 'artifact-a', jobId: 'job-1', headSha: 'c'.repeat(40) },
      { artifactId: '../x', jobId: 'job-1' }, { artifactId: 'artifact-a', jobId: 'job-1', storageScopeId: 'scope-b' }, 'not json']) {
      expect((await s.post(body)).status).toBe(400);
    }
    expect((await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding })).status).toBe(202);
    await s.settle();
    expect(s.build).toHaveBeenCalledWith({ storageScopeId: 'scope-immo', artifactId: 'artifact-a' }, 'job-1');
  });
  it('requires the closed git binding, validated and stored with the job before scheduling anything', async () => {
    const s = setup();
    for (const body of [{ artifactId: 'artifact-a', jobId: 'job-1' }, { artifactId: 'artifact-a', jobId: 'job-1', binding: {} },
      { artifactId: 'artifact-a', jobId: 'job-1', binding: { ...binding, extra: 1 } },
      { artifactId: 'artifact-a', jobId: 'job-1', binding: { repoId: 'repo-immo', branch: 'artifact/demo' } }]) {
      expect((await s.post(body)).status).toBe(400);
    }
    expect(s.validate).not.toHaveBeenCalled();
    s.validate.mockImplementationOnce(() => { throw new LiveError('git_repo_not_registered'); });
    expect((await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding })).status).toBe(409);
    expect(s.validate).toHaveBeenCalledWith(k, binding); expect(s.build).not.toHaveBeenCalled();
    expect(await s.jobs.read(k, 'job-1')).toBeUndefined();
    expect((await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding })).status).toBe(202);
    const refused = await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding: { ...binding, branch: 'artifact/other' } });
    expect(refused.status).toBe(409); expect(await refused.json()).toEqual({ error: 'binding_conflict' });
    expect((await s.jobs.read(k, 'job-1'))?.binding).toEqual(binding); expect(s.build).toHaveBeenCalledTimes(1);
  });
  it('stores a build binding with its job, never under an older reconcile generation, recorded at the job generation (R1)', async () => {
    const scoped = { storageScopeId: k.storageScopeId };
    const bindings = createForgeBindings(memoryRows(), forgeConfig(reposEnv([{ ...repository, ...scoped }]),
      leaseHost({ targets: [{ ...target, ...scoped }] })));
    const s = setup(undefined, bindings.validate); const variant = { ...binding, branch: 'artifact/variant' };
    await bindings.admit(k, 1, binding);
    expect((await s.post({ artifactId: 'artifact-a', jobId: 'job-2', binding: variant })).status).toBe(202);
    expect(await bindings.read(k, 1)).toEqual(binding); expect(await bindings.read(k, 2)).toBeUndefined();
    const record = jobForgeBinding(s.jobs, bindings);
    await record(k, 'job-2', 2); expect(await bindings.read(k, 2)).toEqual(variant);
    await expect(record(k, 'job-2', 1)).rejects.toMatchObject({ code: 'binding_conflict' });
    await expect(record(k, 'job-9', 3)).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'forge_unconfigured' });
    expect((await s.post({ artifactId: 'artifact-a', jobId: 'job-3', binding: { ...binding, repoId: 'repo-x' } })).status).toBe(409);
    expect(await s.jobs.read(k, 'job-3')).toBeUndefined();
  });
  it('bounds the request body before parsing', async () => {
    const s = setup(); const response = await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding, pad: 'x'.repeat(4096) });
    expect(response.status).toBe(413);
  });
  it('runs one build per job; a repeated request joins it and a published job returns its receipt', async () => {
    const s = setup(); let finish!: () => void;
    s.build.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding });
    const again = await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding });
    expect(again.status).toBe(202); expect(await again.json()).toMatchObject({ state: 'build_pending' });
    expect(s.build).toHaveBeenCalledTimes(1);
    await s.jobs.record({ storageScopeId: 'scope-immo', artifactId: 'artifact-a' }, { ...receipt, jobId: 'job-1' });
    finish(); await s.settle();
    const done = await s.status('job-1');
    expect(await done.json()).toMatchObject({ jobId: 'job-1', state: 'published', releaseId: 'release-A' });
    expect((await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding })).status).toBe(200);
  });
  it('reports a closed failure code on the job, and a failed or stale run can be re-admitted', async () => {
    const s = setup(vi.fn(async () => { throw new LiveError('git_head_moved'); }));
    await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding }); await s.settle();
    expect(await (await s.status('job-1')).json()).toMatchObject({ state: 'build_failed', code: 'git_head_moved' });
    s.build.mockImplementationOnce(() => new Promise<void>(() => {}));
    await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding }); expect(s.build).toHaveBeenCalledTimes(2);
    await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding }); expect(s.build).toHaveBeenCalledTimes(2);
    s.advance(STALE); await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding }); expect(s.build).toHaveBeenCalledTimes(3);
  });
  it('presumes a run dead after two heavy-gate waits and two bounded passes, never after a pod lifetime', async () => {
    expect(BUILD_ONLY_PHASES).toEqual(['install', 'prepare', 'build', 'verify']);
    expect(PHASE_DEADLINE_MS).toBe(300_000);
    expect(runStaleMs(0, 300_000)).toBe(2_400_000);
    expect(runStaleMs(0)).toBe(2 * (1_200_000 + 3 * PHASE_DEADLINE_MS));
    expect(STALE).toBe(2 * (HEAVY_WAIT_MS + 1_200_000 + 3 * PHASE_DEADLINE_MS));
    const s = setup(); await s.jobs.admit(k, 'job-1', binding);
    s.advance(STALE - 1); expect((await s.jobs.admit(k, 'job-1', binding)).run).toBe(false);
    s.advance(1); expect((await s.jobs.admit(k, 'job-1', binding)).run).toBe(true);
  });
  it('a stale run cannot overwrite the outcome of the newer run', async () => {
    const s = setup();
    const first = await s.jobs.admit(k, 'job-1', binding); s.advance(STALE); const second = await s.jobs.admit(k, 'job-1', binding);
    await s.jobs.fail(k, 'job-1', first.record.token, 'builder_unavailable');
    expect((await s.jobs.read(k, 'job-1'))?.state).toBe('accepted');
    await s.jobs.fail(k, 'job-1', second.record.token, 'builder_unavailable');
    expect((await s.jobs.read(k, 'job-1'))?.state).toBe('failed');
  });
  it('keeps job status scoped to the authenticated host', async () => {
    const s = setup(); await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding }); await s.settle();
    expect((await s.status('job-1', 'other')).status).toBe(403);
    expect((await s.status('job-2')).status).toBe(404);
  });
  it('fails a run that ended without publication, so the host can re-admit it', async () => {
    const s = setup(); await s.post({ artifactId: 'artifact-a', jobId: 'job-1', binding }); await s.settle();
    expect(await (await s.status('job-1')).json()).toMatchObject({ state: 'build_failed', code: 'git_live_conflict', reason: 'superseded' });
  });
  it('keeps the durable handoff intent and the first receipt of a job', async () => {
    const s = setup(); await s.jobs.admit(k, 'job-1', binding);
    await s.jobs.intend(k, { claims: { jobId: 'job-1' }, signature: 's' } as never);
    expect((await s.jobs.read(k, 'job-1'))?.handoff).toMatchObject({ signature: 's' });
    const first = await s.jobs.record(k, { ...receipt, jobId: 'job-1' });
    expect(await s.jobs.record(k, { ...receipt, jobId: 'job-1', releaseId: 'release-B' })).toEqual(first);
    expect(await s.jobs.read({ ...k, storageScopeId: 'scope-b' }, 'job-1')).toBeUndefined();
  });
});
