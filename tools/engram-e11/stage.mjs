// E2-only adaptation of the retained E10 lane; package bytes are unchanged.
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
assert.equal(sha256(readFileSync(`${root}/mesh.tgz`)), 'ff79088e02574f9e17e16deb52f9380453255ed79f5b69c8b17d156a25233194');
const dir = `${root}/source/packages/cluster-mesh/tests/engram-memory`;
const transforms = [];
for (const name of ['installed-memory.mjs', 'installed-hydration.mjs', 'installed-memory-types.ts']) {
  const original = readFileSync(`${dir}/${name}`, 'utf8');
  const staged = original.replaceAll('0.22.0', '0.21.3').replaceAll('0.24.0-dev.5', '0.24.0-dev.6')
    .replaceAll('26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10', sha256(bytes));
  writeFileSync(`${root}/consumer/${name}`, staged);
  transforms.push({ name, sourceSha256: sha256(original), stagedSha256: sha256(staged) });
}
writeFileSync(`${root}/lane-adaptation.json`, JSON.stringify(transforms, null, 2) + '\n');
writeFileSync(`${root}/consumer/package.json`, JSON.stringify({ name: 'engram-e11-installed-consumer', version: '1.0.0', private: true,
  type: 'module', dependencies: { '@sentropic/engram': 'file:../artifacts/sentropic-engram-0.21.3.tgz',
    '@sentropic/cluster-mesh': 'file:../artifacts/sentropic-cluster-mesh-0.24.0-dev.6.tgz', pg: '8.22.0' },
  devDependencies: { typescript: '5.4.5', '@types/node': '22.20.1' } }, null, 2) + '\n');
copyFileSync(`${root}/engram.tgz`, `${root}/artifacts/sentropic-engram-0.21.3.tgz`);
copyFileSync(`${root}/mesh.tgz`, `${root}/artifacts/sentropic-cluster-mesh-0.24.0-dev.6.tgz`);
copyFileSync(`${root}/source/tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`, `${root}/artifacts/pre-candidate-manifest.json`);
