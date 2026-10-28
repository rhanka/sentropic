// Copy the current E10 lane without rewriting its version or archive assertions.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { integrity, json, sha256 } from './bindings.mjs';
const root = process.argv[2];
const expected = 'sha512-eGoBIutpeISKgN4HOS3NSIj7K6rMtT6Y/FbBvoXMykLu0wbaKEaO1pjCLDxVFfdA6Zlj9zg2v2Ft7DIr5Vf7aw==';
const bytes = readFileSync(`${root}/engram.tgz`);
assert.equal(integrity(bytes), expected);
const registry = json(readFileSync(`${root}/engram-registry.json`));
assert.equal(registry.dist.integrity, expected);
assert.equal(registry.gitHead, '8b93ba6b834f83fddbcf76091054efea2e188cf1');
assert.equal(sha256(readFileSync(`${root}/mesh.tgz`)), '7aeb92cfb97ef013ee0d6d50162f5b8dedebd51a44af2018c2e24ada2395e271');
const dir = `${root}/source/packages/cluster-mesh/tests/engram-memory`;
const transforms = [];
for (const name of ['installed-memory.mjs', 'installed-hydration.mjs', 'installed-memory-types.ts']) {
  const original = readFileSync(`${dir}/${name}`, 'utf8');
  const staged = original;
  writeFileSync(`${root}/consumer/${name}`, staged);
  transforms.push({ name, sourceSha256: sha256(original), stagedSha256: sha256(staged) });
}
writeFileSync(`${root}/lane-adaptation.json`, JSON.stringify(transforms, null, 2) + '\n');
writeFileSync(`${root}/consumer/package.json`, JSON.stringify({ name: 'engram-e11-installed-consumer', version: '1.0.0', private: true,
  type: 'module', dependencies: { '@sentropic/engram': 'file:../artifacts/sentropic-engram-0.21.3.tgz',
    '@sentropic/cluster-mesh': 'file:../artifacts/sentropic-cluster-mesh-0.24.0-dev.7.tgz', pg: '8.22.0' },
  devDependencies: { typescript: '5.4.5', '@types/node': '22.20.1' } }, null, 2) + '\n');
copyFileSync(`${root}/engram.tgz`, `${root}/artifacts/sentropic-engram-0.21.3.tgz`);
copyFileSync(`${root}/mesh.tgz`, `${root}/artifacts/sentropic-cluster-mesh-0.24.0-dev.7.tgz`);
copyFileSync(`${root}/source/tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`, `${root}/artifacts/pre-candidate-manifest.json`);
