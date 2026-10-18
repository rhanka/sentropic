import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { computeHash, isH2AEnvelope, verifyEnvelopeSignature } from '@sentropic/h2a';
const root = '/source';
const folder = `${root}/docs/baselines/app-cm-w0`;
const vectors = JSON.parse(readFileSync(`${folder}/verifier-vectors.json`, 'utf8'));
const tuple = JSON.parse(readFileSync(`${folder}/published-tuple.json`, 'utf8'));
assert(isH2AEnvelope(vectors.envelope));
assert.equal(computeHash(vectors.manifest), vectors.envelope.body.manifestHash);
assert(verifyEnvelopeSignature(vectors.envelope, vectors.publicKeyPem, { by: 'w0-fixture-signer' }));
const changed = structuredClone(vectors.envelope);
changed.body.manifestHash = `sha256:${'0'.repeat(64)}`;
assert(!verifyEnvelopeSignature(changed, vectors.publicKeyPem, { by: 'w0-fixture-signer' }));
assert(!verifyEnvelopeSignature(vectors.envelope, vectors.publicKeyPem, { by: 'wrong-signer' }));
assert(!verifyEnvelopeSignature({ ...vectors.envelope, signatures: [] }, vectors.publicKeyPem));
for (const [file, expected] of Object.entries(vectors.fileHashes)) {
  assert.equal(createHash('sha256').update(readFileSync(`node_modules/@sentropic/h2a/dist/${file}.js`)).digest('hex'), expected);
}
for (const [path, expected] of Object.entries(tuple.sha256)) {
  if (path === 'probe-package-lock.json') continue;
  assert.equal(createHash('sha256').update(readFileSync(`${root}/${path}`)).digest('hex'), expected, path);
}
const manifests = new Map(tuple.packages.map(p => [p.name, p]));
for (const name of ['@sentropic/cluster-mesh', '@sentropic/artifacts', '@sentropic/llm-gateway']) {
  assert(manifests.get(name).dist.integrity.startsWith('sha512-'));
}
for (const file of readdirSync(folder).filter(f => f.endsWith('.md'))) {
  for (const match of readFileSync(`${folder}/${file}`, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (!target.includes('://')) assert(existsSync(`${folder}/${target}`), `${file}: ${target}`);
  }
}
assert(tuple.selectedClusterPeers.length === 9);
assert(Object.values(tuple.liveRoleDigests).every(v => v === null));
console.log('PASS: frozen vectors 1 positive/3 negative; canonical manifest hash; published verifier bytes; source hashes; record links; pending live digests');
