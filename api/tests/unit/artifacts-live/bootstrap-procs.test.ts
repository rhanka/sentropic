import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILD_RECIPE, LIVE_PREBUNDLE_SCRIPT, LIVE_RECIPE, PREBUNDLE_RECIPE, artifactEnvironment, buildEnvironment,
} from '../../../src/services/artifacts/live/recipes';
import { fakeSpawn, fence, file, harness, type Spawned } from './bootstrap-harness';

type Pod = Awaited<ReturnType<typeof harness>>;
const SHA = 'a'.repeat(40);
const BUILD = { recipe: 'build', attemptId: 'att-1', headSha: SHA, treeSha: SHA };
async function ready(pod: Pod, config = true) {
  const lock = JSON.stringify({ lockfileVersion: 3, packages: { '': {} } });
  await pod.send('stage', { ...await pod.transfer('workspace', [file('package-lock.json', lock)]), headSha: SHA, treeSha: SHA });
  await pod.send('dependencies', { ...await pod.transfer('dependencies', [file('node_modules/vite/bin/vite.js', 'v', 0o555)]),
    cacheKey: 'k', cacheTree: 'c'.repeat(64), readOnly: true });
  if (config) await pod.send('hostFile', { path: '/tmp/artifact-vite.config.mjs', source: 'export default {}' });
  await pod.send('phase', { phase: 'offline' });
}
const outputs = (files: Record<string, string | Buffer>) => async (call: Spawned) => {
  if (call.args.join(' ') !== BUILD_RECIPE.args.join(' ')) return 0;
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(call.options.cwd, 'ui/dist', path, '..'), { recursive: true });
    if (typeof content === 'string' && content.startsWith('->')) await symlink(content.slice(2), join(call.options.cwd, 'ui/dist', path));
    else await writeFile(join(call.options.cwd, 'ui/dist', path), content);
  }
  return files.fail ? 2 : 0;
};
async function pages(pod: Pod, root: string) {
  const all: any[] = []; let cursor: number | null = 0; let count = 0;
  while (cursor !== null) { const page = await pod.send('snapshot', { root, cursor }); all.push(...page.entries); cursor = page.next; count++; }
  return { entries: all, count };
}

describe('pod bootstrap agent: repository processes and output snapshot', () => {
  it('should report the static egress posture and count only outbound connections', async () => {
    const pod = await harness({ sockets: async () => ['  sl  local_address rem_address   st',
      '0: 0100007F:1435 0A000002:C350 01', '1: 0100007F:C351 0100007F:1436 01', '2: 0100007F:1436 0100007F:C351 01',
      '3: 0A000005:9C40 0A000009:10F3 01', '4: 00000000:1435 00000000:0000 0A'] });
    expect(await pod.send('phase', { phase: 'offline' })).toEqual({ phase: 'offline', egress: 'static-deny', established: 1 });
  });

  it('should refuse repository processes before sealed dependencies, while stopped or without the host config', async () => {
    const pod = await harness();
    await expect(pod.send('prebundle', { recipe: 'prebundle' })).rejects.toThrow('failed:phase_refused');
    const noConfig = await harness(); await ready(noConfig, false);
    await expect(noConfig.send('prebundle', { recipe: 'prebundle' })).rejects.toThrow('failed:host_config_missing');
    const stopped = await harness(); await ready(stopped); await stopped.send('phase', { phase: 'stopped' });
    await expect(stopped.send('build', BUILD)).rejects.toThrow('failed:phase_refused');
    await expect(stopped.send('dev', { recipe: 'build' })).rejects.toThrow('failed:invalid_recipe');
    await expect(stopped.send('prebundle', { recipe: 'live' })).rejects.toThrow('failed:invalid_recipe');
    await expect(stopped.send('build', { ...BUILD, recipe: 'live' })).rejects.toThrow('failed:invalid_args');
  });

  it('should pre-bundle as its own queued phase, then serve Vite from frozen recipes with the host env, idempotently', async () => {
    const calls: Spawned[] = [];
    const pod = await harness({ spawn: fakeSpawn(calls, call => (call.args[0] === PREBUNDLE_RECIPE.args[0] ? Promise.resolve(0)
      : new Promise(() => undefined))) });
    await ready(pod);
    await pod.send('overlay', { ...await pod.transfer('overlay', []), deletes: [], revision: 'r1', generation: 1, baseHeadSha: SHA, treeSha: SHA });
    await expect(pod.send('dev', { recipe: 'live' })).rejects.toThrow('failed:prebundle_missing');
    expect(calls).toEqual([]);
    expect(await pod.send('prebundle', { recipe: 'prebundle' })).toEqual({ prebundled: true });
    expect(await readFile(pod.path('tmp/artifact-vite-prebundle.mjs'), 'utf8')).toBe(LIVE_PREBUNDLE_SCRIPT);
    expect(await pod.send('dev', { recipe: 'live' }, fence(3))).toEqual({ revision: 'r1', routeEpoch: 3 });
    expect(pod.agent.isLive()).toBe(true);
    expect(await pod.send('dev', { recipe: 'live' }, fence(4))).toEqual({ revision: 'r1', routeEpoch: 4 });
    expect(calls.map(c => [c.executable, c.args])).toEqual([[PREBUNDLE_RECIPE.executable, PREBUNDLE_RECIPE.args],
      [LIVE_RECIPE.executable, LIVE_RECIPE.args]]);
    for (const call of calls) {
      expect(call.options).toEqual({ cwd: pod.path('workspace'), env: artifactEnvironment(), shell: false, detached: true, stdio: 'ignore' });
    }
    await pod.send('terminate', {}, fence(4));
    expect(pod.agent.isLive()).toBe(false);
    expect(pod.groups).toEqual(expect.arrayContaining([4001, 4002]));
    expect(await pod.send('dev', { recipe: 'live' }, fence(5))).toEqual({ revision: 'r1', routeEpoch: 5 });
    expect(calls.map(c => c.args[0])).toEqual([PREBUNDLE_RECIPE.args[0], LIVE_RECIPE.args[0], LIVE_RECIPE.args[0]]);
    await pod.send('clear', { paths: ['/tmp'] }, fence(5));
    await expect(pod.send('dev', { recipe: 'live' }, fence(5))).rejects.toThrow('failed:prebundle_missing');
    const hang = (code: number) => (call: Spawned) => (call.args[0] === PREBUNDLE_RECIPE.args[0] ? Promise.resolve(code) : new Promise<number>(() => undefined));
    const failed = await harness({ spawn: fakeSpawn([], hang(1)) }); await ready(failed);
    await expect(failed.send('prebundle', { recipe: 'prebundle' })).rejects.toThrow('failed:prebundle_failed');
    await expect(failed.send('dev', { recipe: 'live' })).rejects.toThrow('failed:prebundle_missing');
    const down = await harness({ spawn: fakeSpawn([], hang(0)), waitPort: async () => { throw new Error('closed'); } }); await ready(down);
    await down.send('prebundle', { recipe: 'prebundle' });
    await expect(down.send('dev', { recipe: 'live' })).rejects.toThrow('failed:dev_unavailable');
    expect(down.agent.isLive()).toBe(false);
  });

  it('should build with the frozen recipe and the build heap, then page a stable output snapshot in contiguous slices', async () => {
    const calls: Spawned[] = []; const big = Buffer.alloc(900 * 1024, 7);
    const pod = await harness({ spawn: fakeSpawn(calls, outputs({ 'index.html': '<html>', 'assets/a.js': 'a', 'assets/big.bin': big })) });
    await ready(pod);
    expect(await pod.send('build', BUILD)).toEqual({ exitCode: 0 });
    expect(calls.map(c => [c.executable, c.args])).toEqual([[BUILD_RECIPE.executable, BUILD_RECIPE.args]]);
    expect(calls[0].options.env).toEqual(buildEnvironment());
    expect(calls[0].options.env.NODE_OPTIONS).toBe('--max-old-space-size=1024');
    const { entries, count } = await pages(pod, 'output');
    expect(count).toBe(3);
    expect(entries.map(e => [e.path, e.offset, e.size])).toEqual([['assets/a.js', 0, 1], ['assets/big.bin', 0, big.length],
      ['assets/big.bin', 768 * 1024, big.length], ['index.html', 0, 6]]);
    expect(Buffer.concat(entries.filter(e => e.path === 'assets/big.bin').map(e => Buffer.from(e.data, 'base64')))).toEqual(big);
    expect(entries.every(e => e.type === 'file' && e.mode === 0o644)).toBe(true);
    await expect(pod.send('snapshot', { root: 'workspace', cursor: 0 })).rejects.toThrow('failed:invalid_args');
    await expect(pod.send('snapshot', { root: 'output', cursor: 99 })).rejects.toThrow('failed:invalid_args');
    await writeFile(pod.path('workspace/ui/dist/index.html'), '<changed-size>');
    await pod.send('snapshot', { root: 'output', cursor: 0 });
    await writeFile(pod.path('workspace/ui/dist/assets/big.bin'), 'shrunk');
    await expect(pod.send('snapshot', { root: 'output', cursor: 1 })).rejects.toThrow('failed:unstable_tree');
  });

  it('should report a failed build exit code and refuse a missing entry, linked files or oversized output', async () => {
    const run = async (files: Record<string, string | Buffer>) => {
      const pod = await harness({ spawn: fakeSpawn([], outputs(files)) }); await ready(pod);
      return { pod, built: await pod.send('build', BUILD) };
    };
    expect((await run({ 'index.html': 'x', fail: '1' })).built).toEqual({ exitCode: 2 });
    await expect(pages((await run({ 'a.js': 'x' })).pod, 'output')).rejects.toThrow('failed:output_missing');
    await expect(pages((await run({ 'index.html': 'x', 'leak.txt': '->/etc/passwd' })).pod, 'output')).rejects.toThrow('failed:special_file');
    const many = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`f${i}.js`, 'x'])); many['index.html'] = 'x';
    await expect(pages((await run(many)).pod, 'output')).rejects.toThrow('limit:limit_exceeded');
    expect((await stat((await run({ 'index.html': 'x' })).pod.path('workspace/ui/dist/index.html'))).size).toBe(1);
  });
});
