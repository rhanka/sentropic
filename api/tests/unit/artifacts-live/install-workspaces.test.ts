import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDependencyCache, type CacheIdentity, type CacheObject, type CachePorts,
  type DependencyFile } from '../../../src/services/artifacts/live/cache';
import { sha256 } from '../../../src/services/artifacts/live/integrity';
import { GB1_QUALIFICATION_PATH } from '../../../src/services/artifacts/live/gb1-qualification';
import { BUILDER_IMAGE, INSTALL_RECIPE, installRecipeFor } from '../../../src/services/artifacts/live/recipes';

/** Monorepo fixture: root workspaces ["api","ui","packages/*"], one root lockfile, ui on workspace links.
 * Scoped rule is exactly `npm ci --workspace` without `--include-workspace-root`: no root dependency is kept. */
const REMOTES = ['node_modules/express', 'node_modules/lodash', 'node_modules/vite',
  'node_modules/zod', 'node_modules/node-fetch', 'node_modules/data-uri-to-buffer'];
const bytesOf = (path: string) => Buffer.from(`tarball:${path}`);
const sriOf = (path: string) => `sha512-${createHash('sha512').update(bytesOf(path)).digest('base64')}`;
const urlOf = (path: string) => `https://registry.npmjs.org/${path.split('/').pop()}/-/${path.split('/').pop()}-1.0.0.tgz`;
const remote = (path: string, extra: Record<string, unknown> = {}) =>
  ({ version: '1.0.0', resolved: urlOf(path), integrity: sriOf(path), ...extra });

function monoLock() {
  return { lockfileVersion: 3, packages: {
    '': { name: 'radar', version: '1.0.0', devDependencies: { vitest: '^3.0.0' } },
    api: { name: 'api-app', version: '1.0.0', dependencies: { express: '^4.0.0' } },
    ui: { name: 'ui-app', version: '1.0.0', dependencies: { '@radar/domain': '*', '@radar/scoring': '*', lodash: '^4.0.0' },
      devDependencies: { vite: '^6.0.0' } },
    'packages/domain': { name: '@radar/domain', version: '1.0.0', dependencies: { '@radar/sources': '*', zod: '^3.0.0' } },
    'packages/scoring': { name: '@radar/scoring', version: '1.0.0', dependencies: { lodash: '^4.0.0' } },
    'packages/sources': { name: '@radar/sources', version: '1.0.0', dependencies: { 'node-fetch': '^3.0.0' } },
    'node_modules/@radar/domain': { resolved: 'packages/domain', link: true },
    'node_modules/@radar/scoring': { resolved: 'packages/scoring', link: true },
    'node_modules/@radar/sources': { resolved: 'packages/sources', link: true },
    'node_modules/api-app': { resolved: 'api', link: true },
    'node_modules/ui-app': { resolved: 'ui', link: true },
    'node_modules/express': remote('node_modules/express'),
    'node_modules/lodash': remote('node_modules/lodash'),
    'node_modules/vite': remote('node_modules/vite'),
    'node_modules/vitest': remote('node_modules/vitest'),
    'node_modules/zod': remote('node_modules/zod'),
    'node_modules/node-fetch': remote('node_modules/node-fetch', { dependencies: { 'data-uri-to-buffer': '^4.0.0' } }),
    'node_modules/data-uri-to-buffer': remote('node_modules/data-uri-to-buffer'),
  } };
}
const rootPkg = JSON.stringify({ name: 'radar', version: '1.0.0', workspaces: ['api', 'ui', 'packages/*'],
  scripts: { 'build:artifact': 'vite build' }, devDependencies: { vitest: '^3.0.0' } });
const pkgFile = (name: string, deps: Record<string, string> = {}, dev: Record<string, string> = {}) =>
  JSON.stringify({ name, version: '1.0.0', ...(Object.keys(deps).length ? { dependencies: deps } : {}),
    ...(Object.keys(dev).length ? { devDependencies: dev } : {}) });

function harness(selection: readonly string[]) {
  const lock = monoLock();
  const source = () => {
    const lockText = JSON.stringify(lock);
    const lockfile = Buffer.from(lockText);
    const qualification = JSON.stringify({ v: 1, lockSha256: sha256(lockText), postinstallAllowlist: [], scriptQualification: [] });
    const gb1 = { subPath: '', files: {
      'sentropic.artifact.json': JSON.stringify({ version: 1, buildScript: 'build:artifact', outputDir: 'dist', lockfilePath: 'package-lock.json' }),
      'package.json': rootPkg, 'package-lock.json': lockText, [GB1_QUALIFICATION_PATH]: qualification,
      'api/package.json': pkgFile('api-app', { express: '^4.0.0' }),
      'ui/package.json': pkgFile('ui-app', { '@radar/domain': '*', '@radar/scoring': '*', lodash: '^4.0.0' }, { vite: '^6.0.0' }),
      'packages/domain/package.json': pkgFile('@radar/domain', { '@radar/sources': '*', zod: '^3.0.0' }),
      'packages/scoring/package.json': pkgFile('@radar/scoring', { lodash: '^4.0.0' }),
      'packages/sources/package.json': pkgFile('@radar/sources', { 'node-fetch': '^3.0.0' }) } };
    const cacheIdentity: CacheIdentity = { storageScopeId: 'scope', repoId: 'repo', lockSha256: sha256(lockfile),
      image: BUILDER_IMAGE, platform: 'linux/amd64', nodeVersion: '24', npmVersion: '11', policyRevision: 'p1',
      workspaceTopology: 'mono', integrityDigest: sha256(qualification), installWorkspaces: [...selection].sort() };
    return { lockfile, cacheIdentity, stagingRef: 'ref', gb1 };
  };
  let stored: CacheObject | undefined;
  const fetched: string[] = [];
  const ports: CachePorts = {
    signingKey: () => Buffer.alloc(32, 1),
    fetch: vi.fn(async pin => { fetched.push(pin.path); return bytesOf(pin.path); }),
    cleanInstall: vi.fn<CachePorts['cleanInstall']>(async input => {
      for await (const tarball of input.tarballs) await input.sink({ path: `${tarball.pin.path}/index.js`, mode: 292,
        bytes: Buffer.from(`installed:${tarball.pin.path}`) });
      return { runId: 'run-ws' };
    }),
    storage: { read: vi.fn(async () => stored), admit: vi.fn(async (_key, object) => (stored ??= object)),
      quarantine: vi.fn(async () => { stored = undefined; }),
      putFile: vi.fn(async () => undefined), getFile: vi.fn(async () => undefined),
      putArchive: vi.fn(async () => undefined), getArchive: vi.fn(async () => undefined) },
  };
  return { lock, ports, fetched, cache: createDependencyCache(ports), source };
}

describe('workspace-scoped installs', () => {
  it('should stream and install only the ui subset with transitive and linked workspaces', async () => {
    const f = harness(['ui']);
    const receipt = await f.cache.acquire(f.source());
    expect(receipt.inventory.map(pin => pin.path).sort()).toEqual([...REMOTES.filter(p => p !== 'node_modules/express')].sort());
    expect(f.fetched).toHaveLength(5);
    expect(f.fetched).not.toContain('node_modules/express');
    expect(f.fetched).not.toContain('node_modules/vitest');
    expect(f.ports.cleanInstall).toHaveBeenCalledWith(expect.objectContaining({
      recipe: expect.objectContaining({ args: expect.arrayContaining(['--workspace=ui']) }) }));
    expect(INSTALL_RECIPE.args.join(' ')).not.toContain('--workspace');
  });

  it('should build the same workspace flags on the API recipe and the pod (no divergent construction)', async () => {
    const selection = ['ui', 'packages/domain'];
    expect(installRecipeFor(selection).args).toEqual([...INSTALL_RECIPE.args,
      ...[...selection].sort().map(w => `--workspace=${w}`)]);
    expect(installRecipeFor([])).toBe(INSTALL_RECIPE);
  });

  it('should keep locked-tarball verification as strict on the subset', async () => {
    const f = harness(['ui']);
    f.ports.fetch = vi.fn(async pin => (pin.path === 'node_modules/zod' ? Buffer.from('altered') : bytesOf(pin.path)));
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_integrity_mismatch' });
    expect(f.ports.storage.admit).not.toHaveBeenCalled();
    const g = harness(['ui']);
    (g.lock.packages as Record<string, Record<string, unknown>>)['node_modules/zod']!.integrity = '';
    await expect(g.cache.acquire(g.source())).rejects.toMatchObject({ code: 'dependency_integrity_missing' });
    expect(g.ports.fetch).not.toHaveBeenCalled();
  });

  it('should scope the dependency cache key by the workspace selection', async () => {
    const whole = harness([]);
    const full = await whole.cache.acquire(whole.source());
    const f = harness(['ui']);
    const scoped = await f.cache.acquire(f.source());
    expect(scoped.key).not.toBe(full.key);
    expect(scoped.identity.installWorkspaces).toEqual(['ui']);
    expect(full.identity.installWorkspaces).toEqual([]);
  });

  it('should refuse an unknown workspace before any fetch', async () => {
    const f = harness(['unknown']);
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'build_descriptor_invalid' });
    expect(f.ports.fetch).not.toHaveBeenCalled();
    expect(f.ports.cleanInstall).not.toHaveBeenCalled();
  });
});
