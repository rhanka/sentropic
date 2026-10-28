import assert from 'node:assert/strict';
import { json, sha256 } from './bindings.mjs';
import { candidate, profileNames } from './candidates.mjs';

export function validate(b) {
  for (const [file, hash] of Object.entries(candidate.anchors)) b.read(file, hash);
  const r = json(b.read('receipt.json'));
  assert.equal(r.head, candidate.qualifiedHead);
  assert.equal(r.tree, candidate.qualifiedTree);
  const source = json(b.read('source-identity.json'));
  for (const key of ['snapshotHead', 'qualifiedHead', 'qualifiedTree']) assert.equal(source[key], candidate[key]);
  assert.deepEqual(source.packedDrift, []);
  b.read('source.tar');
  const sourceFiles = b.tree('source/packages/cluster-mesh/src');
  b.tree('source/packages/cluster-mesh/assets');
  const sourcePackage = json(b.read('source/packages/cluster-mesh/package.json'));
  assert.equal(sourcePackage.version, candidate.mesh.version);
  source.sourceFiles = sourceFiles;
  source.package = 'source/packages/cluster-mesh/package.json';
  const engram = b.archive('engram.tgz', candidate.engram);
  const mesh = b.archive('mesh.tgz', candidate.mesh);
  for (const [name, archive] of [['engram', engram], ['clusterMesh', mesh]]) {
    assert.equal(r[name].version, archive.version);
    assert.equal(r[name].tarballSha256, archive.sha256);
    assert.equal(r[name].integrity, archive.integrity);
  }
  assert.equal(r.clusterMesh.fileListSha256, mesh.fileListSha256);
  const lock = json(b.read('consumer-lock.json'));
  const pkg = json(b.read('consumer-package.json'));
  assert.equal(sha256(b.read('consumer/package.json')), sha256(b.read('consumer-package.json')));
  assert.equal(sha256(b.read('consumer/package-lock.json')), sha256(b.read('consumer-lock.json')));
  assert.equal(r.consumer.lockSha256, sha256(b.read('consumer-lock.json')));
  for (const archive of [engram, mesh]) {
    const entry = lock.packages[`node_modules/${archive.name}`];
    assert.equal(entry.version, archive.version);
    assert.equal(entry.integrity, archive.integrity);
    assert(pkg.dependencies[archive.name].startsWith('file:../artifacts/'));
  }
  for (const [name, entry] of Object.entries(lock.packages).filter(([name]) => name)) {
    assert(!entry.link && entry.integrity?.startsWith('sha512-'), `unbound lock package: ${name}`);
  }
  const workspace = json(b.read('source/package-lock.json'));
  assert.equal(workspace.packages['packages/cluster-mesh'].version, mesh.version);
  const locks = { package: pkg, consumer: 'consumer-lock.json', workspace: 'source/package-lock.json', install: 'fresh npm ci; retained lock compared before/after' };
  assert.equal(b.read('lock-before.sha256').toString().split(' ')[0], r.consumer.lockSha256);
  const registry = json(b.read('engram-registry.json'));
  assert.equal(registry.gitHead, '8b93ba6b834f83fddbcf76091054efea2e188cf1');
  assert.equal(registry.dist.integrity, engram.integrity);
  const contractBytes = b.read('neutral-contract-1.0.0.jcs.json');
  assert.equal(contractBytes.length, 4012);
  const contractDigest = `sha256:${sha256(Buffer.concat([Buffer.from('graphify-memory/l3a-module-descriptor/v1\0'), contractBytes]))}`;
  assert.equal(contractDigest, 'sha256:dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee');
  assert.deepEqual(r.requiredProfiles, profileNames);
  assert.deepEqual(r.declaredProfileClaims.map((p) => p.name), profileNames);
  assert(r.declaredProfileClaims.every((p) => p.status === 'declared' && /^sha256:[a-f0-9]{64}$/.test(p.digest)));
  assert.equal(r.fiveProfileEquivalence.status, 'not-covered');
  assert.equal(r.contractDigest, contractDigest);
  assert.equal(r.tupleCoverage, 'full');
  assert(!Object.hasOwn(r, 'hostGlue'));
  assert.equal(b.read('campaign.status').toString(), 'exit=0\ncleanup=0\n');
  assert.match(b.read('campaign.log').toString(), new RegExp(`head=${r.head}`));
  assert.match(r.consumer.node, /^v24\./);
  assert.equal(r.qualificationImage, 'sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6');
  assert(b.read('source/docker-compose.immo-861.yml').toString().includes(`node:24-bookworm-slim@${r.qualificationImage}`));
  const adaptations = [];
  for (const name of ['installed-memory.mjs', 'installed-hydration.mjs', 'installed-memory-types.ts']) {
    const original = b.read(`source/packages/cluster-mesh/tests/engram-memory/${name}`).toString();
    const staged = original.replaceAll('0.22.0', '0.21.3').replaceAll('0.24.0-dev.5', '0.24.0-dev.6')
      .replaceAll('26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10', engram.sha256);
    assert.equal(sha256(b.read(`consumer/${name}`)), sha256(staged), `unreviewed lane adaptation: ${name}`);
    adaptations.push({ name, sourceSha256: sha256(original), stagedSha256: sha256(staged) });
  }
  assert.deepEqual(json(b.read('lane-adaptation.json')), adaptations);
  const closure = { runtime: r.runtimeClosure, types: r.typeClosure };
  for (const file of new Set([...closure.runtime, ...closure.types])) {
    assert(file.startsWith('node_modules/') || ['installed-memory.mjs', 'installed-hydration.mjs'].includes(file), `unexpected consumer closure member: ${file}`);
    const bytes = b.read(`consumer/${file}`);
    if (!file.startsWith('node_modules/')) {
      const original = b.read(`source/packages/cluster-mesh/tests/engram-memory/${file}`).toString();
      const staged = original.replaceAll('0.22.0', '0.21.3').replaceAll('0.24.0-dev.5', '0.24.0-dev.6')
        .replaceAll('26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10', engram.sha256);
      assert.equal(sha256(bytes), sha256(staged), `unreviewed lane adaptation: ${file}`);
    }
    const archive = file.startsWith('node_modules/@sentropic/engram/') ? engram
      : file.startsWith('node_modules/@sentropic/cluster-mesh/') ? mesh : null;
    if (archive) assert.equal(sha256(bytes), sha256(archive.member(file.slice(`node_modules/${archive.name}/`.length))), `installed bytes differ: ${file}`);
  }
  const driver = json(b.read('consumer/node_modules/pg/package.json', r.postgres.driver.artifactDigest));
  assert.equal(driver.version, '8.22.0');
  assert.equal(lock.packages['node_modules/pg'].version, driver.version);
  assert.equal(r.migrations.length, 10);
  for (const migration of r.migrations) {
    const file = `assets/storage/postgres/${migration.id.replace('cluster-mesh-pg/', '').replace(/@1$/, '.sql')}`;
    assert.equal(sha256(mesh.member(file)), migration.checksum, `migration mismatch: ${file}`);
    assert.equal(sha256(b.read(`source/packages/cluster-mesh/${file}`)), migration.checksum);
  }
  for (const file of ['installed-memory.mjs', 'installed-memory-types.ts', 'qualification.mk', 'installed-hydration.mjs']) b.read(`source/packages/cluster-mesh/tests/engram-memory/${file}`);
  const inventory = json(mesh.member('assets/storage/engram-memory/neutral-asset-inventory.json'));
  const manifest = json(mesh.member('assets/storage/engram-memory/contract-manifest.json'));
  assert.deepEqual(manifest, json(contractBytes));
  assert.equal(inventory.contractDigest, contractDigest);
  assert.equal(inventory.asset.version, '1.0.0');
  mesh.member('dist/engram-memory/neutral-contract.d.ts');
  mesh.member('dist/engram-memory/wire-adaptation.js');
  const finalMember = `package/${inventory.asset.declaration}`;
  const c6 = { name: inventory.asset.name, version: inventory.asset.version, declaration: inventory.asset.declaration,
    path: 'neutral-contract-1.0.0.jcs.json', finalBytesSha256: sha256(contractBytes), contractDigest,
    standaloneDeclarationSha256: mesh.members.includes(finalMember) ? sha256(mesh.member(inventory.asset.declaration)) : null,
    candidateEmittedDeclarationSha256: mesh.memberHashes['dist/engram-memory/neutral-contract.d.ts'], inventory };
  for (const file of ['producer.md', 'e10a3-delivery.json', 'pack-receipt.json', 'lane-adaptation.json', 'npm-version.txt',
    'reserved-registry.json', 'reserved-registry.status', 'type-files.txt']) b.read(file);
  return { receipt: r, engram, mesh, source, c6, locks, driver: { ...r.postgres.driver, integrity: lock.packages['node_modules/pg'].integrity }, closure };
}
