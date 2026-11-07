import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDependencyCache, type CacheObject } from '../../../src/services/artifacts/live/cache';
import { BUILDER_IMAGE, INSTALL_RECIPE, artifactEnvironment } from '../../../src/services/artifacts/live/recipes';
import { b64, fakeSpawn, harness, type Spawned } from './bootstrap-harness';

const tgz = { vite: Buffer.from('vite-tarball'), x: Buffer.from('x-tarball') };
const sri = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const url = (name: string) => `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`;
const lock = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: {
  '': { name: 'root', workspaces: ['ui'] }, ui: { name: 'ui', bin: { uicli: 'cli.js' } },
  'node_modules/ui': { resolved: 'ui', link: true },
  'node_modules/vite': { version: '1.0.0', resolved: url('vite'), integrity: sri(tgz.vite), bin: { vite: 'bin/vite.js' } },
  'ui/node_modules/x': { version: '1.0.0', resolved: url('x'), integrity: sri(tgz.x) },
} }));
const manifests = [{ path: 'package.json', contentBase64: b64('{"workspaces":["ui"]}') },
  { path: 'package-lock.json', contentBase64: b64(lock) }, { path: 'ui/package.json', contentBase64: b64('{"name":"ui"}') }];

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

describe('pod bootstrap agent: offline install and dependency materialization', () => {
  it('should stage only integrity-verified tarballs at their content-addressed npm cache path', async () => {
    const pod = await harness();
    expect(await pod.send('tarballs', { entries: [{ integrity: sri(tgz.vite), contentBase64: b64(tgz.vite) }] })).toEqual({ stored: 1 });
    const hex = createHash('sha512').update(tgz.vite).digest('hex');
    const stored = pod.path('tmp/npm-cache/_cacache/content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
    expect(await readFile(stored)).toEqual(tgz.vite);
    await pod.send('tarballs', { entries: [{ integrity: sri(tgz.vite), contentBase64: b64(tgz.vite) }] });
    await expect(pod.send('tarballs', { entries: [{ integrity: sri(tgz.vite), contentBase64: b64(tgz.x) }] })).rejects.toThrow('integrity_mismatch');
    await expect(pod.send('tarballs', { entries: [{ integrity: 'sha1-AAAA', contentBase64: b64(tgz.x) }] })).rejects.toThrow('integrity_missing');
  });

  it('should run only the frozen offline install on host manifests and refuse install configuration', async () => {
    const calls: Spawned[] = []; const pod = await harness({ spawn: fakeSpawn(calls, async () => 1) });
    for (const path of ['.npmrc', 'ui/index.ts', 'node_modules/a/package.json']) {
      await expect(pod.send('install', { manifests: [...manifests, { path, contentBase64: b64('x') }] })).rejects.toThrow('invalid_path');
    }
    await expect(pod.send('install', { manifests: manifests.slice(0, 1) })).rejects.toThrow('lockfile_missing');
    await expect(pod.send('install', { manifests })).rejects.toThrow('install_failed');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ executable: INSTALL_RECIPE.executable, args: INSTALL_RECIPE.args,
      options: { cwd: pod.path('dependencies'), shell: false, detached: true, stdio: 'ignore', env: artifactEnvironment() } });
  });

  it('should round-trip a clean install through the trusted cache and materialize it read-only with lockfile links', async () => {
    const calls: Spawned[] = []; const pod = await harness({ spawn: fakeSpawn(calls, npmCi) });
    const objects = new Map<string, CacheObject>();
    const cache = createDependencyCache({ signingKey: () => new Uint8Array(32).fill(7),
      evidence: async lockSha256 => ({ lockSha256, digest: 'e'.repeat(64), approved: [], disabledHooks: [] }),
      fetch: async pin => (pin.path.endsWith('vite') ? tgz.vite : tgz.x),
      cleanInstall: async ({ tarballs }) => {
        await pod.send('tarballs', { entries: tarballs.map(t => ({ integrity: t.pin.integrity, contentBase64: b64(t.bytes) })) });
        await pod.send('install', { manifests });
        const files = []; let offset: number | null = 0;
        while (offset !== null) { const page = await pod.send('export', { offset }); files.push(...page.files); offset = page.next; }
        return { files, runId: 'run-1' };
      },
      storage: { read: async key => objects.get(key), admit: async (key, object) => { objects.set(key, object); return object; },
        quarantine: async () => undefined } });
    const identity = { storageScopeId: 's', repoId: 'r', lockSha256: createHash('sha256').update(lock).digest('hex'), platform: 'linux-x64',
      nodeVersion: '24', npmVersion: '11', image: BUILDER_IMAGE, policyRevision: 'p1', workspaceTopology: 'ui', integrityDigest: 'e'.repeat(64) };
    const receipt = await cache.acquire({ lockfile: lock, cacheIdentity: identity, stagingRef: 'ref' });
    const files = await cache.materialize(receipt);
    expect(files.map(f => [f.path, f.mode])).toEqual([['node_modules/vite/bin/vite.js', 365], ['node_modules/vite/package.json', 292],
      ['ui/node_modules/x/index.js', 292]]);
    const fresh = await harness();
    await fresh.send('stage', { files: [{ path: 'package-lock.json', mode: 0o644, contentBase64: b64(lock) }] });
    await fresh.send('dependencies', { files: files.slice(0, 1), seal: false });
    await expect(fresh.send('dependencies', { files: files.slice(0, 1), seal: false })).rejects.toThrow('duplicate_path');
    await expect(fresh.send('dependencies', { files: [{ ...files[1], mode: 420 }], seal: false })).rejects.toThrow('invalid_mode');
    await expect(fresh.send('dependencies', { files: [{ ...files[1], path: 'ui/x.js' }], seal: false })).rejects.toThrow('invalid_path');
    const sealed = await fresh.send('dependencies', { files: files.slice(1), seal: true });
    expect(sealed).toMatchObject({ treeSha256: receipt.treeSha256, readOnly: true });
    expect(await readlink(fresh.path('dependencies/node_modules/ui'))).toBe('/workspace/ui');
    expect(await readlink(fresh.path('dependencies/node_modules/.bin/vite'))).toBe('../vite/bin/vite.js');
    expect(await readlink(fresh.path('dependencies/node_modules/.bin/uicli'))).toBe('/workspace/ui/cli.js');
    expect(await readlink(fresh.path('workspace/node_modules'))).toBe('/dependencies/node_modules');
    expect(await readlink(fresh.path('workspace/ui/node_modules'))).toBe('/dependencies/ui/node_modules');
    expect((await lstat(fresh.path('dependencies/node_modules/vite'))).mode & 0o777).toBe(0o555);
    await expect(fresh.send('dependencies', { files: [], seal: true })).rejects.toThrow('dependencies_sealed');
  });

  it('should refuse a lockfile link that escapes the workspace', async () => {
    const pod = await harness();
    const bad = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/e': { resolved: '../etc', link: true } } }));
    await pod.send('stage', { files: [{ path: 'package-lock.json', mode: 0o644, contentBase64: b64(bad) }] });
    await expect(pod.send('dependencies', { files: [], seal: true })).rejects.toThrow('invalid_path');
  });
});
