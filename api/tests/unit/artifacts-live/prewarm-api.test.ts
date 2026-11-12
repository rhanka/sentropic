import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { cacheKeyOf } from '../../../src/services/artifacts/live/cache';
import { createCacheJobs, createHostCacheApi } from '../../../src/services/artifacts/live/cache-api';
import type { KvStore } from '../../../src/services/artifacts/live/cache-storage';
import { sha256 } from '../../../src/services/artifacts/live/integrity';
import { BUILDER_IMAGE } from '../../../src/services/artifacts/live/recipes';
import { LiveError } from '../../../src/services/artifacts/live/records';
import type { SourceSnapshot } from '../../../src/services/artifacts/live/ports';

function fakeStore(): KvStore {
  const rows = new Map<string, unknown>();
  return {
    read: async key => rows.get(key) as never,
    update: async (key, change) => {
      const { next, result } = change(rows.get(key) as never);
      if (next !== undefined) rows.set(key, next);
      return result;
    },
  };
}
const base = { scope: 'scope', cacheKey: `${'a'.repeat(64)}/${'b'.repeat(64)}`, lockSha256: 'a'.repeat(64),
  refKind: 'branch' as const, branch: 'main', installWorkspaces: [], prebundle: true };

describe('prewarm job ledger', () => {
  it('should admit one building job and join repeats idempotently', async () => {
    let now = 1_000; let ids = 0;
    const jobs = createCacheJobs(fakeStore(), { now: () => now, id: () => `job-${++ids}` });
    const first = await jobs.ensure({ ...base, idempotencyKey: 'trigger-1' });
    expect(first.created).toBe(true);
    expect(first.record).toMatchObject({ state: 'building', step: 'queued', attempts: 1 });
    const joined = await jobs.ensure({ ...base, idempotencyKey: 'trigger-1-retry' });
    expect(joined.created).toBe(false);
    expect(joined.record.jobId).toBe(first.record.jobId);
    expect(joined.record.attempts).toBe(1);
    expect(await jobs.heartbeat(first.record.cacheKey, first.record.jobId, 'tarball_fetch')).toBe(true);
    expect(await jobs.heartbeat(first.record.cacheKey, 'other', 'tarball_fetch')).toBe(false);
  });
  it('should alias identity variants and poll them exactly', async () => {
    const jobs = createCacheJobs(fakeStore(), { now: () => 1_000, id: () => 'job-1' });
    const ensured = await jobs.ensure(base);
    await jobs.alias({ scope: 'scope', repoId: 'repo', subPath: 'ui', lockSha256: base.lockSha256,
      installWorkspaces: [], cacheKey: ensured.record.cacheKey });
    const entries = await jobs.readVariant({ scope: 'scope', repoId: 'repo', subPath: 'ui',
      lockSha256: base.lockSha256, installWorkspaces: [] });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ cacheKey: ensured.record.cacheKey, state: 'building', jobId: 'job-1' });
    expect(await jobs.readVariant({ scope: 'scope', repoId: 'repo', subPath: 'other',
      lockSha256: base.lockSha256, installWorkspaces: [] })).toEqual([]);
    expect(await jobs.readEntry('missing')).toBeUndefined();
  });
  it('should complete only with the current job token and keep sealed joins cheap', async () => {
    const jobs = createCacheJobs(fakeStore(), { now: () => 2_000, id: () => 'job-1' });
    const ensured = await jobs.ensure(base);
    expect(await jobs.completeSeal(ensured.record.cacheKey, 'stale', { treeSha256: 't'.repeat(64), files: 3, bytes: 9 }))
      .toBeUndefined();
    const sealed = await jobs.completeSeal(ensured.record.cacheKey, 'job-1',
      { treeSha256: 't'.repeat(64), files: 3, bytes: 9 });
    expect(sealed).toMatchObject({ state: 'sealed', jobId: 'job-1',
      sealed: { treeSha256: 't'.repeat(64), files: 3, bytes: 9, sealedAt: 2_000 } });
    const again = await jobs.ensure(base);
    expect(again.created).toBe(false);
    expect(again.record.state).toBe('sealed');
  });
  it('should fail with the typed code and readmit on the next trigger', async () => {
    let ids = 0;
    const jobs = createCacheJobs(fakeStore(), { now: () => 3_000, id: () => `job-${++ids}` });
    const ensured = await jobs.ensure(base);
    expect(await jobs.fail(ensured.record.cacheKey, 'stale', 'builder_unavailable', 'phase_timeout:seal:recipe'))
      .toBeUndefined();
    const failed = await jobs.fail(ensured.record.cacheKey, ensured.record.jobId, 'builder_unavailable',
      'phase_timeout:seal:recipe');
    expect(failed).toMatchObject({ state: 'failed',
      error: { code: 'builder_unavailable', reason: 'phase_timeout:seal:recipe' } });
    const readmitted = await jobs.ensure(base);
    expect(readmitted.created).toBe(true);
    expect(readmitted.record.attempts).toBe(2);
  });
  it('should retake a building job whose heartbeat went stale', async () => {
    let now = 0; let ids = 0;
    const jobs = createCacheJobs(fakeStore(), { now: () => now, id: () => `job-${++ids}`, staleMs: 1_000 });
    const first = await jobs.ensure(base);
    now = 5_000;
    const retaken = await jobs.ensure(base);
    expect(retaken.created).toBe(true);
    expect(retaken.record.jobId).not.toBe(first.record.jobId);
    expect(await jobs.heartbeat(first.record.cacheKey, first.record.jobId, 'recipe')).toBe(false);
  });
});

describe('prewarm HTTP contract', () => {
  const HEAD = 'b'.repeat(40);
  function snapshotFixture() {
    const bytes = Buffer.from('qualified tarball');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const manifest = { name: 'fixture', version: '1.0.0', scripts: { 'build:artifact': 'vite build' } };
    const lock = { lockfileVersion: 3, packages: { '': manifest,
      'node_modules/pkg': { version: '1.0.0', resolved: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz', integrity } } };
    const lockText = JSON.stringify(lock); const lockfile = Buffer.from(lockText);
    const qualification = JSON.stringify({ v: 1, lockSha256: sha256(lockText), postinstallAllowlist: [],
      scriptQualification: [] });
    const gb1 = { subPath: 'ui', files: { 'sentropic.artifact.json': JSON.stringify({ version: 1 }),
      'package.json': JSON.stringify(manifest), 'package-lock.json': lockText } };
    const cacheIdentity = { storageScopeId: 'scope', repoId: 'repo', lockSha256: sha256(lockfile),
      platform: 'linux/amd64', nodeVersion: '24', npmVersion: '11', image: BUILDER_IMAGE, policyRevision: 'p1',
      workspaceTopology: 'topo', integrityDigest: sha256(qualification), installWorkspaces: [] as string[] };
    const source: SourceSnapshot = { headSha: HEAD, treeSha: 'c'.repeat(40), lockfile, cacheIdentity,
      stagingRef: 'ref', gb1 };
    return { source, lockSha256: sha256(lockfile) };
  }
  function harness(execute?: (job: never, source: SourceSnapshot) => Promise<never>) {
    const scheduled: Array<() => Promise<void>> = [];
    let ids = 0;
    const jobs = createCacheJobs(fakeStore(), { now: () => 1_000, id: () => `job-${++ids}` });
    const { source } = snapshotFixture();
    const app = createHostCacheApi({ authenticate: () => ({ hostId: 'immo', storageScopeId: 'scope' }), jobs,
      snapshotRepo: async () => source,
      executor: { execute: execute as never ?? (async () => ({ treeSha256: 't'.repeat(64), inventory: [{ path: 'p' }],
        archive: { ref: 'r', sha256: 's'.repeat(64), bytes: 10 } })) as never },
      schedule: work => { scheduled.push(work); } });
    return { app, jobs, scheduled, source };
  }
  const binding = { repoId: 'repo', branch: 'main', subPath: 'ui' };
  const body = (lockSha256: string, extra: Record<string, unknown> = {}) => ({ binding, commitSha: HEAD,
    refKind: 'branch', lockSha256, ...extra });
  const post = (app: ReturnType<typeof createHostCacheApi>, payload: unknown) =>
    app.request('/v1/cache/prewarm', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  it('should refuse closed-body violations, malformed SHAs and bad option shapes', async () => {
    const { app, source } = harness();
    const lockSha256 = sha256(source.lockfile);
    for (const payload of [{ ...body(lockSha256), extra: 1 }, { ...body(lockSha256), refKind: 'latest' },
      { ...body(lockSha256), commitSha: 'b'.repeat(39) }, { ...body('z'.repeat(64)) },
      body(lockSha256, { installWorkspaces: [] }), body(lockSha256, { installWorkspaces: ['..'] }),
      body(lockSha256, { prebundle: 'yes' }), body(lockSha256, { idempotencyKey: '' }),
      body(lockSha256, { idempotencyKey: 'x'.repeat(129) })]) {
      const res = await post(app, payload);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request' });
    }
    const invalid = await post(app, 'not json');
    expect(invalid.status).toBe(400);
  });
  it('should refuse a forge failure with the typed refusal', async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const jobs = createCacheJobs(fakeStore(), { now: () => 1_000, id: () => 'job-1' });
    const app = createHostCacheApi({ authenticate: () => ({ hostId: 'immo', storageScopeId: 'scope' }), jobs,
      snapshotRepo: async () => { throw new LiveError('git_repo_not_registered'); },
      executor: { execute: async () => { throw new Error('unreached'); } },
      schedule: work => { scheduled.push(work); } });
    const { lockSha256 } = snapshotFixture();
    const res = await post(app, body(lockSha256));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'git_repo_not_registered' });
    expect(scheduled).toHaveLength(0);
  });
  it('should verify the pinned lockfile and the workspace assertion (lock_mismatch)', async () => {
    const { app, source } = harness();
    const wrong = await post(app, body('d'.repeat(64)));
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toEqual({ error: 'lock_mismatch', reason: 'lockfile_mismatch' });
    const mismatch = await post(app, body(sha256(source.lockfile), { installWorkspaces: ['ui'] }));
    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toEqual({ error: 'lock_mismatch', reason: 'install_workspaces_mismatch' });
  });
  it('should run absent->building->sealed with an idempotent join and exact polls', async () => {
    const { app, scheduled, source } = harness();
    const lockSha256 = sha256(source.lockfile);
    const first = await post(app, body(lockSha256, { idempotencyKey: 'trigger-1' }));
    expect(first.status).toBe(202);
    const started = await first.json() as { jobId: string; state: string };
    expect(started.state).toBe('building');
    expect(scheduled).toHaveLength(1);
    const joined = await post(app, body(lockSha256, { idempotencyKey: 'trigger-1-retry' }));
    expect(joined.status).toBe(202);
    expect(((await joined.json()) as { jobId: string }).jobId).toBe(started.jobId);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    const cacheKey = cacheKeyOf(source.cacheIdentity);
    const poll = await app.request(`/v1/cache/by-key?cacheKey=${encodeURIComponent(cacheKey)}`);
    expect(poll.status).toBe(200);
    expect(await poll.json()).toMatchObject({ state: 'sealed', jobId: started.jobId });
    const listed = await app.request(`/v1/cache?lockSha256=${lockSha256}&repoId=repo&subPath=ui`);
    expect(listed.status).toBe(200);
    const { entries } = await listed.json() as { entries: Array<{ state: string; jobId: string }> };
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: 'sealed', jobId: started.jobId });
    const again = await post(app, body(lockSha256));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ state: 'sealed' });
    expect(scheduled).toHaveLength(1);
  });
  it('should land a seal cut as failed and readmit on the next trigger', async () => {
    const execute = vi.fn(async () => { throw new LiveError('builder_unavailable', 'phase_timeout:seal:recipe'); });
    const { app, scheduled, source } = harness(execute as never);
    const lockSha256 = sha256(source.lockfile);
    const first = await post(app, body(lockSha256));
    expect(first.status).toBe(202);
    await scheduled[0]!();
    const listed = await app.request(`/v1/cache?lockSha256=${lockSha256}&repoId=repo&subPath=ui`);
    const { entries } = await listed.json() as { entries: Array<{ state: string; error: unknown }> };
    expect(entries[0]).toMatchObject({ state: 'failed',
      error: { code: 'builder_unavailable', reason: 'phase_timeout:seal:recipe', retriable: true } });
    const readmitted = await post(app, body(lockSha256));
    expect(readmitted.status).toBe(202);
    expect(((await readmitted.json()) as { jobId: string }).jobId).not.toBe(
      ((await first.json()) as { jobId: string }).jobId);
    expect(scheduled).toHaveLength(2);
  });
  it('should validate state poll queries', async () => {
    const { app, source } = harness();
    const lockSha256 = sha256(source.lockfile);
    expect((await app.request(`/v1/cache?lockSha256=${lockSha256}&repoId=repo&subPath=ui&unknown=1`)).status)
      .toBe(400);
    expect((await app.request(`/v1/cache?lockSha256=short&repoId=repo`)).status).toBe(400);
    expect((await app.request(`/v1/cache?lockSha256=${lockSha256}&repoId=repo&subPath=../x`)).status).toBe(400);
    expect((await app.request(`/v1/cache?lockSha256=${lockSha256}&repoId=repo&installWorkspaces=`)).status)
      .toBe(400);
    expect((await app.request('/v1/cache/by-key')).status).toBe(400);
    expect((await app.request('/v1/cache/by-key?cacheKey=nope')).status).toBe(400);
    expect((await app.request(`/v1/cache/by-key?cacheKey=${'a'.repeat(64)}/${'b'.repeat(64)}`)).status).toBe(404);
    const empty = await app.request(`/v1/cache?lockSha256=${lockSha256}&repoId=repo&subPath=ui`);
    expect(await empty.json()).toEqual({ entries: [] });
  });
  it('should isolate by-key reads by storage scope (no cross-tenant leak)', async () => {
    const { app, scheduled, source, jobs } = harness();
    const lockSha256 = sha256(source.lockfile);
    const first = await post(app, body(lockSha256));
    expect(first.status).toBe(202);
    await scheduled[0]!();
    const cacheKey = cacheKeyOf(source.cacheIdentity);
    const own = await app.request(`/v1/cache/by-key?cacheKey=${encodeURIComponent(cacheKey)}`);
    expect(own.status).toBe(200);
    const otherApp = createHostCacheApi({ authenticate: () => ({ hostId: 'immo', storageScopeId: 'other' }), jobs,
      snapshotRepo: async () => source,
      executor: { execute: async () => ({ treeSha256: 't'.repeat(64), inventory: [], archive: { ref: 'r', sha256: 's'.repeat(64), bytes: 1 } }) as never },
      schedule: () => undefined });
    const leaked = await otherApp.request(`/v1/cache/by-key?cacheKey=${encodeURIComponent(cacheKey)}`);
    expect(leaked.status).toBe(404);
    expect(await leaked.json()).toEqual({ error: 'not_found' });
  });
  it('should list workspace variants without installWorkspaces and carry retriable on failure', async () => {
    const { app, scheduled, source } = harness();
    const lockSha256 = sha256(source.lockfile);
    const first = await post(app, body(lockSha256));
    expect(first.status).toBe(202);
    await scheduled[0]!();
    const all = await app.request(`/v1/cache?lockSha256=${lockSha256}&repoId=repo&subPath=ui`);
    expect(all.status).toBe(200);
    const { entries } = await all.json() as { entries: Array<{ state: string; cacheKey: string }> };
    expect(entries).toHaveLength(1);
    expect(entries[0]!.state).toBe('sealed');
    const exact = await app.request(`/v1/cache?lockSha256=${lockSha256}&repoId=repo&subPath=ui&installWorkspaces=`);
    expect(exact.status).toBe(200);
    expect(((await exact.json()) as { entries: unknown[] }).entries).toHaveLength(1);
  });
});
