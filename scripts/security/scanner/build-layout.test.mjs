import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, chmod, symlink, readFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../daily/toolchain-contract.mjs';
import { normalizeOutputTree, parseApkPackage, parseGoModuleList, dependenciesInventory,
  makeOciLayout, compareBuilds } from './build-layout.mjs';

async function workdir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function tree(root, files) {
  for (const [name, content, mode] of files) {
    const target = join(root, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
    if (mode) await chmod(target, mode);
  }
}

test('should normalize a filesystem deterministically across distinct roots and refuse links', async t => {
  const a = await workdir(t, 'scanner-norm-a-');
  const b = await workdir(t, 'scanner-norm-b-');
  const files = [['usr/bin/tool', 'binary-v1', 0o755], ['etc/label', 'a03', 0o644]];
  await tree(a, files); await tree(b, files);
  const na = await normalizeOutputTree(a);
  const nb = await normalizeOutputTree(b);
  assert.equal(na.filesystemDigest, nb.filesystemDigest);
  assert.deepEqual(na.files.map(f => [f.path, f.mode]), [['etc/label', '644'], ['usr/bin/tool', '755']]);
  assert.equal(na.files[1].digest, digest(Buffer.from('binary-v1')));
  await writeFile(join(a, 'usr/bin/tool'), 'binary-v2');
  assert.notEqual((await normalizeOutputTree(a)).filesystemDigest, na.filesystemDigest);
  await chmod(join(a, 'etc/label'), 0o600);
  assert.notEqual((await normalizeOutputTree(a)).filesystemDigest, na.filesystemDigest);
  await symlink('/etc/hostname', join(a, 'etc/link'));
  await assert.rejects(normalizeOutputTree(a), /scanner-contract/);
});

test('should parse OS packages and Go modules into a stable dependency inventory', () => {
  assert.deepEqual(parseApkPackage('os/packages/libcurl-8.23.0-r0.apk'), { name: 'libcurl', version: '8.23.0-r0' });
  assert.deepEqual(parseApkPackage('os/packages/musl-1.2.6-r3.apk'), { name: 'musl', version: '1.2.6-r3' });
  assert.deepEqual(parseApkPackage('os/packages/zlib-1.3.2-r1.apk'), { name: 'zlib', version: '1.3.2-r1' });
  assert.throws(() => parseApkPackage('os/packages/brotli-libs.apk'), /scanner-contract/);
  assert.throws(() => parseApkPackage('../escape.apk'), /scanner-contract/);
  assert.deepEqual(parseGoModuleList('a03-fixture\n'), [{ name: 'a03-fixture', version: '(main)' }]);
  assert.deepEqual(parseGoModuleList('a03-fixture\nexample.org/m v1.2.3\n'), [
    { name: 'a03-fixture', version: '(main)' }, { name: 'example.org/m', version: 'v1.2.3' }]);
  assert.throws(() => parseGoModuleList('example.org/m v1.2.3 => /tmp/x\n'), /scanner-contract/);
  assert.throws(() => parseGoModuleList('main\nexample.org/m\n'), /scanner-contract/);
  assert.throws(() => parseGoModuleList('main\nexample.org/m v1.2.3 extra\n'), /scanner-contract/);
  const inv1 = dependenciesInventory({ modules: [{ name: 'm', version: 'v1.0.0' }, { name: 'main', version: '(main)' }],
    osPackages: [parseApkPackage('os/packages/musl-1.2.6-r3.apk')] });
  const inv2 = dependenciesInventory({ modules: [{ name: 'main', version: '(main)' }, { name: 'm', version: 'v1.0.0' }],
    osPackages: [parseApkPackage('os/packages/musl-1.2.6-r3.apk')] });
  assert.equal(inv1.dependenciesDigest, inv2.dependenciesDigest);
  assert.deepEqual(inv1.components, [
    { type: 'go-module', name: 'm', version: 'v1.0.0' },
    { type: 'go-module', name: 'main', version: '(main)' },
    { type: 'os-package', name: 'musl', version: '1.2.6-r3' }]);
  assert.throws(() => dependenciesInventory({ modules: [{ name: 'm', version: 'v1.0.0' }, { name: 'm', version: 'v1.0.0' }],
    osPackages: [] }), /scanner-contract/);
});

test('should lay out a deterministic OCI chain linked index to layers', async t => {
  const work = await workdir(t, 'scanner-oci-');
  const rootfs = join(work, 'rootfs');
  await tree(rootfs, [['usr/bin/tool', 'binary-v1', 0o755]]);
  const out = join(work, 'out');
  const first = await makeOciLayout({ rootfs, outDir: out, labels: { 'org.opencontainers.image.version': '0.76.1' } });
  const second = await makeOciLayout({ rootfs, outDir: join(work, 'out2'), labels: { 'org.opencontainers.image.version': '0.76.1' } });
  assert.equal(first.chain.index.digest, second.chain.index.digest);
  assert.equal(first.chain.layer.digest, second.chain.layer.digest);
  const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  const config = JSON.parse(await readFile(join(out, 'config.json'), 'utf8'));
  assert.equal(index.manifests.length, 1);
  assert.deepEqual(index.manifests[0].platform, { architecture: 'amd64', os: 'linux' });
  assert.deepEqual(index.manifests[0].digest, first.chain.manifest.digest);
  assert.equal(manifest.config.digest, first.chain.config.digest);
  assert.deepEqual(manifest.layers, [{ ...first.chain.layer, mediaType: 'application/vnd.oci.image.layer.v1.tar' }]);
  assert.equal(config.os, 'linux');
  assert.equal(config.architecture, 'amd64');
  assert.deepEqual(config.rootfs.diff_ids, [first.chain.layer.digest]);
  assert.equal(config.config.Labels['org.opencontainers.image.version'], '0.76.1');
  assert.equal((await lstat(join(out, 'layer.tar'))).size, first.chain.layer.size);
  await writeFile(join(rootfs, 'usr/bin/tool'), 'binary-v2');
  const third = await makeOciLayout({ rootfs, outDir: join(work, 'out3'), labels: {} });
  assert.notEqual(third.chain.layer.digest, first.chain.layer.digest);
  assert.notEqual(third.chain.index.digest, first.chain.index.digest);
});

test('should accept equal normalized builds and refuse every reproducibility mismatch', () => {
  const normalized = { filesystemDigest: digest('fs'), binaryDigest: digest('bin'), dependenciesDigest: digest('deps') };
  assert.deepEqual(compareBuilds({ normalized }, { normalized: structuredClone(normalized) }),
    { reproducible: true, allowedDifferences: [] });
  for (const mutate of [
    n => { n.filesystemDigest = digest('other-fs'); },
    n => { n.binaryDigest = digest('other-bin'); },
    n => { n.dependenciesDigest = digest('other-deps'); },
  ]) {
    const other = structuredClone(normalized); mutate(other);
    assert.throws(() => compareBuilds({ normalized }, { normalized: other }), /scanner-contract: reproducibility mismatch/);
  }
  assert.throws(() => compareBuilds({ normalized, allowedDifferences: ['time'] }, { normalized }), /scanner-contract/);
  assert.throws(() => compareBuilds({ normalized }, {}), /scanner-contract/);
});
