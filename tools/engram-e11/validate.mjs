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
  const locks = { package: pkg, consumer: 'consumer-lock.json', workspace: 'source/package-lock.json', install: 'npm ci only; not executed by preparation' };
  assert.deepEqual(r.requiredProfiles, profileNames);
  assert.deepEqual(r.declaredProfileClaims.map((p) => p.name), profileNames);
  assert(r.declaredProfileClaims.every((p) => p.status === 'declared' && /^sha256:[a-f0-9]{64}$/.test(p.digest)));
  assert.equal(r.fiveProfileEquivalence.status, 'not-covered');
  assert.equal(r.contractDigest, 'sha256:dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28');
  assert.equal(r.tupleCoverage, 'full');
  assert(!Object.hasOwn(r, 'hostGlue'));
  assert.equal(b.read('campaign.status').toString(), 'exit=0\ncleanup=0\n');
  assert.match(b.read('campaign.log').toString(), new RegExp(`head=${r.head}`));
  assert.match(r.consumer.node, /^v24\./);
  assert.equal(r.qualificationImage, 'sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6');
  assert(b.read('source/docker-compose.immo-861.yml').toString().includes(`node:24-bookworm-slim@${r.qualificationImage}`));
  const closure = { runtime: r.runtimeClosure, types: r.typeClosure };
  for (const file of new Set([...closure.runtime, ...closure.types])) {
    assert(file.startsWith('node_modules/'), `closure outside consumer: ${file}`);
    const bytes = b.read(`consumer/${file}`);
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
  assert.equal(inventory.asset.version, '1.0.0');
  mesh.member('dist/engram-memory/neutral-contract.d.ts');
  mesh.member('dist/engram-memory/wire-adaptation.js');
  mesh.member('dist/engram-memory/neutral-transaction.js');
  const finalMember = `package/${inventory.asset.declaration}`;
  const c6 = { name: inventory.asset.name, version: inventory.asset.version, declaration: inventory.asset.declaration,
    finalBytesSha256: mesh.members.includes(finalMember) ? sha256(mesh.member(inventory.asset.declaration)) : null,
    candidateEmittedDeclarationSha256: mesh.memberHashes['dist/engram-memory/neutral-contract.d.ts'], inventory };
  return { receipt: r, engram, mesh, source, c6, locks, driver: { ...r.postgres.driver, integrity: lock.packages['node_modules/pg'].integrity }, closure };
}
