import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { runtimeGeneration } from '../../../src/services/artifacts/live/forge-lease';
import type { LiveState } from '../../../src/services/artifacts/live/records';
import { FORGE_LIMITS } from '../../../src/services/artifacts/live/forge-tar';
import { GB1_QUALIFICATION_PATH } from '../../../src/services/artifacts/live/gb1-qualification';
import { BUILDER_IMAGE } from '../../../src/services/artifacts/live/recipes';
import { key } from './fixture';
import { binding, failure, HEAD, QUALIFICATION, REPO, setup, sha256, STAGED, tarball, TOP, TREE } from './forge-fixture';

describe('lease forge reads: head and reachable (contract §4)', () => {
  it('should read the branch head and map a missing branch to git_branch_missing', async () => {
    const s = await setup();
    await expect(s.reads.head(key)).resolves.toBe(HEAD);
    s.state.branches = {};
    expect(await failure(s.reads.head(key))).toMatchObject({ code: 'git_branch_missing' });
  });
  it('should be reachable only when the head is ahead of or identical to the commit', async () => {
    const s = await setup({ compare: { ['1'.repeat(40)]: 'ahead', ['2'.repeat(40)]: 'identical', ['3'.repeat(40)]: 'behind',
      ['4'.repeat(40)]: 'diverged' } });
    expect(await s.reads.reachable(key, '1'.repeat(40))).toBe(true);
    expect(await s.reads.reachable(key, '2'.repeat(40))).toBe(true);
    for (const sha of ['3', '4', '5'].map(c => c.repeat(40))) expect(await s.reads.reachable(key, sha)).toBe(false);
    const before = s.fetch.mock.calls.length;
    expect(await s.reads.reachable(key, 'HEAD')).toBe(false);
    expect(s.fetch.mock.calls.length).toBe(before);
    expect(s.calls.find(c => c.url.includes('/compare/'))?.url).toContain(`/compare/${'1'.repeat(40)}...${HEAD}`);
  });
});

describe('lease forge reads: generation of the reads (R1)', () => {
  it('should read at the runtime generation, without a live session, and fall back to the last reconcile when dormant', async () => {
    let runtime: { generation: number; phase: string } | undefined;
    const session = vi.fn(async (): Promise<{ generation: number }> => { throw new Error('stale_session'); });
    const store = { read: async () => (runtime ? { runtime } as unknown as LiveState : undefined) };
    const s = await setup({ record: false, generation: runtimeGeneration(store, session) });
    const VARIANT = 'b'.repeat(40); s.state.branches['artifact/variant'] = VARIANT;
    expect(await failure(s.reads.head(key))).toMatchObject({ message: 'stale_session' });
    // A build-only run without any reconcile: its runtime and its job binding at the job generation.
    runtime = { generation: 2, phase: 'BUILD_PROVISIONING' }; await s.bindings.admit(key, 2, { ...binding, branch: 'artifact/variant' });
    session.mockClear(); await expect(s.reads.head(key)).resolves.toBe(VARIANT); expect(session).not.toHaveBeenCalled();
    // A reconcile recorded generation 1 with another branch: the runtime at 2 keeps reading its own binding.
    await s.bindings.admit(key, 1, binding); session.mockResolvedValue({ generation: 1 });
    await expect(s.reads.head(key)).resolves.toBe(VARIANT);
    runtime = { generation: 2, phase: 'DORMANT' }; await expect(s.reads.head(key)).resolves.toBe(HEAD);
  });
});

describe('lease forge reads: snapshot (contract §4)', () => {
  it('should stage only filtered regular files under subPath, with GB1 inputs, the commit treeSha and the cache identity', async () => {
    const s = await setup(); const snap = await s.reads.snapshot(key, HEAD);
    expect(snap).toMatchObject({ headSha: HEAD, treeSha: TREE, stagingRef: 'stage-1', gb1: { subPath: '' } });
    const files = await s.reads.source(snap.stagingRef);
    expect(files.map(f => f.path).sort()).toEqual(STAGED);
    expect(files.find(f => f.path === 'bin/run.sh')?.mode).toBe(0o755);
    expect(files.find(f => f.path === 'src/main.ts')?.mode).toBe(0o644);
    expect(Object.keys(snap.gb1.files).sort()).toEqual([GB1_QUALIFICATION_PATH, 'package-lock.json', 'package.json', 'sentropic.artifact.json']);
    expect(Buffer.from(snap.lockfile).toString()).toBe('{"lockfileVersion":3}');
    expect(snap.cacheIdentity).toMatchObject({ storageScopeId: key.storageScopeId, repoId: 'repo-immo', image: BUILDER_IMAGE,
      lockSha256: sha256('{"lockfileVersion":3}'), integrityDigest: sha256(QUALIFICATION) });
    const codeload = s.calls.filter(c => c.url.startsWith('https://codeload.github.com/'));
    expect(codeload.length).toBe(2); expect((codeload[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
  });
  it('should skip symlinks and hard links, and refuse special entries with a named reason', async () => {
    const s = await setup();
    s.state.archive = tarball([...REPO, { path: 'src/link', type: '2', link: '../../etc/passwd' },
      { path: 'src/hard', type: '1', link: `${TOP}/package.json` }]);
    const snap = await s.reads.snapshot(key, HEAD);
    expect((await s.reads.source(snap.stagingRef)).map(f => f.path).sort()).toEqual(STAGED);
    const t = await setup(); t.state.archive = tarball([...REPO, { path: 'src/fifo', type: '6' }]);
    expect(await failure(t.reads.snapshot(key, HEAD))).toMatchObject({ code: 'unstable_tree', reason: 'special_entry' });
  });
  it('should follow one redirect to codeload only', async () => {
    const s = await setup(); s.state.location = 'https://evil.example/archive.tar.gz';
    expect(await failure(s.reads.snapshot(key, HEAD))).toMatchObject({ code: 'builder_unavailable' });
    expect(s.calls.some(c => c.url.startsWith('https://evil.example'))).toBe(false);
  });
  it('should fail closed, never hang, on a malformed or truncated archive', async () => {
    const valid = tarball(REPO);
    const tar = gunzipSync(valid);
    for (const [archive, code] of [[Buffer.from('not a gzip stream'), 'builder_unavailable'],
      [valid.subarray(0, Math.floor(valid.length / 2)), 'builder_unavailable'],
      [gzipSync(tar.subarray(0, tar.length - 1536)), 'unstable_tree']] as const) {
      const s = await setup(); s.state.archive = archive;
      expect(await failure(s.reads.snapshot(key, HEAD))).toMatchObject({ code });
    }
  });
  it('should enforce the file count and per-file limits', async () => {
    const many = await setup();
    many.state.archive = tarball([...REPO, ...Array.from({ length: FORGE_LIMITS.files }, (_, i) => ({ path: `f/${i}` }))]);
    expect(await failure(many.reads.snapshot(key, HEAD))).toMatchObject({ code: 'limit_exceeded' });
    const big = await setup(); big.state.archive = tarball([...REPO, { path: 'big.bin', data: Buffer.alloc(FORGE_LIMITS.fileBytes + 1) }]);
    expect(await failure(big.reads.snapshot(key, HEAD))).toMatchObject({ code: 'limit_exceeded' });
  });
});
