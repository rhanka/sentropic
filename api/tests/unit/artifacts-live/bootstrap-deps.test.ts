import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, readlink, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDependencyCache, type CacheObject, type DependencyFile } from '../../../src/services/artifacts/live/cache';
import { BUILDER_IMAGE, INSTALL_RECIPE, installEnvironment } from '../../../src/services/artifacts/live/recipes';
import { tarZst } from '../../../src/services/artifacts/live/supervisor-transfer';
import { fakeSpawn, file, harness, type Spawned } from './bootstrap-harness';
import { gb1Descriptor } from './fixture';

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
async function install(pod: Pod, files = source, staged = tarballs, workspaces: string[] = []) {
  const sent = await pod.transfer('install', files);
  const cache = await pod.transfer('npm-cache', staged.map(t => t.file));
  return pod.send('install', { recipe: 'install', runId: 'run-1', source: sent, cache, workspaces,
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
  it('should store only SRI-verified tarballs content-addressed and run the frozen offline install with the install env', async () => {
    const calls: Spawned[] = []; const pod = await harness({ spawn: fakeSpawn(calls, async () => 1) });
    expect(await install(pod)).toEqual({ exitCode: 1, signal: null, output: '' });
    const hex = createHash('sha512').update(tgz.vite).digest('hex');
    expect(await readFile(pod.path('tmp/npm-cache/_cacache/content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4)))).toEqual(tgz.vite);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ executable: INSTALL_RECIPE.executable, args: INSTALL_RECIPE.args,
      options: { cwd: pod.path('tmp/install'), shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: installEnvironment() } });
    expect(calls[0].options.env.NODE_OPTIONS).toBe('--max-old-space-size=1024');
    await expect(install(pod)).rejects.toThrow('failed:already_installed');
  });

  it('should return the bounded scrubbed install tail with the exit code', async () => {
    const pod = await harness({ spawn: fakeSpawn([], async () => ({ code: 1, stdout: `${'z'.repeat(9000)}\n`,
      stderr: 'disk full //registry.npmjs.org/:_authToken=secret-tail\nnpm error code ENOSPC\n' })) });
    const done = await install(pod);
    expect(done.exitCode).toBe(1); expect(done.signal).toBe(null);
    const output = Buffer.from(done.output, 'base64').toString('utf8');
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(4096);
    expect(output).toContain('npm error code ENOSPC');
    expect(output).toContain('//registry.npmjs.org/:_authToken=[redacted]');
    expect(output).not.toContain('secret-tail');
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
    const objects = new Map<string, CacheObject>(); const blobs = new Map<string, Uint8Array>();
    const cache = createDependencyCache({ signingKey: () => new Uint8Array(32).fill(7),
      fetch: async pin => (pin.path.endsWith('vite') ? tgz.vite : tgz.x),
      cleanInstall: async ({ tarballs: pins, sink }) => {
        expect(await pod.send('clear', { paths: ['/tmp'] })).toEqual({ cleared: ['/tmp'] });
        const staged = [];
        for await (const t of pins) staged.push({ file: file(`${staged.length}.tgz`, Buffer.from(t.bytes), 0o444), integrity: t.pin.integrity });
        expect(await install(pod, source, staged)).toEqual({ exitCode: 0, signal: null, output: '' });
        const exported = await snapshot(pod, 'dependencies');
        await pod.send('clear', { paths: ['/tmp'] });
        for (const f of exported) await sink({ path: f.path, mode: f.mode & 0o111 ? 365 : 292, bytes: f.bytes });
        return { runId: 'run-1' };
      },
      storage: { read: async key => objects.get(key), admit: async (key, object) => { objects.set(key, object); return object; },
        quarantine: async () => undefined, putFile: async (digest, bytes) => { blobs.set(digest, bytes); },
        getFile: async digest => blobs.get(digest),
        putArchive: async (ref, bytes) => { blobs.set(ref, bytes); }, getArchive: async ref => blobs.get(ref),
        putSource: async (ref, bytes) => { blobs.set(ref, bytes); }, getSource: async ref => blobs.get(ref),
        putTarball: async (ref, bytes) => { blobs.set(ref, bytes); }, getTarball: async ref => blobs.get(ref) } });
    const identity = { storageScopeId: 's', repoId: 'r', lockSha256: createHash('sha256').update(lock).digest('hex'), platform: 'linux-x64',
      nodeVersion: '24', npmVersion: '11', image: BUILDER_IMAGE, policyRevision: 'p1', workspaceTopology: 'ui', integrityDigest: createHash('sha256').digest('hex'), installWorkspaces: [] };
    // GB1 at the pinned commit: no script entry in the lock, so no qualification file (digest of zero bytes).
    const gb1 = { subPath: '', files: { 'sentropic.artifact.json': gb1Descriptor, 'package-lock.json': lock.toString(),
      'ui/package.json': '{"name":"ui"}',
      'package.json': JSON.stringify({ name: 'root', workspaces: ['ui'], scripts: { 'build:artifact': 'vite build' } }) } };
    const receipt = await cache.acquire({ lockfile: lock, cacheIdentity: identity, stagingRef: 'ref', gb1 });
    const files: DependencyFile[] = [];
    for await (const f of cache.materialize(receipt)) files.push(f);
    expect(files.map(f => [f.path, f.mode])).toEqual([['node_modules/vite/bin/vite.js', 365], ['node_modules/vite/package.json', 292],
      ['ui/node_modules/x/index.js', 292]]);
    const tree = files.map(f => file(f.path, Buffer.from(f.bytes), f.mode === 365 ? 0o555 : 0o444));
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

describe('pod bootstrap agent: workspace-scoped installs', () => {
  const viteBytes = Buffer.from('scoped-vite-tarball');
  const xNestedBytes = Buffer.from('scoped-x-nested-tarball');
  const xHoistedBytes = Buffer.from('scoped-x-hoisted-tarball');
  const sriOf = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const urlOf = (name: string) => `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`;
  const scopedLock = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: {
    '': { name: 'root', workspaces: ['ui'] },
    ui: { name: 'ui', version: '1.0.0', dependencies: { vite: '^1.0.0', x: '^1.0.0' } },
    'node_modules/ui': { resolved: 'ui', link: true },
    'node_modules/vite': { version: '1.0.0', resolved: urlOf('vite'), integrity: sriOf(viteBytes) },
    'ui/node_modules/x': { version: '1.0.0', resolved: urlOf('x-nested'), integrity: sriOf(xNestedBytes) },
    'node_modules/x': { version: '9.9.9', resolved: urlOf('x-hoisted'), integrity: sriOf(xHoistedBytes) },
  } }));
  const scopedSource = [file('package.json', '{"workspaces":["ui"]}'), file('package-lock.json', scopedLock),
    file('ui/package.json', '{"name":"ui","dependencies":{"vite":"^1.0.0","x":"^1.0.0"}}')];
  const scopedTarballs = [
    { file: file('0.tgz', viteBytes, 0o444), integrity: sriOf(viteBytes) },
    { file: file('1.tgz', xNestedBytes, 0o444), integrity: sriOf(xNestedBytes) },
  ];

  it('should run npm ci with sorted workspace flags and prefer the nested lock entry', async () => {
    const calls: Spawned[] = [];
    const pod = await harness({ spawn: fakeSpawn(calls, async () => 0) });
    await expect(install(pod, scopedSource, scopedTarballs, ['ui'])).resolves.toEqual({ exitCode: 0, signal: null, output: '' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ executable: INSTALL_RECIPE.executable,
      args: [...INSTALL_RECIPE.args, '--workspace=ui'] });
  });

  it('should refuse before npm when an expected scoped tarball is not staged', async () => {
    const calls: Spawned[] = [];
    const pod = await harness({ spawn: fakeSpawn(calls, async () => 0) });
    await expect(install(pod, scopedSource, scopedTarballs.slice(0, 1), ['ui']))
      .rejects.toThrow('integrity:integrity_missing');
    expect(calls).toEqual([]);
  });

  it('should refuse an unknown workspace and an invalid workspace shape before npm', async () => {
    const calls: Spawned[] = [];
    const spawn = fakeSpawn(calls, async () => 0);
    await expect(install(await harness({ spawn }), scopedSource, scopedTarballs, ['missing']))
      .rejects.toThrow('failed:unknown_workspace');
    await expect(install(await harness({ spawn }), scopedSource, scopedTarballs, ['../x']))
      .rejects.toThrow('failed:invalid_args');
    expect(calls).toEqual([]);
  });
});

describe('pod bootstrap agent: sealed-unit extraction', () => {
  const members = [
    { path: 'node_modules/a/index.js', mode: 292 as const, bytes: Buffer.from('module.exports = 1') },
    { path: 'node_modules/a/bin/cli.js', mode: 365 as const, bytes: Buffer.from('#!/usr/bin/env node') },
  ];
  /** Cache-format tree digest over [path, mode, sha256] rows, as the seal admits it. */
  const treeOf = (files: { path: string; mode: 292 | 365; bytes: Buffer }[]) => createHash('sha256')
    .update(JSON.stringify(files.map(f => [f.path, f.mode,
      createHash('sha256').update(f.bytes).digest('hex')]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1))))
    .digest('hex');
  async function archive(files: typeof members = members) {
    const chunks: Uint8Array[] = [];
    async function* stream() { for (const f of files) yield f; }
    for await (const chunk of tarZst(stream())) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  it('should extract a sealed tar.zst under dependencies with digest verification', async () => {
    const pod = await harness();
    const minimalLock = JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'root' } } });
    await pod.send('stage', { ...await pod.transfer('workspace', [file('package-lock.json', minimalLock)]),
      headSha: HEAD, treeSha: HEAD });
    const bytes = await archive();
    const sent = await pod.transfer('archive', [file('sealed.tar.zst', bytes, 0o444)]);
    const done = await pod.send('extractArchive', { ...sent, tree: treeOf(members), root: 'dependencies' });
    expect(done).toMatchObject({ files: members.length, bytes: members.reduce((n, f) => n + f.bytes.length, 0) });
    expect(await readFile(pod.path('dependencies/node_modules/a/index.js'))).toEqual(members[0]!.bytes);
    expect(await readFile(pod.path('dependencies/node_modules/a/bin/cli.js'))).toEqual(members[1]!.bytes);
    expect((await stat(pod.path('dependencies/node_modules/a/bin/cli.js'))).mode & 0o777).toBe(0o555);
    expect((await stat(pod.path('dependencies/node_modules/a/index.js'))).mode & 0o777).toBe(0o444);
  });
  it('should refuse a tampered archive, a wrong tree digest, a bad root and a multi-file transfer', async () => {
    const pod = await harness();
    const minimalLock = JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'root' } } });
    await pod.send('stage', { ...await pod.transfer('workspace', [file('package-lock.json', minimalLock)]),
      headSha: HEAD, treeSha: HEAD });
    const bytes = await archive();
    const tampered = Buffer.from(bytes); tampered[tampered.length - 1] ^= 0xff;
    const send = (data: Buffer, args: Record<string, unknown>) => pod.transfer('archive', [file('sealed.tar.zst', data, 0o444)])
      .then(sent => pod.send('extractArchive', { ...sent, tree: treeOf(members), root: 'dependencies', ...args }));
    await expect(send(tampered, {})).rejects.toThrow();
    await expect(send(bytes, { tree: 'e'.repeat(64) })).rejects.toThrow('failed:digest_mismatch');
    await expect(send(bytes, { root: 'install' })).rejects.toThrow('failed:invalid_args');
    const two = await pod.transfer('archive', [file('a.tar.zst', bytes, 0o444), file('b.tar.zst', bytes, 0o444)]);
    await expect(pod.send('extractArchive', { ...two, tree: treeOf(members), root: 'workspace' }))
      .rejects.toThrow('failed:invalid_archive');
  });
  it('should refuse a link entry inside the archive', async () => {
    const header = Buffer.alloc(512, 0);
    header.write('node_modules/link', 0, 100, 'utf8');
    header.write('0000444', 100, 7, 'utf8');
    header.write('00000000000', 124, 11, 'utf8');
    header.write('        ', 148, 8, 'utf8'); header[156] = 0x32; header.write('ustar\0', 257, 6, 'utf8');
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 0x20 : header[i]!;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
    const { createZstdCompress } = await import('node:zlib') as unknown as {
      createZstdCompress(): NodeJS.ReadWriteStream;
    };
    const { Readable } = await import('node:stream');
    const chunks: Uint8Array[] = [];
    for await (const chunk of Readable.from([header, Buffer.alloc(512, 0)]).pipe(createZstdCompress())) {
      chunks.push(chunk as Uint8Array);
    }
    const pod = await harness();
    const sent = await pod.transfer('archive', [file('sealed.tar.zst', Buffer.concat(chunks), 0o444)]);
    await expect(pod.send('extractArchive', { ...sent, tree: 'e'.repeat(64), root: 'workspace' }))
      .rejects.toThrow('failed:invalid_archive');
  });
  it('should seal the installed tree in-pod and page the archive back via sealFetch', async () => {
    const pod = await harness({ spawn: fakeSpawn([], npmCi) });
    expect(await install(pod)).toEqual({ exitCode: 0, signal: null, output: '' });
    const sealed = await pod.send('sealDependencies', {}) as { files: number; bytes: number;
      archiveBytes: number; archiveSha256: string; treeSha256: string };
    expect(sealed.files).toBeGreaterThan(0);
    expect(sealed.archiveBytes).toBeGreaterThan(0);
    expect(sealed.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sealed.treeSha256).toMatch(/^[a-f0-9]{64}$/);
    const chunks: Buffer[] = []; let cursor: number | null = 0;
    while (cursor !== null) {
      const page = await pod.send('sealFetch', { cursor }) as { data: string; next: number | null; size: number };
      expect(page.size).toBe(sealed.archiveBytes);
      chunks.push(Buffer.from(page.data, 'base64'));
      cursor = page.next;
    }
    const archive = Buffer.concat(chunks);
    expect(archive.byteLength).toBe(sealed.archiveBytes);
    expect(createHash('sha256').update(archive).digest('hex')).toBe(sealed.archiveSha256);
    const { createZstdDecompress } = await import('node:zlib');
    const { Readable } = await import('node:stream');
    const out: Uint8Array[] = [];
    for await (const piece of Readable.from([archive]).pipe(createZstdDecompress())) out.push(piece as Uint8Array);
    expect(Buffer.concat(out).byteLength).toBeGreaterThan(0);
  });
  it('should refuse sealDependencies before install and sealFetch with a bad cursor', async () => {
    const pod = await harness();
    await expect(pod.send('sealDependencies', {})).rejects.toThrow('failed:phase_refused');
    await expect(pod.send('sealFetch', { cursor: 0 })).rejects.toThrow('failed:invalid_archive');
    await expect(pod.send('sealFetch', { cursor: -1 })).rejects.toThrow('failed:invalid_args');
  });
});
