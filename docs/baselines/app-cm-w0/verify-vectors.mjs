import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { computeHash, isH2AEnvelope, verifyEnvelopeSignature } from '@sentropic/h2a';
const root = '/source';
const folder = `${root}/docs/baselines/app-cm-w0`;
const vectors = JSON.parse(readFileSync(`${folder}/verifier-vectors.json`, 'utf8'));
const tuple = JSON.parse(readFileSync(`${folder}/published-tuple-2026-10-18.json`, 'utf8'));
assert.equal(process.env.W0_SOURCE_SHA, tuple.sourceSha);
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
  assert.equal(createHash('sha256').update(readFileSync(`/baseline-source/${path}`)).digest('hex'), expected, path);
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
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const current = json(`${folder}/published-tuple.json`);
const currentVectors = json(`${folder}/tuple-vectors-2026-10-27.json`);
assert.equal(current.sourceSha, process.env.W0_CURRENT_SOURCE_SHA);
for (const [file, expected] of Object.entries(currentVectors.fileHashes)) {
  assert.equal(sha256(`${folder}/${file}`), expected, file);
}
assert.equal(current.sourceSha, currentVectors.sourceSha);
assert.deepEqual(Object.fromEntries(Object.entries(current.packages).map(([key, p]) => [key, p.version])), currentVectors.versions);
for (const [path, expected] of Object.entries(current.sourceInputs)) {
  assert.equal(sha256(`/tuple-source/${path}`), expected, path);
}
const resolution = current.workspaceResolution;
const lock = json(`${root}/package-lock.json`);
assert.equal(sha256(`${root}/package-lock.json`), resolution.lockSha256);
assert.equal(sha256(`${root}/api/package-lock.json`), resolution.apiLockSha256);
assert.equal(sha256(`${folder}/${resolution.completeTree}`), resolution.completeTreeSha256);
assert.deepEqual(json(`${folder}/${resolution.completeTree}`).packages, lock.packages);
assert.equal(Object.keys(lock.packages).length, resolution.entryCount);
assert.equal(resolution.entryCount, currentVectors.lockEntries);
const fit = json(`${folder}/${current.publishedFit.receipt}`);
assert.equal(fit.profileDigest, current.profile.compiledDigest);
assert.equal(fit.manifestDigest, current.profile.manifestDigest);
assert.equal(current.profile.manifestDigest, currentVectors.manifestDigest);
assert.deepEqual(fit.manifest.tools.map(tool => tool.name), current.profile.capabilities);
assert(fit.manifest.tools.every(tool => tool.requiredScopes.includes(current.profile.invocationScope)));
const payload = json(`${folder}/${current.payloadEquivalence.receipt}`);
for (const [key, p] of Object.entries(current.packages)) {
  assert.match(p.dist.integrity, /^sha512-/);
  assert.equal(payload.receipts[key].archiveSha256, p.archiveSha256);
  assert.equal(current.selectedPeers[`node_modules/${p.name}`].version, p.version);
  assert.equal(lock.packages[`packages/${key}`].version, p.version);
}
console.log('PASS: historical vectors 1 positive/3 negative, verifier bytes and source hashes; refreshed tuple vectors, source hashes, complete lock, profile and payload receipts; record links; pending live digests');
