import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { sha256Hex, PINNED_IMAGE_DIGEST } from './schema-validator.mjs';
import { P3_SHA256 } from './lot2-manifest.mjs';
const root = 'spec/evidence/memory-mcp-l5/lot2', binding = JSON.parse(readFileSync(`${root}/artifact-binding.json`));
const { registryTarball, ...e2 } = binding.e2;
const pending = path => ({ path: `${root}/pending-host/${path}`, sha256: '0'.repeat(64) });
const backend = { ...pending('backend.tgz'), name: '@sentropic/cluster-mesh', version: 'unverified', integrity: 'sha512-unverified' };
const manifest = { manifestVersion: 1, stage: 'lot2', status: 'unverified',
  preCandidate: { path: 'tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json', sha256: P3_SHA256 },
  e2, backend, neutralDeclarations: pending('neutral-declarations.json'), hostProfile: pending('host-profile.json'),
  lock: pending('package-lock.json'), closure: [e2],
  runtime: { imageDigest: PINNED_IMAGE_DIGEST, nodeVersion: '24.21.0', sqliteVersion: 'unverified', python: false, nativeAddonCompilation: false },
  acknowledgements: Object.fromEntries(['g1', 'g2', 'g3', 'g4', 'c9'].map(name => [name, pending(`${name}.json`)])) };
mkdirSync(`${root}/fixtures`, { recursive: true });
const provenancePath = `${root}/fixtures/lot2-provenance.unverified.json`;
const provenance = JSON.stringify(manifest, null, 2) + '\n';
writeFileSync(provenancePath, provenance);
const pre = JSON.parse(readFileSync('tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json'));
const outer = { manifestVersion: 1, stage: 'lot2', preCandidateManifestSha256: P3_SHA256,
  e2ArtifactSha256: e2.sha256, e2Provenance: { path: provenancePath, sha256: sha256Hex(provenance) }, source: pre.source };
const artifacts = [...pre.artifacts, { role: 'e2', name: e2.name, version: e2.version, sha256: e2.sha256,
  integrity: e2.integrity, sourceHead: '5a8018e35f895995ae0299021aa4902dbd45cdcc', archive: e2.path }];
const bytes = JSON.stringify(outer).slice(0, -1) + ',\n"artifacts":[\n' + artifacts.map(x => JSON.stringify(x)).join(',\n') +
  '\n],\n"contractInventory":[\n' + pre.contractInventory.map(x => JSON.stringify(x)).join(',\n') + '\n]}\n';
const path = `${root}/fixtures/lot2-manifest.unverified.json`;
writeFileSync(path, bytes); writeFileSync(path + '.sha256', sha256Hex(bytes) + '\n');
console.log('Unverified test fixture written; never a qualification manifest');
