import { describe, expect, it } from 'vitest';
import { createCacheJobs } from '../../../src/services/artifacts/live/cache-api';
import type { KvStore } from '../../../src/services/artifacts/live/cache-storage';

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
