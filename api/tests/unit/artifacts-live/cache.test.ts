import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDependencyCache, type CacheIdentity, type CacheObject, type CachePorts } from '../../../src/services/artifacts/live/cache';
import { sha256 } from '../../../src/services/artifacts/live/integrity';
import { artifactEnvironment, BUILDER_IMAGE, INSTALL_RECIPE, NPM_RELAY } from '../../../src/services/artifacts/live/recipes';

function cacheFixture() {
  const bytes = Buffer.from('qualified tarball');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const entry = { version: '1.0.0', resolved: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz', integrity };
  const lock = { lockfileVersion: 3, packages: { '': {}, 'node_modules/pkg': entry } };
  let stored: CacheObject | undefined;
  const ports: CachePorts = {
    signingKey: () => Buffer.alloc(32, 1),
    evidence: vi.fn(async lockSha256 => ({ lockSha256, digest: 'f'.repeat(64), approved: [], disabledHooks: [] })),
    fetch: vi.fn(async () => bytes),
    cleanInstall: vi.fn(async () => ({ runId: 'clean-run', files: [{ path: 'pkg/index.js', type: 'file', mode: 292,
      bytes: Buffer.from('module.exports = 1').toString('base64') }] })),
    storage: { read: vi.fn(async () => stored), admit: vi.fn(async (_key, object) => (stored ??= object)),
      quarantine: vi.fn(async () => { stored = undefined; }) },
  };
  const source = () => {
    const lockfile = Buffer.from(JSON.stringify(lock));
    const cacheIdentity: CacheIdentity = { storageScopeId: 'scope', repoId: 'repo', lockSha256: sha256(lockfile),
      image: BUILDER_IMAGE, platform: 'linux/amd64', nodeVersion: '24', npmVersion: '11', policyRevision: 'p1',
      workspaceTopology: 'root', integrityDigest: 'f'.repeat(64) };
    return { lockfile, cacheIdentity };
  };
  return { lock, ports, source, cache: createDependencyCache(ports), stored: () => stored! };
}
describe('locked dependency cache', () => {
  it('should admit only a clean verified install and rehash every warm mount', async () => {
    const f = cacheFixture(); const receipt = await f.cache.acquire(f.source());
    expect(f.ports.fetch).toHaveBeenCalledWith(expect.objectContaining({ path: 'node_modules/pkg' }), NPM_RELAY);
    expect(f.ports.cleanInstall).toHaveBeenCalledWith(expect.objectContaining({ recipe: INSTALL_RECIPE }));
    expect(await f.cache.acquire(f.source())).toEqual(receipt); expect(f.ports.cleanInstall).toHaveBeenCalledOnce();
    await expect(f.cache.materialize(receipt)).resolves.toHaveLength(1);
    f.stored().files[0].bytes = Buffer.from('poisoned').toString('base64');
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
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
    expect(f.ports.cleanInstall).not.toHaveBeenCalled();
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
    const f = cacheFixture(); f.ports.cleanInstall = vi.fn(async () => ({ runId: 'run',
      files: [{ path, type: 'file', mode: 292, bytes: '' }] }));
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(f.ports.storage.admit).not.toHaveBeenCalled();
  });
  it('should quarantine receipt tampering and incompatible runtime identities', async () => {
    const f = cacheFixture(); await f.cache.acquire(f.source());
    f.stored().receipt.identity.npmVersion = 'other';
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
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
