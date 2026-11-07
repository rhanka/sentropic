import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { fixture, key } from './fixture';
import { createLiveWorker, type QualifiedSupervisor } from '../../../src/services/artifacts/live/worker';
import { withinPhase } from '../../../src/services/artifacts/live/deadline';
import { fetchLockedTarball } from '../../../src/services/artifacts/live/npm-relay';
import { artifactEnvironment, BUILD_RECIPE, buildEnvironment, LIVE_PREBUNDLE_SCRIPT, LIVE_RECIPE, liveViteConfig, NODE_HEAP_OPTIONS, NPM_RELAY,
  PREBUNDLE_RECIPE }
  from '../../../src/services/artifacts/live/recipes';
import { createPostgresCacheStorage } from '../../../src/services/artifacts/live/cache-storage';
import { createPostgresLiveStore } from '../../../src/services/artifacts/live/postgres';

describe('trusted live adapters', () => {
  it('should force fixed offline recipes and read-only verified dependencies', async () => {
    const f = fixture(); const runtime = await f.controller.start(key);
    const calls: string[] = [];
    const supervisor = Object.fromEntries(['phase', 'terminate', 'clear', 'stage', 'dependencies', 'overlay', 'hostFile', 'prebundle', 'dev',
      'build', 'verify', 'renew'].map(name => [name, vi.fn(async () => { calls.push(name); return name === 'build' ? { candidateDigest: 'digest' }
        : name === 'prebundle' ? { prebundled: true } : undefined; })]),
    ) as unknown as QualifiedSupervisor;
    const worker = createLiveWorker(supervisor);
    const source = await f.ports.forge.snapshot(key, 'B'); const cache = await f.ports.cache.acquire(source, runtime);
    await worker.prepare(runtime, source, cache); await worker.prebundle(runtime); await worker.live(runtime);
    expect(supervisor.dependencies).toHaveBeenCalledWith(runtime, cache, { readOnly: true, verifyHash: true });
    expect(supervisor.phase).toHaveBeenCalledWith(runtime, 'offline');
    // The bootstrap writes its frozen pre-bundle script: the only host file stays the live Vite config.
    expect(calls.slice(-3)).toEqual(['hostFile', 'prebundle', 'dev']);
    // FIX3: prebundle and dev see the W4 base (heap 384); the clean build alone sees buildEnvironment() (heap 1024).
    expect(supervisor.prebundle).toHaveBeenCalledWith(runtime, PREBUNDLE_RECIPE, artifactEnvironment());
    expect(supervisor.dev).toHaveBeenCalledWith(runtime, LIVE_RECIPE, artifactEnvironment());
    expect(supervisor.hostFile).toHaveBeenCalledOnce();
    expect(supervisor.hostFile).toHaveBeenCalledWith(runtime, '/tmp/artifact-vite.config.mjs', expect.stringContaining('clientPort:443'));
    // The pre-bundle is its own supervisor op (W3 signature above), after the live config and before the dev server.
    expect(vi.mocked(supervisor.hostFile).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(supervisor.prebundle).mock.invocationCallOrder[0]);
    expect(vi.mocked(supervisor.prebundle).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(supervisor.dev).mock.invocationCallOrder[0]);
    await worker.build(runtime, { id: 'attempt' } as never);
    expect(supervisor.build).toHaveBeenCalledWith(runtime, expect.anything(), BUILD_RECIPE, buildEnvironment());
    expect(vi.mocked(supervisor.build).mock.calls[0][3]).toMatchObject({ NODE_OPTIONS: '--max-old-space-size=1024' });
    expect(supervisor.terminate).toHaveBeenCalledWith(runtime);
    await worker.renew(runtime); expect(supervisor.renew).toHaveBeenCalledWith(runtime);
  });
  it('should pre-bundle in the worker pod with the host config and env before the dev server starts', async () => {
    const f = fixture(); const runtime = await f.controller.start(key); const calls: string[] = [];
    const supervisor = Object.fromEntries(['phase', 'terminate', 'clear', 'stage', 'dependencies', 'overlay', 'hostFile', 'prebundle', 'dev', 'build', 'verify']
      .map(name => [name, vi.fn(async () => { calls.push(name); })])) as unknown as QualifiedSupervisor;
    const previous = process.env.NODE_OPTIONS; process.env.NODE_OPTIONS = '--max-old-space-size=8192';
    try { const worker = createLiveWorker(supervisor); await worker.prebundle(runtime); await worker.live(runtime); }
    finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; }
    expect(calls).toEqual(['hostFile', 'prebundle', 'dev']); expect(supervisor.dependencies).not.toHaveBeenCalled();
    // The bootstrap embeds the frozen pre-bundle script; only the Vite config crosses as a host file.
    expect(supervisor.hostFile).toHaveBeenCalledOnce();
    expect(supervisor.hostFile).toHaveBeenCalledWith(runtime, '/tmp/artifact-vite.config.mjs', expect.any(String));
    expect(supervisor.prebundle).toHaveBeenCalledWith(runtime, PREBUNDLE_RECIPE, artifactEnvironment());
    expect(PREBUNDLE_RECIPE.args).toEqual(['/tmp/artifact-vite-prebundle.mjs']);
    // Same host config and emptyDir cacheDir as the dev server; never the read-only shared dependency mount.
    expect(LIVE_PREBUNDLE_SCRIPT).toContain("configFile:'/tmp/artifact-vite.config.mjs'");
    expect(LIVE_PREBUNDLE_SCRIPT).toContain("existsSync('/tmp/vite-cache/deps/_metadata.json')");
    expect(LIVE_PREBUNDLE_SCRIPT).not.toContain('/dependencies');
    expect(liveViteConfig(runtime.sessionId, runtime.podName)).toContain("cacheDir:'/tmp/vite-cache'");
    for (const env of [artifactEnvironment(), vi.mocked(supervisor.dev).mock.calls[0][2]]) {
      expect(env.NODE_OPTIONS).toBe(NODE_HEAP_OPTIONS);
    }
    expect(NODE_HEAP_OPTIONS).toBe('--max-old-space-size=384');
  });
  it('should stop waiting after the fixed phase deadline without asserting process termination', async () => {
    vi.useFakeTimers();
    try {
      const result = withinPhase(new Promise<void>(() => {}));
      const assertion = expect(result).rejects.toMatchObject({ code: 'builder_unavailable' });
      await vi.advanceTimersByTimeAsync(300_000); await assertion;
    } finally { vi.useRealTimers(); }
  });
  it('should fetch only from the fixed npm relay and verify the approved bytes', async () => {
    const bytes = Buffer.from('tarball');
    const pin = { path: 'node_modules/pkg', version: '1.0.0', url: 'https://registry.npmjs.org/pkg/-/pkg.tgz',
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
    const transport = vi.fn<typeof fetch>(async () => new Response(bytes));
    expect(await fetchLockedTarball(pin, NPM_RELAY, transport)).toEqual(bytes);
    expect(String(transport.mock.calls[0][0])).toBe(NPM_RELAY + 'pkg/-/pkg.tgz');
    expect(transport.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { 'accept-encoding': 'identity' } });
    await expect(fetchLockedTarball({ ...pin, url: 'https://elsewhere.example/pkg.tgz' }, NPM_RELAY, transport))
      .rejects.toMatchObject({ code: 'dependency_integrity_missing' });
    expect(transport).toHaveBeenCalledOnce();
  });
  it('should make incomplete cache objects invisible and detect changed durable blob bytes', async () => {
    const pointers = new Map<string, string>(); const blobs = new Map<string, Uint8Array>();
    const pool = { async query(sql: string, values: string[]) {
      const cacheKey = values[1];
      if (sql.startsWith('SELECT')) return { rows: pointers.has(cacheKey) ? [{ value: pointers.get(cacheKey) }] : [] };
      if (sql.startsWith('DELETE')) { pointers.delete(cacheKey); return { rows: [] }; }
      if (pointers.has(cacheKey)) return { rows: [] };
      pointers.set(cacheKey, values[2]); return { rows: [{ key: cacheKey }] };
    } };
    const storage = createPostgresCacheStorage(pool as never, { async put(ref, bytes) { blobs.set(ref, bytes); },
      async get(ref) { return blobs.get(ref); }, async delete(ref) { blobs.delete(ref); } });
    const cacheKey = 'a'.repeat(64) + '/' + 'b'.repeat(64);
    expect(await storage.read(cacheKey)).toBeUndefined();
    await storage.admit(cacheKey, { receipt: {} as never, manifest: [] });
    expect(await storage.read(cacheKey)).toMatchObject({ manifest: [] });
    blobs.set([...blobs.keys()][0], Buffer.from('changed'));
    await expect(storage.read(cacheKey)).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    await storage.quarantine(cacheKey); expect(await storage.read(cacheKey)).toBeUndefined();
  });
  it('should keep one private content-addressed object per dependency file, apart from the manifest pointers', async () => {
    const blobs = new Map<string, Uint8Array>();
    const storage = createPostgresCacheStorage({ query: vi.fn() } as never, { async put(ref, bytes) { blobs.set(ref, bytes); },
      async get(ref) { return blobs.get(ref); }, async delete(ref) { blobs.delete(ref); } });
    const digest = 'c'.repeat(64);
    await storage.putFile(digest, Buffer.from('x'));
    expect([...blobs.keys()]).toEqual([`dependency-cache/v1/files/${digest}`]);
    expect(await storage.getFile(digest)).toEqual(Buffer.from('x'));
    expect(await storage.getFile('d'.repeat(64))).toBeUndefined();
    for (const bad of ['../x', 'C'.repeat(64), 'c'.repeat(63)]) {
      await expect(storage.putFile(bad, Buffer.from('x'))).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
      await expect(storage.getFile(bad)).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
    }
  });
  it('should reject registry paths that resolve outside the fixed relay before transport', async () => {
    const bytes = Buffer.from('tarball');
    const transport = vi.fn<typeof fetch>(async () => new Response(bytes));
    const pin = { path: 'node_modules/pkg', version: '1.0.0',
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
    for (const path of ['//attacker.example/p.tgz', '///attacker.example/p.tgz']) {
      await expect(fetchLockedTarball({ ...pin, url: 'https://registry.npmjs.org' + path }, NPM_RELAY, transport))
        .rejects.toMatchObject({ code: 'dependency_integrity_missing' });
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it('should list the runtimes that are not DORMANT from the live store namespace', async () => {
    const row = (scope: string, artifact: string, phase: string, ownerId: string) =>
      ({ key: JSON.stringify([scope, artifact]), value: JSON.stringify({ runtime: { phase, ownerId } }) });
    const query = vi.fn(async () => ({ rows: [row('s', 'a', 'LIVE', 'alice'), row('s', 'b', 'DORMANT', 'bob'),
      row('t', 'c', 'RECOVERING', 'carol')] }));
    expect(await createPostgresLiveStore({ query } as never).active()).toEqual([
      { key: { storageScopeId: 's', artifactId: 'a' }, ownerId: 'alice', phase: 'LIVE' },
      { key: { storageScopeId: 't', artifactId: 'c' }, ownerId: 'carol', phase: 'RECOVERING' }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('control.artifact_host_kv'), ['artifact-live-runtime/v1']);
  });
});
