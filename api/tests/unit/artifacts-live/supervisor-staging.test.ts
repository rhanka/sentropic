import { describe, expect, it } from 'vitest';
import { artifactEnvironment, BUILD_RECIPE, buildEnvironment } from '../../../src/services/artifacts/live/recipes';
import { candidateDigest } from '@sentropic/artifacts/live-host';
import { LiveError } from '../../../src/services/artifacts/live/records';
import { DIST, fakePod, runtime, text } from './supervisor-pod';

const unavailable = { code: 'builder_unavailable' };
const source = { headSha: 'h', treeSha: 't', lockfile: Buffer.from('{"lockfileVersion":3}'), cacheIdentity: {} as never, stagingRef: 'ref-h' };
const cache = { key: 'k', treeSha256: 'f'.repeat(64) } as never;
const limits = { files: 255, fileBytes: 16777216, totalBytes: 67108864 } as const;
const attempt = { id: 'att-1', headSha: 'h', treeSha: 't' } as never;

describe('supervisor staging and projection', () => {
  it('should push the trusted staged tree, never a reference the pod would fetch, and require its digest', async () => {
    const pod = fakePod();
    await pod.supervisor.stage(runtime, source);
    expect(pod.sources.source).toHaveBeenCalledWith('ref-h');
    expect(pod.ops()).toEqual(['put', 'stage']);
    const commit = pod.bodies[1].args;
    expect(commit).toMatchObject({ headSha: 'h', treeSha: 't', transfer: pod.bodies[0].args.transfer });
    expect(JSON.stringify(commit)).not.toContain('ref-h');
    expect(pod.received(String(commit.transfer)).map(f => f.path)).toEqual(['package-lock.json', 'ui/main.ts']);
    await expect(pod.supervisor.stage(runtime, { ...source, lockfile: Buffer.from('{}') })).rejects.toMatchObject(unavailable);
    const wrong = fakePod({ stage: () => ({ treeDigest: 'e'.repeat(64) }) });
    await expect(wrong.supervisor.stage(runtime, source)).rejects.toMatchObject(unavailable);
  });
  it('should materialize the verified cache read-only and refuse a writable or unverified request', async () => {
    const pod = fakePod();
    await pod.supervisor.dependencies(runtime, cache, { readOnly: true, verifyHash: true });
    expect(pod.received(String(pod.bodies[0].args.transfer))).toEqual([expect.objectContaining({ path: 'node_modules/vite/bin/vite.js', mode: 0o555 })]);
    expect(pod.bodies[1].args).toMatchObject({ readOnly: true, cacheKey: 'k', cacheTree: 'f'.repeat(64) });
    await expect(pod.supervisor.dependencies(runtime, cache, { readOnly: false, verifyHash: true } as never)).rejects.toMatchObject(unavailable);
    const writable = fakePod({ dependencies: () => ({ readOnly: false }) });
    await expect(writable.supervisor.dependencies(runtime, cache, { readOnly: true, verifyHash: true })).rejects.toMatchObject(unavailable);
  });
  it('should stream cache files one at a time and never commit a tree whose read fails part-way', async () => {
    const pod = fakePod();
    const read: string[] = [];
    pod.sources.dependencies = async function* () {
      for (const path of ['node_modules/a.js', 'node_modules/b.js']) { read.push(path); yield { path, mode: 292 as const, bytes: Buffer.from(path) }; }
      throw new LiveError('dependency_cache_invalid');
    };
    await expect(pod.supervisor.dependencies(runtime, cache, { readOnly: true, verifyHash: true }))
      .rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(read).toHaveLength(2);
    expect(pod.ops()).not.toContain('dependencies');
  });
  it('should project the exact draft revision atomically with its deletions and bounded overlay', async () => {
    const pod = fakePod();
    const draft = { generation: 1, revision: 8, baseHeadSha: 'h', treeSha: 'd', dirty: true };
    await pod.supervisor.overlay(runtime, draft);
    expect(pod.bodies[1]).toMatchObject({ op: 'overlay', args: { revision: 8, generation: 1, baseHeadSha: 'h', deletes: ['ui/old.ts'] } });
    pod.sources.draft = async () => ({ files: Array.from({ length: 255 }, (_, i) => text(`f${i}`, 'x')), deletes: ['g'] });
    await expect(pod.supervisor.overlay(runtime, draft)).rejects.toMatchObject({ code: 'limit_exceeded' });
    pod.sources.draft = async () => ({ files: [text('a', 'x')], deletes: ['a'] });
    await expect(pod.supervisor.overlay(runtime, draft)).rejects.toMatchObject(unavailable);
    const moved = fakePod({ overlay: body => ({ revision: 9, treeDigest: body.args.treeDigest }) });
    await expect(moved.supervisor.overlay(runtime, draft)).rejects.toMatchObject(unavailable);
  });
});

describe('supervisor build output', () => {
  it('should terminate the build tree, read the output itself and seal the candidate digest it computed', async () => {
    const pod = fakePod();
    const result = await pod.supervisor.build(runtime, attempt, BUILD_RECIPE, buildEnvironment());
    expect(pod.ops()).toEqual(['build', 'terminate', 'snapshot']);
    expect(pod.bodies[0].args).toEqual({ recipe: 'build', attemptId: 'att-1', headSha: 'h', treeSha: 't' });
    expect(result).toEqual({ candidateDigest: candidateDigest(DIST) });
    expect(pod.sources.candidate).toHaveBeenCalledWith(expect.objectContaining({ attempt, candidateDigest: result.candidateDigest,
      files: [expect.objectContaining({ path: 'index.html' }), expect.objectContaining({ path: 'assets/app.js' })] }));
  });
  it('should refuse a failed build, a foreign recipe or an output without its entry, sealing nothing', async () => {
    const env = buildEnvironment();
    const failed = fakePod({ build: () => ({ exitCode: 1 }) });
    await expect(failed.supervisor.build(runtime, attempt, BUILD_RECIPE, env)).rejects.toMatchObject(unavailable);
    await expect(failed.supervisor.build(runtime, attempt, { ...BUILD_RECIPE, args: ['run', 'x'] } as never, env)).rejects.toMatchObject(unavailable);
    await expect(failed.supervisor.build(runtime, attempt, BUILD_RECIPE, artifactEnvironment() as never)).rejects.toMatchObject(unavailable);
    expect(failed.ops()).toEqual(['build']);
    const noEntry = fakePod({}, { dist: [text('app.js', 'x')] });
    await expect(noEntry.supervisor.build(runtime, attempt, BUILD_RECIPE, env)).rejects.toMatchObject(unavailable);
    expect(failed.sources.candidate).not.toHaveBeenCalled(); expect(noEntry.sources.candidate).not.toHaveBeenCalled();
  });
  it('should refuse an output the shared candidate digest rejects as output_invalid, sealing nothing', async () => {
    const control = fakePod({}, { dist: [text('index.html', 'x'), text('assets/a\u0001.js', 'x')] });
    const failure = { code: 'builder_unavailable', reason: 'output_invalid' };
    await expect(control.supervisor.build(runtime, attempt, BUILD_RECIPE, buildEnvironment())).rejects.toMatchObject(failure);
    await expect(control.supervisor.verify(runtime, { id: 'a', candidateDigest: 'e'.repeat(64) } as never, limits)).rejects.toMatchObject(failure);
    expect(control.sources.candidate).not.toHaveBeenCalled();
  });
  it('should verify with the exact limits that the stable output still matches the sealed candidate', async () => {
    const pod = fakePod();
    await pod.supervisor.verify(runtime, { id: 'att-1', candidateDigest: candidateDigest(DIST) } as never, limits);
    await expect(pod.supervisor.verify(runtime, { id: 'att-1', candidateDigest: 'e'.repeat(64) } as never, limits)).rejects.toMatchObject(unavailable);
    await expect(pod.supervisor.verify(runtime, { id: 'att-1' } as never, limits)).rejects.toMatchObject(unavailable);
    await expect(pod.supervisor.verify(runtime, { id: 'att-1', candidateDigest: candidateDigest(DIST) } as never,
      { ...limits, files: 256 } as never)).rejects.toMatchObject(unavailable);
    const big = fakePod({}, { dist: [text('index.html', 'x'), ...Array.from({ length: 255 }, (_, i) => text(`f${i}`, 'x'))] });
    await expect(big.supervisor.verify(runtime, { id: 'a', candidateDigest: 'e'.repeat(64) } as never, limits)).rejects.toMatchObject({ code: 'limit_exceeded' });
  });
});
