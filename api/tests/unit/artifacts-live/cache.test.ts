import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDependencyCache, type CacheIdentity, type CacheObject, type CachePorts } from '../../../src/services/artifacts/live/cache';
import { sha256 } from '../../../src/services/artifacts/live/integrity';
import { GB1_QUALIFICATION_PATH } from '../../../src/services/artifacts/live/gb1-qualification';
import { artifactEnvironment, BUILDER_IMAGE, INSTALL_RECIPE, NPM_RELAY } from '../../../src/services/artifacts/live/recipes';

function cacheFixture() {
  const bytes = Buffer.from('qualified tarball');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const entry = { version: '1.0.0', resolved: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz', integrity };
  const manifest = { name: 'fixture', version: '1.0.0', scripts: { 'build:artifact': 'vite build' } };
  const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/pkg': entry } as Record<string, Record<string, unknown>> };
  const rows: { package: string; version: string; integrity: string }[] = [];
  let stored: CacheObject | undefined;
  const ports: CachePorts = {
    signingKey: () => Buffer.alloc(32, 1),
    fetch: vi.fn(async () => bytes),
    cleanInstall: vi.fn<CachePorts['cleanInstall']>(async () => ({ runId: 'clean-run', files: [{ path: 'pkg/index.js', type: 'file', mode: 292,
      bytes: Buffer.from('module.exports = 1').toString('base64') }] })),
    storage: { read: vi.fn(async () => stored), admit: vi.fn(async (_key, object) => (stored ??= object)),
      quarantine: vi.fn(async () => { stored = undefined; }) },
  };
  const source = () => {
    const lockText = JSON.stringify(lock); const lockfile = Buffer.from(lockText);
    const qualification = JSON.stringify({ v: 1, lockSha256: sha256(lockText), postinstallAllowlist: [], scriptQualification: rows });
    const gb1 = { subPath: '', files: { 'sentropic.artifact.json': JSON.stringify({ version: 1, buildScript: 'build:artifact',
      outputDir: 'dist', lockfilePath: 'package-lock.json' }), 'package.json': JSON.stringify(manifest),
      'package-lock.json': lockText, [GB1_QUALIFICATION_PATH]: qualification } };
    const cacheIdentity: CacheIdentity = { storageScopeId: 'scope', repoId: 'repo', lockSha256: sha256(lockfile),
      image: BUILDER_IMAGE, platform: 'linux/amd64', nodeVersion: '24', npmVersion: '11', policyRevision: 'p1',
      workspaceTopology: 'root', integrityDigest: sha256(qualification) };
    return { lockfile, cacheIdentity, stagingRef: 'verified-clean-checkout', gb1 };
  };
  return { lock, rows, ports, source, cache: createDependencyCache(ports), stored: () => stored! };
}
describe('locked dependency cache', () => {
  it('should quarantine malformed stored receipts with the closed cache error', async () => {
    const f = cacheFixture(); await f.cache.acquire(f.source()); f.stored().receipt = null as never;
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(f.ports.storage.quarantine).toHaveBeenCalledOnce();
  });
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
  it('should install a qualified script package with its hook disabled and refuse an unqualified one', async () => {
    const f = cacheFixture(); const entry = f.lock.packages['node_modules/pkg']; entry.hasInstallScript = true;
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'install_script_not_allowlisted' });
    f.rows.push({ package: 'pkg', version: '1.0.0', integrity: String(entry.integrity) });
    await expect(f.cache.acquire(f.source())).resolves.toMatchObject({ inventory: [expect.objectContaining({ path: 'node_modules/pkg' })] });
    expect(f.ports.fetch).toHaveBeenCalledOnce();
  });
  it('should bind the qualification file digest into the cache identity', async () => {
    const f = cacheFixture(); const source = f.source(); source.cacheIdentity.integrityDigest = 'f'.repeat(64);
    await expect(f.cache.acquire(source)).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    expect(f.ports.fetch).not.toHaveBeenCalled();
  });
  it.each(['../escape', '/absolute', 'pkg/../../escape', 'pkg\\escape'])('should reject unsafe dependency path %s', async path => {
    const f = cacheFixture(); f.ports.cleanInstall = vi.fn<CachePorts['cleanInstall']>(async () => ({ runId: 'run',
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
