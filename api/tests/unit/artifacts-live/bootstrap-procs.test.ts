import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_RECIPE, LIVE_RECIPE, PREBUNDLE_RECIPE } from '../../../src/services/artifacts/live/recipes';
import { b64, fakeSpawn, fence, harness, type Spawned } from './bootstrap-harness';

const LIMITS = { files: 255, fileBytes: 16777216, totalBytes: 67108864 };
const SHA = 'a'.repeat(40);
async function ready(pod: Awaited<ReturnType<typeof harness>>, config = true) {
  const lock = JSON.stringify({ lockfileVersion: 3, packages: { '': {} } });
  await pod.send('stage', { files: [{ path: 'package-lock.json', mode: 0o644, contentBase64: b64(lock) }] });
  await pod.send('dependencies', { seal: true, files: [{ path: 'node_modules/vite/bin/vite.js', type: 'file', mode: 365, bytes: b64('v') }] });
  if (config) await pod.send('hostFile', { path: '/tmp/artifact-vite.config.mjs', source: 'export default {}' });
  await pod.send('phase', { phase: 'offline' });
}
const outputs = (files: Record<string, string>) => async (call: Spawned) => {
  if (call.args.join(' ') !== BUILD_RECIPE.args.join(' ')) return 0;
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(call.options.cwd, 'ui/dist', path, '..'), { recursive: true });
    if (content.startsWith('->')) await symlink(content.slice(2), join(call.options.cwd, 'ui/dist', path));
    else await writeFile(join(call.options.cwd, 'ui/dist', path), content);
  }
  return files.fail ? 1 : 0;
};

describe('pod bootstrap agent: repository processes and output snapshot', () => {
  it('should report the static egress posture and count only outbound connections', async () => {
    const pod = await harness({ sockets: async () => ['  sl  local_address rem_address   st',
      '0: 0100007F:1435 0A000002:C350 01', '1: 0100007F:C351 0100007F:1436 01', '2: 0100007F:1436 0100007F:C351 01',
      '3: 0A000005:9C40 0A000009:10F3 01', '4: 00000000:1435 00000000:0000 0A'] });
    expect(await pod.send('phase', { phase: 'offline' })).toEqual({ phase: 'offline', egress: 'static-deny', established: 1 });
    await expect(pod.send('phase', { phase: 'online' })).rejects.toThrow('invalid_phase');
  });

  it('should refuse repository processes before sealed dependencies, while stopped or without the host config', async () => {
    const pod = await harness();
    await expect(pod.send('dev')).rejects.toThrow('phase_refused');
    const noConfig = await harness(); await ready(noConfig, false);
    await expect(noConfig.send('dev')).rejects.toThrow('host_config_missing');
    const stopped = await harness(); await ready(stopped); await stopped.send('phase', { phase: 'stopped' });
    await expect(stopped.send('prebundle')).rejects.toThrow('phase_refused');
  });

  it('should pre-bundle and serve only frozen recipes, idempotently, and taint the pod for acquisition', async () => {
    const calls: Spawned[] = [];
    const pod = await harness({ spawn: fakeSpawn(calls, call => (call.args.includes('optimize') ? Promise.resolve(0) : new Promise(() => undefined))) });
    await ready(pod);
    await pod.send('overlay', { revision: 'r1', files: [], deletes: [] });
    expect(await pod.send('prebundle')).toEqual({ prebundled: true });
    expect(await pod.send('dev', {}, fence(3))).toEqual({ revision: 'r1', routeEpoch: 3 });
    expect(pod.agent.isLive()).toBe(true);
    expect(await pod.send('dev', {}, fence(4))).toEqual({ revision: 'r1', routeEpoch: 4 });
    expect(calls.map(c => [c.executable, c.args])).toEqual([[PREBUNDLE_RECIPE.executable, PREBUNDLE_RECIPE.args],
      [LIVE_RECIPE.executable, LIVE_RECIPE.args]]);
    expect(calls[1].options).toMatchObject({ cwd: pod.path('workspace'), shell: false, detached: true });
    await pod.send('phase', { phase: 'stopped' }, fence(4));
    await expect(pod.send('tarballs', { entries: [] }, fence(4))).rejects.toThrow('phase_refused');
    await pod.send('terminate', {}, fence(4));
    expect(pod.agent.isLive()).toBe(false);
    const down = await harness({ spawn: fakeSpawn([], () => new Promise(() => undefined)),
      waitPort: async () => { throw new Error('closed'); } });
    await ready(down);
    await expect(down.send('dev')).rejects.toThrow('dev_unavailable');
    expect(down.agent.isLive()).toBe(false);
  });

  it('should build, snapshot and verify a stable candidate and serve exactly its files', async () => {
    const calls: Spawned[] = [];
    const pod = await harness({ spawn: fakeSpawn(calls, outputs({ 'index.html': '<html>', 'assets/a.js': 'a' })) });
    await ready(pod);
    const built = await pod.send('build', { attemptId: 'att-1', headSha: SHA, treeSha: SHA });
    expect(built).toMatchObject({ files: 2, totalBytes: 7 });
    expect(built.candidateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.map(c => c.args)).toEqual([BUILD_RECIPE.args]);
    await expect(pod.send('verify', { attemptId: 'att-1', limits: { ...LIMITS, files: 999 } })).rejects.toThrow('invalid_limits');
    expect(await pod.send('verify', { attemptId: 'att-1', limits: LIMITS }))
      .toMatchObject({ verified: true, candidateDigest: built.candidateDigest });
    expect(await pod.send('output', { path: 'assets/a.js' })).toMatchObject({ path: 'assets/a.js', contentBase64: b64('a') });
    await expect(pod.send('output', { path: '../.env' })).rejects.toThrow('invalid_path');
    await writeFile(pod.path('workspace/ui/dist/index.html'), '<changed>');
    await expect(pod.send('verify', { attemptId: 'att-1', limits: LIMITS })).rejects.toThrow('unstable_output');
    await expect(pod.send('build', { attemptId: 'att 2', headSha: SHA, treeSha: SHA })).rejects.toThrow('invalid_args');
  });

  it('should refuse a failed build, a missing output and linked output files', async () => {
    const run = async (files: Record<string, string>) => {
      const pod = await harness({ spawn: fakeSpawn([], outputs(files)) }); await ready(pod);
      return pod.send('build', { attemptId: 'att-1', headSha: SHA, treeSha: SHA });
    };
    await expect(run({ 'index.html': 'x', fail: '1' })).rejects.toThrow('build_failed');
    await expect(run({})).rejects.toThrow('output_missing');
    await expect(run({ 'index.html': 'x', 'leak.txt': '->/etc/passwd' })).rejects.toThrow('special_file');
  });
});
