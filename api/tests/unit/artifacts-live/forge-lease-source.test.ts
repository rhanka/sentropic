import { describe, expect, it } from 'vitest';
import { STAGING } from '../../../src/services/artifacts/live/forge-lease';
import { key } from './fixture';
import { failure, HEAD, REPO, setup, tarball } from './forge-fixture';

describe('lease forge reads: source() re-verification (contract §4)', () => {
  it('should re-download and refuse unstable_tree when one byte differs from the manifest', async () => {
    const s = await setup(); const snap = await s.reads.snapshot(key, HEAD);
    s.state.archive = tarball(REPO.map(e => (e.path === 'src/main.ts' ? { ...e, data: 'export {}!' } : e)));
    expect(await failure(s.reads.source(snap.stagingRef))).toMatchObject({ code: 'unstable_tree' });
  });
  it('should refuse an unknown, evicted or expired stagingRef as builder_unavailable', async () => {
    const s = await setup(); const first = await s.reads.snapshot(key, HEAD);
    expect(await failure(s.reads.source('unknown'))).toMatchObject({ code: 'builder_unavailable' });
    for (let i = 0; i < STAGING.entries; i++) await s.reads.snapshot(key, HEAD);
    expect(await failure(s.reads.source(first.stagingRef))).toMatchObject({ code: 'builder_unavailable' });
    const last = await s.reads.snapshot(key, HEAD); s.advance(STAGING.ttlMs);
    expect(await failure(s.reads.source(last.stagingRef))).toMatchObject({ code: 'builder_unavailable' });
  });
});

describe('lease forge reads: lease hygiene (contract §3)', () => {
  it('should issue only GET requests and never expose the token in an error or a returned value', async () => {
    const s = await setup({ compare: { [HEAD]: 'identical' } });
    const results = [await s.reads.head(key), await s.reads.reachable(key, HEAD), await s.reads.snapshot(key, HEAD)];
    results.push(await s.reads.source((results[2] as { stagingRef: string }).stagingRef));
    s.fetch.mockRejectedValueOnce(new Error('connect failed https://codeload.github.com/x?token=CODELOAD_SECRET ghs_lease_secret_1'));
    const error = await failure(s.reads.head(key));
    expect(error).toMatchObject({ code: 'builder_unavailable' }); expect(error.cause).toBeUndefined();
    expect(s.calls.every(c => c.init.method === 'GET' && c.init.redirect === 'manual')).toBe(true);
    const visible = JSON.stringify([results, error.message, String(error.stack), Object.entries(error)]);
    expect(visible).not.toContain('ghs_lease_secret'); expect(visible).not.toContain('CODELOAD_SECRET');
    expect(s.calls[0]!.init.headers).toMatchObject({ accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' });
  });
  it('should cache the lease until 60 s before expiry and drop it on an invalidation event and on 401', async () => {
    const s = await setup();
    await s.reads.head(key); await s.reads.head(key); expect(s.acquire).toHaveBeenCalledTimes(1);
    expect(s.acquire).toHaveBeenCalledWith({ storageScopeId: key.storageScopeId, repoId: 'repo-immo',
      installationRef: 'enroll_0123abcd-0000-4000-8000-000000000001' });
    s.advance(3_600_000 - 60_000); await s.reads.head(key); expect(s.acquire).toHaveBeenCalledTimes(2);
    await s.subscribers[0]!({ storageScopeId: key.storageScopeId, repoId: 'repo-immo' });
    await s.reads.head(key); expect(s.acquire).toHaveBeenCalledTimes(3);
    s.state.refused.add('Bearer ghs_lease_secret_3');
    await expect(s.reads.head(key)).resolves.toBe(HEAD); expect(s.acquire).toHaveBeenCalledTimes(4);
    s.state.refused.add('Bearer ghs_lease_secret_4'); s.state.refused.add('Bearer ghs_lease_secret_5');
    expect(await failure(s.reads.head(key))).toMatchObject({ code: 'builder_unavailable' });
  });
});

describe('lease forge reads: fail-closed configuration (contract §2)', () => {
  it('should refuse every read forge_unconfigured without a configuration or a recorded binding', async () => {
    for (const s of [await setup({ config: false }), await setup({ record: false })]) {
      for (const read of [s.reads.head(key), s.reads.reachable(key, HEAD), s.reads.snapshot(key, HEAD)]) {
        expect(await failure(read)).toMatchObject({ code: 'builder_unavailable', reason: 'forge_unconfigured' });
      }
      expect(s.fetch).not.toHaveBeenCalled(); expect(s.acquire).not.toHaveBeenCalled();
    }
  });
});
