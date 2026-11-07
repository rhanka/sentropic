import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, readlink, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDependencyCache, type CacheObject, type DependencyFile } from '../../../src/services/artifacts/live/cache';
import { BUILDER_IMAGE, INSTALL_RECIPE, artifactEnvironment } from '../../../src/services/artifacts/live/recipes';
import { fakeSpawn, file, harness, type Spawned } from './bootstrap-harness';

type Pod = Awaited<ReturnType<typeof harness>>;
const HEAD = 'a'.repeat(40);
const tgz = { vite: Buffer.from('vite-tarball'), x: Buffer.from('x-tarball') };
const sri = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const url = (name: string) => `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`;
const lock = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: {
  '': { name: 'root', workspaces: ['ui'] }, ui: { name: 'ui', bin: { uicli: 'cli.js' } },
  'node_modules/ui': { resolved: 'ui', link: true },
  'node_modules/vite': { version: '1.0.0', resolved: url('vite'), integrity: sri(tgz.vite), bin: { vite: 'bin/vite.js' } },
  'ui/node_modules/x': { version: '1.0.0', resolved: url('x'), integrity: sri(tgz.x) },
} }));
const source = [file('package.json', '{"workspaces":["ui"]}'), file('package-lock.json', lock), file('ui/package.json', '{"name":"ui"}')];
const tarballs = [tgz.vite, tgz.x].map((bytes, index) => ({ file: file(`${index}.tgz`, bytes, 0o444), integrity: sri(bytes) }));

/** What `npm ci --offline` leaves behind: regular files plus bin and workspace links. */
async function npmCi(call: Spawned) {
  const at = (path: string) => join(call.options.cwd, path);
  await mkdir(at('node_modules/vite/bin'), { recursive: true }); await mkdir(at('node_modules/.bin'));
  await mkdir(at('ui/node_modules/x'), { recursive: true });
  await writeFile(at('node_modules/vite/package.json'), '{}');
  await writeFile(at('node_modules/vite/bin/vite.js'), '#!/usr/bin/env node'); await chmod(at('node_modules/vite/bin/vite.js'), 0o755);
  await writeFile(at('ui/node_modules/x/index.js'), 'x');
  await symlink('../vite/bin/vite.js', at('node_modules/.bin/vite')); await symlink('../ui', at('node_modules/ui'));
}
/** Installs the way the W3 clean installer drives the pod: install + npm-cache transfers, then the install op. */
async function install(pod: Pod, files = source, staged = tarballs) {
  const sent = await pod.transfer('install', files);
  const cache = await pod.transfer('npm-cache', staged.map(t => t.file));
  return pod.send('install', { recipe: 'install', runId: 'run-1', source: sent, cache,
    tarballs: staged.map(t => ({ path: t.file.path, integrity: t.integrity })) });
}
/** W3 `readSnapshot` reassembly of contiguous slices (links skipped by the pod). */
async function snapshot(pod: Pod, root: string) {
  const out = new Map<string, { mode: number; chunks: Buffer[] }>(); let cursor: number | null = 0;
  while (cursor !== null) {
    const page = await pod.send('snapshot', { root, cursor });
    for (const e of page.entries) {
      const entry = out.get(e.path) ?? { mode: e.mode, chunks: [] as Buffer[] };
      out.set(e.path, entry); entry.chunks.push(Buffer.from(e.data, 'base64'));
    }
    cursor = page.next;
  }
  return [...out].map(([path, f]) => ({ path, mode: f.mode, bytes: Buffer.concat(f.chunks) }));
}

describe('pod bootstrap agent: offline install and dependency materialization', () => {
  it('should store only SRI-verified tarballs content-addressed and run the frozen offline install with the host env', async () => {
    const calls: Spawned[] = []; const pod = await harness({ spawn: fakeSpawn(calls, async () => 1) });
    expect(await install(pod)).toEqual({ exitCode: 1 });
    const hex = createHash('sha512').update(tgz.vite).digest('hex');
    expect(await readFile(pod.path('tmp/npm-cache/_cacache/content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4)))).toEqual(tgz.vite);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ executable: INSTALL_RECIPE.executable, args: INSTALL_RECIPE.args,
      options: { cwd: pod.path('tmp/install'), shell: false, detached: true, stdio: 'ignore', env: artifactEnvironment() } });
    expect(calls[0].options.env.NODE_OPTIONS).toBe('--max-old-space-size=384');
    await expect(install(pod)).rejects.toThrow('failed:already_installed');
  });

  it('should refuse a mismatched or missing tarball and install configuration before npm runs', async () => {
    const calls: Spawned[] = []; const spawn = fakeSpawn(calls);
    const swapped = [{ ...tarballs[0], file: file('0.tgz', tgz.x, 0o444) }, tarballs[1]];
    await expect(install(await harness({ spawn }), source, swapped)).rejects.toThrow('integrity:integrity_mismatch');
    await expect(install(await harness({ spawn }), source, tarballs.slice(0, 1))).rejects.toThrow('integrity:integrity_missing');
    for (const path of ['.npmrc', 'ui/.yarnrc.yml', 'node_modules/a/package.json']) {
      await expect(install(await harness({ spawn }), [...source, file(path, 'x')])).rejects.toThrow('failed:invalid_path');
    }
    await expect(install(await harness({ spawn }), source.slice(0, 1))).rejects.toThrow('failed:lockfile_missing');
    expect(calls).toEqual([]);
  });

  it('should round-trip a clean install through the trusted cache and materialize it read-only with lockfile links', async () => {
    const pod = await harness({ spawn: fakeSpawn([], npmCi) });
    const objects = new Map<string, CacheObject>();
    const cache = createDependencyCache({ signingKey: () => new Uint8Array(32).fill(7),
      evidence: async lockSha256 => ({ lockSha256, digest: 'e'.repeat(64), approved: [], disabledHooks: [] }),
      fetch: async pin => (pin.path.endsWith('vite') ? tgz.vite : tgz.x),
      cleanInstall: async ({ tarballs: pins }) => {
        expect(await pod.send('clear', { paths: ['/tmp'] })).toEqual({ cleared: ['/tmp'] });
        const staged = pins.map((t, index) => ({ file: file(`${index}.tgz`, Buffer.from(t.bytes), 0o444), integrity: t.pin.integrity }));
        expect(await install(pod, source, staged)).toEqual({ exitCode: 0 });
        const exported = await snapshot(pod, 'dependencies');
        await pod.send('clear', { paths: ['/tmp'] });
        return { runId: 'run-1', files: exported.map(f => ({ path: f.path, type: 'file' as const,
          mode: f.mode & 0o111 ? 365 as const : 292 as const, bytes: f.bytes.toString('base64') })) };
      },
      storage: { read: async key => objects.get(key), admit: async (key, object) => { objects.set(key, object); return object; },
        quarantine: async () => undefined } });
    const identity = { storageScopeId: 's', repoId: 'r', lockSha256: createHash('sha256').update(lock).digest('hex'), platform: 'linux-x64',
      nodeVersion: '24', npmVersion: '11', image: BUILDER_IMAGE, policyRevision: 'p1', workspaceTopology: 'ui', integrityDigest: 'e'.repeat(64) };
    const receipt = await cache.acquire({ lockfile: lock, cacheIdentity: identity, stagingRef: 'ref' });
    const files: readonly DependencyFile[] = await cache.materialize(receipt);
    expect(files.map(f => [f.path, f.mode])).toEqual([['node_modules/vite/bin/vite.js', 365], ['node_modules/vite/package.json', 292],
      ['ui/node_modules/x/index.js', 292]]);
    const tree = files.map(f => file(f.path, Buffer.from(f.bytes, 'base64'), f.mode === 365 ? 0o555 : 0o444));
    const fresh = await harness();
    const materialize = async (entries = tree) => fresh.send('dependencies', { ...await fresh.transfer('dependencies', entries),
      cacheKey: receipt.key, cacheTree: receipt.treeSha256, readOnly: true });
    await expect(materialize()).rejects.toThrow('failed:phase_refused');
    await fresh.send('stage', { ...await fresh.transfer('workspace', [file('package-lock.json', lock)]), headSha: HEAD, treeSha: HEAD });
    await expect(materialize([file('ui/x.js', 'x', 0o444)])).rejects.toThrow('failed:invalid_path');
    await expect(materialize([file('node_modules/a.js', 'x', 0o644)])).rejects.toThrow('failed:invalid_mode');
    expect(await materialize()).toMatchObject({ treeDigest: expect.stringMatching(/^[a-f0-9]{64}$/), readOnly: true, files: 3 });
    expect(await readlink(fresh.path('dependencies/node_modules/ui'))).toBe('/workspace/ui');
    expect(await readlink(fresh.path('dependencies/node_modules/.bin/vite'))).toBe('../vite/bin/vite.js');
    expect(await readlink(fresh.path('dependencies/node_modules/.bin/uicli'))).toBe('/workspace/ui/cli.js');
    expect(await readlink(fresh.path('workspace/node_modules'))).toBe('/dependencies/node_modules');
    expect(await readlink(fresh.path('workspace/ui/node_modules'))).toBe('/dependencies/ui/node_modules');
    expect((await lstat(fresh.path('dependencies/node_modules/vite'))).mode & 0o777).toBe(0o555);
    expect(await readdir(fresh.path('dependencies'))).toEqual(['node_modules', 'ui']);
    await expect(materialize([])).rejects.toThrow('failed:dependencies_sealed');
  });

  it('should refuse a lockfile link that escapes the workspace', async () => {
    const pod = await harness();
    const bad = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/e': { resolved: '../etc', link: true } } }));
    await pod.send('stage', { ...await pod.transfer('workspace', [file('package-lock.json', bad)]), headSha: HEAD, treeSha: HEAD });
    await expect(pod.send('dependencies', { ...await pod.transfer('dependencies', []), cacheKey: 'k', cacheTree: 'c'.repeat(64),
      readOnly: true })).rejects.toThrow('failed:invalid_path');
  });
});
