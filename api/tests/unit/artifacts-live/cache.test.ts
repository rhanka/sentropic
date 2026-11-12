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
  const archives = new Map<string, Uint8Array>();
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
      putFile: vi.fn(async (digest, data) => { files.set(digest, data); }), getFile: vi.fn(async digest => files.get(digest)),
      putArchive: vi.fn(async (ref, data) => { archives.set(ref, data); }),
      getArchive: vi.fn(async ref => archives.get(ref)),
      putSource: vi.fn(async (ref, data) => { archives.set(ref, data); }),
      getSource: vi.fn(async ref => archives.get(ref)),
      putTarball: vi.fn(async (ref, data) => { archives.set(ref, data); }),
      getTarball: vi.fn(async ref => archives.get(ref)) },
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
describe('sealed user path (requireSealed)', () => {
  it('should throw typed cache_not_prewarmed on a miss without fetching or installing', async () => {
    const f = cacheFixture();
    const started = Date.now();
    await expect(f.cache.requireSealed!(f.source())).rejects.toMatchObject({ code: 'cache_not_prewarmed',
      reason: f.source().cacheIdentity.lockSha256 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(f.ports.fetch).not.toHaveBeenCalled();
    expect(f.ports.cleanInstall).not.toHaveBeenCalled();
    expect(f.ports.storage.admit).not.toHaveBeenCalled();
  });
  it('should quarantine a corrupt sealed entry and throw cache_not_prewarmed', async () => {
    const f = cacheFixture(); await f.cache.acquire(f.source()); f.stored().receipt = null as never;
    await expect(f.cache.requireSealed!(f.source())).rejects.toMatchObject({ code: 'cache_not_prewarmed' });
    expect(f.ports.storage.quarantine).toHaveBeenCalledOnce();
    expect(f.ports.cleanInstall).toHaveBeenCalledOnce();
  });
  it('should return the sealed receipt on a hit without a second install', async () => {
    const f = cacheFixture(); const receipt = await f.cache.acquire(f.source());
    await expect(f.cache.requireSealed!(f.source())).resolves.toEqual(receipt);
    expect(f.ports.cleanInstall).toHaveBeenCalledOnce();
    expect(f.ports.fetch).toHaveBeenCalled();
  });
  it('should quarantine an incompatible runtime identity as unsealed instead of invalid', async () => {
    const f = cacheFixture(); await f.cache.acquire(f.source());
    const source = f.source(); source.cacheIdentity.npmVersion = 'other';
    await expect(f.cache.requireSealed!(source)).rejects.toMatchObject({ code: 'cache_not_prewarmed' });
    expect(f.ports.storage.quarantine).toHaveBeenCalledOnce();
  });
  it('should refuse a tampered warm entry as unsealed', async () => {
    const f = cacheFixture(); await f.cache.acquire(f.source());
    f.stored().manifest[0] = { ...f.stored().manifest[0], size: 64 * 1024 * 1024 + 1 };
    await expect(f.cache.requireSealed!(f.source())).rejects.toMatchObject({ code: 'cache_not_prewarmed' });
  });
  it('should preserve builder_unavailable on S3 outage instead of cache_not_prewarmed', async () => {
    const { LiveError } = await import('../../../src/services/artifacts/live/records');
    const f = cacheFixture();
    f.ports.storage.read = async () => { throw new LiveError('builder_unavailable', 'cache_s3_unavailable'); };
    await expect(f.cache.requireSealed!(f.source())).rejects.toMatchObject({ code: 'builder_unavailable',
      reason: 'cache_s3_unavailable' });
    expect(f.ports.storage.quarantine).not.toHaveBeenCalled();
  });
  it('should fall back to acquire when the sealed path is disabled or unimplemented', async () => {
    const { requireUserCache, sealedUserPathEnabled } = await import('../../../src/services/artifacts/live/cache');
    expect(sealedUserPathEnabled()).toBe(true);
    expect(sealedUserPathEnabled({})).toBe(true);
    const f = cacheFixture();
    const restore = process.env.ARTIFACT_BUILDER_SEALED_CACHE;
    try {
      process.env.ARTIFACT_BUILDER_SEALED_CACHE = '0';
      expect(sealedUserPathEnabled()).toBe(false);
      const receipt = await requireUserCache(f.cache, f.source());
      expect(receipt.runId).toBe('clean-run');
      expect(f.ports.cleanInstall).toHaveBeenCalledOnce();
    } finally {
      if (restore === undefined) delete process.env.ARTIFACT_BUILDER_SEALED_CACHE;
      else process.env.ARTIFACT_BUILDER_SEALED_CACHE = restore;
    }
    const g = cacheFixture();
    const receipt = await requireUserCache({ ...g.cache, requireSealed: undefined }, g.source());
    expect(receipt.runId).toBe('clean-run');
    expect(g.ports.cleanInstall).toHaveBeenCalledOnce();
  });
});

describe('prewarm seal (tar.zst unit)', () => {
  it('should seal one deterministic archive and materialize it back file by file', async () => {
    const f = cacheFixture();
    const receipt = await f.cache.seal!(f.source());
    expect(receipt.archive).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(receipt.archive!.ref).toBe(
      `artifact-builder-cache/v1/${receipt.key}/sealed-${receipt.treeSha256}.tar.zst`);
    expect(f.ports.storage.putFile).not.toHaveBeenCalled();
    expect(await collect(f.cache, receipt)).toEqual([f.installed]);
    expect(f.stored().manifest).toEqual([{ path: 'pkg/index.js', mode: 292, size: 18,
      sha256: sha256(f.installed.bytes) }]);
  });
  it('should produce the same archive sha256 for two seals of one tree', async () => {
    const f = cacheFixture(); const g = cacheFixture();
    const first = await f.cache.seal!(f.source());
    const second = await g.cache.seal!(g.source());
    expect(second.archive!.sha256).toBe(first.archive!.sha256);
    expect(second.archive!.bytes).toBe(first.archive!.bytes);
  });
  it('should join an existing sealed entry without reinstalling', async () => {
    const f = cacheFixture();
    const sealed = await f.cache.seal!(f.source());
    const joined = await f.cache.seal!(f.source());
    expect(joined).toEqual(sealed);
    expect(f.ports.cleanInstall).toHaveBeenCalledOnce();
    await expect(f.cache.requireSealed!(f.source())).resolves.toEqual(sealed);
  });
  it('should quarantine a tampered archive as sealed_unit_invalid', async () => {
    const f = cacheFixture();
    const receipt = await f.cache.seal!(f.source());
    expect(f.ports.storage.putArchive).toHaveBeenCalledOnce();
    const ref = receipt.archive!.ref;
    const stored = new Map<string, Uint8Array>();
    stored.set(ref, Buffer.from('tampered'));
    f.ports.storage.getArchive = vi.fn(async (key: string) => stored.get(key));
    await expect(collect(f.cache, receipt)).rejects.toMatchObject({ code: 'sealed_unit_invalid' });
    expect(f.ports.storage.quarantine).toHaveBeenCalledWith(receipt.key);
  });
  it('should prefetch tarballs with a bounded window while admitting them in order', async () => {
    const f = cacheFixture();
    const extra = f.lock.packages['node_modules/pkg'] as Record<string, unknown>;
    for (let i = 0; i < 9; i++) {
      f.lock.packages[`node_modules/p${i}`] = { ...extra, version: `1.0.${i}`,
        resolved: `https://registry.npmjs.org/p${i}/-/p${i}-1.0.0.tgz` };
    }
    let inFlight = 0; let peak = 0;
    const inner = f.ports.fetch;
    f.ports.fetch = vi.fn(async (pin, relay, signal) => {
      inFlight++; peak = Math.max(peak, inFlight);
      try { await delay(10); return inner(pin, relay, signal); } finally { inFlight--; }
    });
    const { SEAL_PREFETCH_WINDOW } = await import('../../../src/services/artifacts/live/cache');
    const receipt = await f.cache.seal!(f.source());
    expect(receipt.inventory).toHaveLength(10);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(SEAL_PREFETCH_WINDOW);
    // All ten pins share one integrity: the first window fills with relay fetches, the tail joins on the
    // stored tarball once the first put lands.
    expect(f.ports.fetch).toHaveBeenCalledTimes(SEAL_PREFETCH_WINDOW);
  });
  it('should reuse stored tarballs without touching the relay, refetching corrupt entries', async () => {
    const { tarballRef } = await import('../../../src/services/artifacts/live/cache-storage');
    const f = cacheFixture();
    await f.cache.seal!(f.source());
    expect(f.ports.fetch).toHaveBeenCalledTimes(1);
    // A new lockfile sharing the pin: the common tarball serves from the store, only the new pin crosses the relay.
    const g = cacheFixture();
    g.ports.storage = f.ports.storage;
    const extra = g.lock.packages['node_modules/pkg'] as Record<string, unknown>;
    const integrity = String(extra.integrity);
    const extraBytes = Buffer.from('extra tarball');
    const extraSri = `sha512-${createHash('sha512').update(extraBytes).digest('base64')}`;
    g.lock.packages['node_modules/extra'] = { version: '9.9.9',
      resolved: 'https://registry.npmjs.org/extra/-/extra-9.9.9.tgz', integrity: extraSri };
    const innerFetch = g.ports.fetch;
    g.ports.fetch = vi.fn(async (pin, relay, signal) =>
      (pin.path === 'node_modules/extra' ? extraBytes : innerFetch(pin, relay, signal)));
    g.ports.cleanInstall = vi.fn(async (input: any) => {
      for await (const tarball of input.tarballs) void tarball;
      await input.sink(g.installed);
      return { runId: 'run' };
    });
    await g.cache.seal!(g.source());
    const fetch = vi.mocked(g.ports.fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0].path).toBe('node_modules/extra');
    // A corrupt store entry refetches from the relay instead of failing the seal.
    await f.ports.storage.putTarball(tarballRef(integrity), Buffer.from('garbage'));
    const h = cacheFixture();
    h.ports.storage = f.ports.storage;
    h.lock.packages['node_modules/other'] = { ...extra, version: '8.8.8',
      resolved: 'https://registry.npmjs.org/other/-/other-8.8.8.tgz' };
    h.ports.cleanInstall = vi.fn(async (input: any) => {
      for await (const tarball of input.tarballs) void tarball;
      await input.sink(h.installed);
      return { runId: 'run' };
    });
    await h.cache.seal!(h.source());
    expect(vi.mocked(h.ports.fetch)).toHaveBeenCalledTimes(2);
  });
  it('should cut a stalled seal with phase_timeout:seal:<step>', async () => {
    const lines: InstallStepFields[] = [];
    const f = cacheFixture({ stallMs: 50, ceilingMs: 5_000 }, { log: fields => lines.push(fields) });
    f.ports.cleanInstall = vi.fn(async input => {
      for await (const tarball of input.tarballs) expect(tarball.bytes).toBeInstanceOf(Uint8Array);
      input.progress?.step?.('recipe');
      await new Promise<never>(() => {});
    });
    await expect(f.cache.seal!(f.source(), { stallMs: 50, ceilingMs: 5_000 })).rejects.toMatchObject({
      code: 'builder_unavailable', reason: 'phase_timeout:seal:recipe' });
    expect(f.ports.storage.admit).not.toHaveBeenCalled();
    expect(f.ports.storage.putArchive).not.toHaveBeenCalled();
    // Only the lookup completed with a line; the stall cut the install inside cleanInstall (its inner
    // steps keep their own lines on the real supervisor path) with the seal-named budget reason.
    expect(lines).toMatchObject([{ step: 'cache_lookup', outcome: 'ok' }]);
  });
});

describe('locked dependency cache identity', () => {
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
});
