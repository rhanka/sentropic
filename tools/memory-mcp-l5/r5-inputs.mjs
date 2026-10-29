import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { integrity, sha256 } from './precandidate.mjs';
import { writeImmutable } from './candidate.mjs';
const root = process.cwd(), evidence = 'spec/evidence/memory-mcp-l5';
const raw = JSON.parse(readFileSync('/producer/candidate-manifest.json'));
const candidate = readFileSync('/delivery/sentropic-engram-0.22.0.tgz');
const p3 = sha256(readFileSync('tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json'));
assert.equal(p3, '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730');
assert.equal(sha256(candidate), '965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9');
assert.equal(integrity(candidate), 'sha512-GTpbiHocqxLiyI1Syn1g26vOrh8+o9zTGFc2yKKrBGqE+strVqOlc9A+DJ1PRJEmPWuULG+vWB9Iebhy1r1Q7A==');
assert.equal(raw.tarball.sha256, sha256(candidate)); assert.equal(raw.tarball.integrity, integrity(candidate));
assert.equal(raw.builtAgainstPreCandidateSha256, p3);
assert.equal(raw.engramSourceCommit, '0db169cba322015e1ee1b1bdcab09fdc02440f37');
assert.deepEqual(raw.peerDependencies, { '@sentropic/mcp-platform': '0.4.0', '@sentropic/mcp-broker': '0.1.0' });
const metadata = JSON.parse(readFileSync('/registry/cluster-mesh-registry.json'));
const mesh = readFileSync('/registry/published-cluster-mesh-0.22.4.tgz');
assert.equal(metadata.name, '@sentropic/cluster-mesh'); assert.equal(metadata.version, '0.22.4');
assert.equal(metadata.dist.integrity, integrity(mesh));
const url = 'https://registry.npmjs.org/-/npm/v1/attestations/@sentropic%2fcluster-mesh@0.22.4';
const response = await fetch(url); assert.ok(response.ok, `attestations HTTP ${response.status}`);
const attestations = await response.json();
const statements = attestations.attestations.map(a => JSON.parse(Buffer.from(a.bundle.dsseEnvelope.payload, 'base64')));
const provenance = statements.find(s => s.predicateType === 'https://slsa.dev/provenance/v1');
const subject = provenance.subject.find(s => s.name === 'pkg:npm/%40sentropic/cluster-mesh@0.22.4');
assert.equal(subject.digest.sha512, createHash('sha512').update(mesh).digest('hex'));
const source = provenance.predicate.buildDefinition.resolvedDependencies.find(d => d.uri === 'git+https://github.com/rhanka/sentropic@refs/heads/main');
assert.match(source.digest.gitCommit, /^[0-9a-f]{40}$/);
const keep = (name, bytes) => {
  const path = `tools/memory-mcp-l5/artifacts/archives/${name}-${sha256(bytes)}.tgz`;
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) assert.ok(readFileSync(path).equals(bytes)); else writeFileSync(path, bytes, { flag: 'wx' });
  return path;
};
const observed = writeImmutable(root, `${evidence}/r5-producer-manifest.json`, raw, { compact: true });
writeImmutable(root, `${evidence}/r5-mesh-provenance.json`, { url, attestations,
  authentication: 'Registry payload and archive binding checked; signature authentication remains a checkpoint provenance obligation.' }, { compact: true });
const receipt = writeImmutable(root, `${evidence}/r5-l4-build-receipt.json`, {
  builtAgainstPreCandidateSha256: p3, e4ArtifactSha256: sha256(candidate), sourceHead: raw.engramSourceCommit,
  producerManifest: observed, authentication: 'Observed producer delivery; not an authenticated role acceptance.' }, { compact: true });
const artifact = (role, name, version, bytes, sourceHead) => ({ role, name, version,
  sha256: sha256(bytes), integrity: integrity(bytes), sourceHead, archive: keep(name.split('/').at(-1) + '-' + version, bytes) });
const inputs = { l4BuildReceipt: receipt, artifacts: [
  artifact('l4', '@sentropic/engram', '0.22.0', candidate, raw.engramSourceCommit),
  artifact('mesh', '@sentropic/cluster-mesh', '0.22.4', mesh, source.digest.gitCommit),
] };
console.log(JSON.stringify(writeImmutable(root, `${evidence}/r5-candidate-inputs.json`, inputs, { compact: true })));
