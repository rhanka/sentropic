import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDependencyCache, type CacheIdentity, type CacheObject, type CachePorts, type CacheReceipt,
  type DependencyFile } from '../../../src/services/artifacts/live/cache';
import { sha256 } from '../../../src/services/artifacts/live/integrity';
import { artifactEnvironment, BUILDER_IMAGE, INSTALL_RECIPE, NPM_RELAY } from '../../../src/services/artifacts/live/recipes';

function cacheFixture() {
  const bytes = Buffer.from('qualified tarball');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const entry = { version: '1.0.0', resolved: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz', integrity };
  const lock = { lockfileVersion: 3, packages: { '': {}, 'node_modules/pkg': entry } };
  let stored: CacheObject | undefined;
  const files = new Map<string, Uint8Array>();
  const installed: DependencyFile = { path: 'pkg/index.js', mode: 292, bytes: Buffer.from('module.exports = 1') };
  const ports: CachePorts = {
    signingKey: () => Buffer.alloc(32, 1),
    evidence: vi.fn(async lockSha256 => ({ lockSha256, digest: 'f'.repeat(64), approved: [], disabledHooks: [] })),
    fetch: vi.fn(async () => bytes),
    cleanInstall: vi.fn<CachePorts['cleanInstall']>(async input => {
      for await (const tarball of input.tarballs) expect(tarball.bytes).toEqual(bytes);
      await input.sink(installed);
      return { runId: 'clean-run' };
    }),
    storage: { read: vi.fn(async () => stored), admit: vi.fn(async (_key, object) => (stored ??= object)),
      quarantine: vi.fn(async () => { stored = undefined; }),
      putFile: vi.fn(async (digest, data) => { files.set(digest, data); }), getFile: vi.fn(async digest => files.get(digest)) },
  };
  const source = () => {
    const lockfile = Buffer.from(JSON.stringify(lock));
    const cacheIdentity: CacheIdentity = { storageScopeId: 'scope', repoId: 'repo', lockSha256: sha256(lockfile),
      image: BUILDER_IMAGE, platform: 'linux/amd64', nodeVersion: '24', npmVersion: '11', policyRevision: 'p1',
      workspaceTopology: 'root', integrityDigest: 'f'.repeat(64) };
    return { lockfile, cacheIdentity, stagingRef: 'verified-clean-checkout' };
  };
  return { lock, ports, source, files, installed, cache: createDependencyCache(ports), stored: () => stored! };
}
async function collect(cache: ReturnType<typeof createDependencyCache>, receipt: CacheReceipt) {
  const out: DependencyFile[] = [];
  for await (const file of cache.materialize(receipt)) out.push(file);
  return out;
}
describe('locked dependency cache', () => {
  it('should quarantine malformed stored receipts with the closed cache error', async () => {
    const f = cacheFixture(); await f.cache.acquire(f.source()); f.stored().receipt = null as never;
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(f.ports.storage.quarantine).toHaveBeenCalledOnce();
  });
  it('should store each installed file once by content and seal the unchanged manifest tree digest', async () => {
    const f = cacheFixture(); const receipt = await f.cache.acquire(f.source());
    const digest = sha256(f.installed.bytes);
    expect(f.ports.storage.putFile).toHaveBeenCalledWith(digest, f.installed.bytes);
    expect(f.stored().manifest).toEqual([{ path: 'pkg/index.js', mode: 292, size: 18, sha256: digest }]);
    expect(receipt.treeSha256).toBe(sha256(JSON.stringify([['pkg/index.js', 292, digest]])));
    expect(JSON.stringify(f.stored())).not.toContain(Buffer.from(f.installed.bytes).toString('base64'));
  });
  it('should admit only a clean verified install and rehash every warm mount file by file', async () => {
    const f = cacheFixture(); const receipt = await f.cache.acquire(f.source());
    expect(f.ports.fetch).toHaveBeenCalledWith(expect.objectContaining({ path: 'node_modules/pkg' }), NPM_RELAY);
    expect(f.ports.cleanInstall).toHaveBeenCalledWith(expect.objectContaining({ recipe: INSTALL_RECIPE }));
    expect(await f.cache.acquire(f.source())).toEqual(receipt); expect(f.ports.cleanInstall).toHaveBeenCalledOnce();
    expect(await collect(f.cache, receipt)).toEqual([f.installed]);
    f.files.set(sha256(f.installed.bytes), Buffer.from('poisoned'));
    await expect(collect(f.cache, receipt)).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(f.ports.storage.quarantine).toHaveBeenCalledOnce();
  });
  it('should refuse missing integrity before fetch or installation', async () => {
    const f = cacheFixture(); f.lock.packages['node_modules/pkg'].integrity = '';
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_integrity_missing' });
    expect(f.ports.fetch).not.toHaveBeenCalled(); expect(f.ports.cleanInstall).not.toHaveBeenCalled();
  });
  it('should refuse altered package bytes before extraction', async () => {
    const f = cacheFixture(); f.ports.fetch = vi.fn(async () => Buffer.from('different bytes'));
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_integrity_mismatch' });
    expect(f.ports.storage.putFile).not.toHaveBeenCalled(); expect(f.ports.storage.admit).not.toHaveBeenCalled();
  });
  it('should not replace literal script-package lock integrity with a host map value', async () => {
    const f = cacheFixture(); const entry = f.lock.packages['node_modules/pkg']; const integrity = entry.integrity;
    Object.assign(entry, { integrity: '', hasInstallScript: true });
    f.ports.evidence = vi.fn(async lockSha256 => ({ lockSha256, digest: 'f'.repeat(64),
      approved: [{ path: 'node_modules/pkg', url: entry.resolved, version: entry.version, integrity }],
      disabledHooks: [{ path: 'node_modules/pkg', version: entry.version, integrity }] }));
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_integrity_missing' });
  });
  it.each(['../escape', '/absolute', 'pkg/../../escape', 'pkg\\escape'])('should reject unsafe dependency path %s', async path => {
    const f = cacheFixture(); f.ports.cleanInstall = vi.fn<CachePorts['cleanInstall']>(async input => {
      await input.sink({ path, mode: 292, bytes: Buffer.alloc(0) }); return { runId: 'run' };
    });
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(f.ports.storage.admit).not.toHaveBeenCalled();
  });
  it('should quarantine receipt tampering and incompatible runtime identities', async () => {
    const f = cacheFixture(); await f.cache.acquire(f.source());
    f.stored().receipt.identity.npmVersion = 'other';
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    for (const tamper of [{ sha256: 'e'.repeat(64) }, { size: 64 * 1024 * 1024 + 1 }, { mode: 511 }]) {
      const g = cacheFixture(); await g.cache.acquire(g.source()); Object.assign(g.stored().manifest[0], tamper);
      await expect(g.cache.acquire(g.source())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    }
  });
  it('should scope identical lockfiles by repository, runtime and policy', async () => {
    const f = cacheFixture(); const first = await f.cache.acquire(f.source());
    const source = f.source(); source.cacheIdentity.storageScopeId = 'another';
    await expect(f.cache.acquire(source)).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(first.key.startsWith(source.cacheIdentity.lockSha256 + '/')).toBe(true);
  });
  it('should construct exactly the Immo public environment with no inherited proxy settings', () => {
    const env = artifactEnvironment();
    expect(Object.keys(env).filter(name => name.startsWith('VITE_')).sort())
      .toEqual(['VITE_API_BASE_URL', 'VITE_ARTIFACT_MODE', 'VITE_BASEMAP_TILE_URL']);
    for (const name of ['GITHUB_PAGES', 'QA_HARNESS', 'API_PROXY_TARGET', 'NPM_TOKEN', 'DATABASE_URL']) expect(env).not.toHaveProperty(name);
    expect(env.VITE_ARTIFACT_MODE).toBe('1'); expect(INSTALL_RECIPE.args).toContain('--ignore-scripts');
  });
});
