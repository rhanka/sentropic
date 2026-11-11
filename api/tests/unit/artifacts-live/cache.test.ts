import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDependencyCache, type CacheIdentity, type CacheObject, type CachePorts, type CacheReceipt,
  type DependencyFile } from '../../../src/services/artifacts/live/cache';
import { sha256 } from '../../../src/services/artifacts/live/integrity';
import type { IntegrityPin } from '../../../src/services/artifacts/live/integrity';
import { GB1_QUALIFICATION_PATH } from '../../../src/services/artifacts/live/gb1-qualification';
import { artifactEnvironment, BUILDER_IMAGE, INSTALL_RECIPE, NPM_RELAY } from '../../../src/services/artifacts/live/recipes';
import type { InstallBudget, InstallStepFields } from '../../../src/services/artifacts/live/deadline';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function cacheFixture(budget?: InstallBudget, options?: { log?: (fields: InstallStepFields) => void; now?: () => number }) {
  const bytes = Buffer.from('qualified tarball');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const entry = { version: '1.0.0', resolved: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz', integrity };
  const manifest = { name: 'fixture', version: '1.0.0', scripts: { 'build:artifact': 'vite build' } };
  const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/pkg': entry } as Record<string, Record<string, unknown>> };
  const rows: { package: string; version: string; integrity: string }[] = [];
  let stored: CacheObject | undefined;
  const files = new Map<string, Uint8Array>();
  const installed: DependencyFile = { path: 'pkg/index.js', mode: 292, bytes: Buffer.from('module.exports = 1') };
  const ports: CachePorts = {
    signingKey: () => Buffer.alloc(32, 1),
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
    const lockText = JSON.stringify(lock); const lockfile = Buffer.from(lockText);
    const qualification = JSON.stringify({ v: 1, lockSha256: sha256(lockText), postinstallAllowlist: [], scriptQualification: rows });
    const gb1 = { subPath: '', files: { 'sentropic.artifact.json': JSON.stringify({ version: 1, buildScript: 'build:artifact',
      outputDir: 'dist', lockfilePath: 'package-lock.json' }), 'package.json': JSON.stringify(manifest),
      'package-lock.json': lockText, [GB1_QUALIFICATION_PATH]: qualification } };
    const cacheIdentity: CacheIdentity = { storageScopeId: 'scope', repoId: 'repo', lockSha256: sha256(lockfile),
      image: BUILDER_IMAGE, platform: 'linux/amd64', nodeVersion: '24', npmVersion: '11', policyRevision: 'p1',
      workspaceTopology: 'root', integrityDigest: sha256(qualification), installWorkspaces: [] };
    return { lockfile, cacheIdentity, stagingRef: 'verified-clean-checkout', gb1 };
  };
  return { lock, rows, ports, source, files, installed, cache: createDependencyCache(ports, budget, options), stored: () => stored! };
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
    expect(f.ports.fetch).toHaveBeenCalledWith(expect.objectContaining({ path: 'node_modules/pkg' }), NPM_RELAY,
      expect.any(AbortSignal));
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
  it('should keep a progressing cold install alive past one stall window', async () => {
    const f = cacheFixture({ stallMs: 100, ceilingMs: 5_000 });
    const extra = f.lock.packages['node_modules/pkg'] as Record<string, unknown>;
    f.lock.packages = { '': f.lock.packages[''], 'node_modules/pkg': { ...extra }, 'node_modules/a': { ...extra },
      'node_modules/b': { ...extra }, 'node_modules/c': { ...extra } };
    const fetch = f.ports.fetch;
    f.ports.fetch = vi.fn(async (pin: IntegrityPin, relay: typeof NPM_RELAY) => { await delay(25); return fetch(pin, relay); });
    const receipt = await f.cache.acquire(f.source());
    expect(receipt.inventory).toHaveLength(4);
    expect(f.ports.fetch).toHaveBeenCalledTimes(4);
    expect(f.stored().manifest).toHaveLength(1);
  });
  it('should not cut a slow-start cold install before the first progress', async () => {
    // Heavy-queue admission, the forge re-download and the source transfer show no progress for longer than one
    // stall window on a healthy cold start; the stall arms only on the first tarball, so the start survives.
    const f = cacheFixture({ stallMs: 50, ceilingMs: 5_000 });
    f.ports.cleanInstall = vi.fn<CachePorts['cleanInstall']>(async input => {
      await delay(150);
      for await (const tarball of input.tarballs) expect(tarball.bytes).toEqual(expect.any(Uint8Array));
      await input.sink(f.installed);
      return { runId: 'slow-start' };
    });
    const receipt = await f.cache.acquire(f.source());
    expect(receipt.runId).toBe('slow-start');
    expect(f.ports.storage.admit).toHaveBeenCalledOnce();
  });
  it('should hand the watchdog abort signal to fetch and cleanInstall', async () => {
    const f = cacheFixture();
    await f.cache.acquire(f.source());
    expect(f.ports.cleanInstall).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const signal = vi.mocked(f.ports.cleanInstall).mock.calls[0][0].signal;
    const fetchCalls = vi.mocked(f.ports.fetch).mock.calls;
    expect(fetchCalls.length).toBeGreaterThan(0);
    for (const call of fetchCalls) expect(call[2]).toBe(signal);
  });
  it('should fail a stalled cold install with the phase in the reason and admit nothing', async () => {
    // One fetched tarball arms the stall; the hang after it trips the watchdog instead of waiting for the ceiling.
    const f = cacheFixture({ stallMs: 50, ceilingMs: 5_000 });
    f.ports.cleanInstall = vi.fn<CachePorts['cleanInstall']>(async input => {
      for await (const tarball of input.tarballs) { expect(tarball.bytes).toBeInstanceOf(Uint8Array); break; }
      input.progress?.step?.('tarball_stream');
      await new Promise<never>(() => {});
    });
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'builder_unavailable',
      reason: 'phase_timeout:install:tarball_stream' });
    expect(f.ports.storage.admit).not.toHaveBeenCalled();
    expect(f.ports.storage.putFile).not.toHaveBeenCalled();
    expect(f.ports.storage.quarantine).not.toHaveBeenCalled();
  });
  it('should abort the watchdog signal on a cut install so nothing runs on', async () => {
    const f = cacheFixture({ stallMs: 50, ceilingMs: 5_000 });
    let observed: AbortSignal | undefined;
    f.ports.cleanInstall = vi.fn<CachePorts['cleanInstall']>(async input => {
      observed = input.signal;
      for await (const tarball of input.tarballs) { expect(tarball.bytes).toBeInstanceOf(Uint8Array); break; }
      input.progress?.step?.('tarball_stream');
      await new Promise<never>(() => {});
    });
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'builder_unavailable',
      reason: 'phase_timeout:install:tarball_stream' });
    expect(observed?.aborted).toBe(true);
    expect(f.ports.storage.admit).not.toHaveBeenCalled();
  });
  it('should fail a suspended-but-hung install at the ceiling without poisoning the cache', async () => {
    const f = cacheFixture({ stallMs: 10_000, ceilingMs: 60 });
    f.ports.cleanInstall = vi.fn<CachePorts['cleanInstall']>(async input => {
      for await (const tarball of input.tarballs) expect(tarball.bytes).toBeInstanceOf(Uint8Array);
      input.progress?.suspendStall(true);
      input.progress?.step?.('recipe');
      await new Promise<never>(() => {});
    });
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'builder_unavailable',
      reason: 'phase_timeout:install:recipe' });
    expect(f.ports.storage.admit).not.toHaveBeenCalled();
  });
  it('should name cache_lookup when the lookup hangs past its own bound (11/11 preprod)', async () => {
    // The 11/11 install never reported progress: the lookup sets its step before the first DB/S3 read, so its
    // own 120 s bound (exercised here with a short lookupMs) names the hanging sub-step well before the ceiling.
    const lines: InstallStepFields[] = [];
    const f = cacheFixture({ stallMs: 10_000, ceilingMs: 5_000, lookupMs: 50 },
      { log: fields => lines.push(fields) });
    f.ports.storage.read = vi.fn(async () => new Promise<never>(() => {}));
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'builder_unavailable',
      reason: 'phase_timeout:install:cache_lookup' });
    expect(f.ports.storage.admit).not.toHaveBeenCalled();
    expect(f.ports.cleanInstall).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'artifact_live_install_step', step: 'cache_lookup', outcome: 'fail',
      reason: 'builder_unavailable:phase_timeout:install:cache_lookup' });
  });
  it('should bound cache_admit below the ceiling with a step-named fail line', async () => {
    const lines: InstallStepFields[] = [];
    const f = cacheFixture({ stallMs: 10_000, ceilingMs: 5_000, admitMs: 50 },
      { log: fields => lines.push(fields) });
    f.ports.storage.admit = vi.fn(async () => new Promise<never>(() => {}));
    await expect(f.cache.acquire(f.source())).rejects.toMatchObject({ code: 'builder_unavailable',
      reason: 'phase_timeout:install:cache_admit' });
    expect(f.ports.cleanInstall).toHaveBeenCalledOnce();
    expect(lines.some(line => line.step === 'cache_lookup' && line.outcome === 'ok')).toBe(true);
    expect(lines.at(-1)).toMatchObject({ msg: 'artifact_live_install_step', step: 'cache_admit', outcome: 'fail',
      reason: 'builder_unavailable:phase_timeout:install:cache_admit' });
  });
  it('should log cache_lookup ok and cache_admit ok with file and byte counts on a cold install', async () => {
    const lines: InstallStepFields[] = [];
    const f = cacheFixture(undefined, { log: fields => lines.push(fields) });
    await f.cache.acquire(f.source());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ msg: 'artifact_live_install_step', step: 'cache_lookup', outcome: 'ok' });
    expect(lines[1]).toMatchObject({ msg: 'artifact_live_install_step', step: 'cache_admit', outcome: 'ok' });
    expect(lines[1].files).toBe(1);
    expect(lines[1].bytes).toBeGreaterThan(0);
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
      .toEqual(['VITE_API_BASE_URL', 'VITE_ARTIFACT_MODE']);
    for (const name of ['GITHUB_PAGES', 'QA_HARNESS', 'API_PROXY_TARGET', 'NPM_TOKEN', 'DATABASE_URL']) expect(env).not.toHaveProperty(name);
    expect(env.VITE_ARTIFACT_MODE).toBe('1'); expect(INSTALL_RECIPE.args).toContain('--ignore-scripts');
  });
});
