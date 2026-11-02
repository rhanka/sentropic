import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { digest, policy, validateScanner } from './toolchain-contract.mjs';
import { materialFixture } from '../scanner/contract-fixture.mjs';
import { validateMaterialContract, validateMaterialInventory } from '../scanner/material-contract.mjs';
import '../scanner/material-acquisition.test.mjs';
import '../scanner/retained-materials.test.mjs';
import '../scanner/offline-dependencies.test.mjs';
import '../scanner/build-isolation.test.mjs';
import '../scanner/build-layout.test.mjs';
import '../scanner/build-executor.test.mjs';
import '../scanner/tool-inventory.test.mjs';
import '../scanner/tool-admission.test.mjs';

// Mandatory native offline replay and two-build fixture gates, collected only when the
// retained material directory is supplied; the gates themselves never skip.
if (process.env.SCANNER_MATERIALS) {
  await import('../scanner/native-replay.test.mjs');
  await import('../scanner/native-build.test.mjs');
}

const SENTROPIC_REPOSITORY = 'ghcr.io/rhanka/sentropic-trivy';
const SENTROPIC_IDENTITY =
  'https://github.com/rhanka/sentropic/.github/workflows/security-scanner-image.yml@refs/heads/main';
const SENTROPIC_ISSUER = 'https://token.actions.githubusercontent.com';

const loadPolicyJson = async () =>
  JSON.parse(await readFile(new URL('../../../.security/trivy-toolchain.json', import.meta.url)));

function syntheticEvidence(p) {
  const configBytes = JSON.stringify({ os: 'linux', architecture: 'amd64', config: { Labels: {
    'org.opencontainers.image.version': p.version, 'org.opencontainers.image.revision': p.revision,
  } } });
  const configDigest = digest(configBytes);
  const manifestBytes = JSON.stringify({ config: { digest: configDigest, size: Buffer.byteLength(configBytes) } });
  const manifestDigest = digest(manifestBytes);
  const indexBytes = JSON.stringify({ manifests: [{ platform: { os: 'linux', architecture: 'amd64' },
    digest: manifestDigest, size: Buffer.byteLength(manifestBytes) }] });
  const indexDigest = digest(indexBytes);
  return { configBytes, manifestBytes, indexBytes, configDigest, manifestDigest, indexDigest };
}

test('should declare upstream and sentropic-patched publisher profiles with blocked admission', async () => {
  const raw = await loadPolicyJson();
  assert.equal(raw.profile, 'upstream');
  assert.equal(raw.qualified, false);
  assert.ok(raw.publishers && typeof raw.publishers === 'object');
  assert.deepEqual(Object.keys(raw.publishers).sort(), ['sentropic-patched', 'upstream']);
  assert.equal(raw.publishers.upstream.repository, 'aquasec/trivy');
  assert.equal(raw.publishers['sentropic-patched'].repository, SENTROPIC_REPOSITORY);
  assert.equal(raw.publishers['sentropic-patched'].signature.issuer, SENTROPIC_ISSUER);
  assert.equal(raw.publishers['sentropic-patched'].signature.identity, SENTROPIC_IDENTITY);
  assert.equal(raw.publishers.upstream.signature.identity,
    'https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.1');
  assert.notEqual(raw.publishers['sentropic-patched'].signature.identity,
    raw.publishers.upstream.signature.identity);
  assert.equal(raw.publishers['sentropic-patched'].qualified, false);
  assert.ok(raw.blockers.length > 0);
  assert.equal(policy.profile, 'upstream');
});

test('should keep upstream exact-byte validation while refusing downstream bytes before admission', () => {
  const evidence = syntheticEvidence(policy);
  const pinned = structuredClone(policy);
  pinned.indexDigest = evidence.indexDigest;
  pinned.manifestDigest = evidence.manifestDigest;
  pinned.configDigest = evidence.configDigest;
  const signature = { verified: true, digest: evidence.indexDigest,
    issuer: pinned.signature.issuer, identity: pinned.signature.identity, bundleHash: digest('bundle') };
  assert.equal(validateScanner({ indexBytes: evidence.indexBytes, manifestBytes: evidence.manifestBytes,
    configBytes: evidence.configBytes, signature }, pinned).version, pinned.version);
  const downstream = structuredClone(pinned);
  downstream.profile = 'sentropic-patched';
  downstream.repository = SENTROPIC_REPOSITORY;
  assert.throws(() => validateScanner({ indexBytes: evidence.indexBytes, manifestBytes: evidence.manifestBytes,
    configBytes: evidence.configBytes, signature }, downstream), /coverage-blocked/);
});

test('should refuse upstream signatures on downstream bytes and any profile override', () => {
  const evidence = syntheticEvidence(policy);
  const pinned = structuredClone(policy);
  pinned.indexDigest = evidence.indexDigest;
  pinned.manifestDigest = evidence.manifestDigest;
  pinned.configDigest = evidence.configDigest;
  const upstreamSig = { verified: true, digest: evidence.indexDigest,
    issuer: 'https://token.actions.githubusercontent.com',
    identity: 'https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.1',
    bundleHash: digest('bundle') };
  const sentropicPolicy = structuredClone(pinned);
  sentropicPolicy.profile = 'sentropic-patched';
  sentropicPolicy.repository = SENTROPIC_REPOSITORY;
  sentropicPolicy.signature = { issuer: SENTROPIC_ISSUER, identity: SENTROPIC_IDENTITY,
    requirePlatformSignature: false, verifierAdmitted: false, contentAdmitted: false };
  assert.throws(() => validateScanner({ indexBytes: evidence.indexBytes, manifestBytes: evidence.manifestBytes,
    configBytes: evidence.configBytes, signature: upstreamSig }, sentropicPolicy), /coverage-blocked/);
  for (const delta of [{ repository: 'mirror.example/trivy' }, { profile: 'custom' },
    { indexDigest: 'latest' }]) {
    assert.throws(() => validateScanner({ indexBytes: evidence.indexBytes, manifestBytes: evidence.manifestBytes,
      configBytes: evidence.configBytes, signature: upstreamSig }, { ...pinned, ...delta }),
    /coverage-blocked/);
  }
});

const loadRealContract = async () => ({
  recipeBytes: await readFile(new URL('../scanner/recipe.json', import.meta.url)),
  manifest: JSON.parse(await readFile(new URL('../scanner/material-manifest.json', import.meta.url))),
});

test('should validate the resolved real recipe inventory against the policy pins, contract-only', async () => {
  const real = await loadRealContract();
  const recipe = validateMaterialInventory(real);
  assert.equal(recipe.sourceCommit, policy.revision);
  assert.equal(recipe.upstream.version, policy.version);
  assert.equal(recipe.upstream.commit, policy.revision);
  assert.ok(recipe.go.modules.length > 1);
  assert.deepEqual(recipe.patches.map(p => p.cve),
    ['CVE-2026-111497', 'CVE-2026-92392', 'CVE-2026-116587']);
  assert.throws(() => validateMaterialContract({ ...real, files: {} }), /scanner-contract/);
});

test('should refuse every mutation of the resolved recipe and material pins', async () => {
  const real = await loadRealContract();
  const recipe = JSON.parse(real.recipeBytes.toString('utf8'));
  const rehash = r => ({ recipeBytes: Buffer.from(JSON.stringify(r)),
    manifest: { ...real.manifest, recipeDigest: digest(Buffer.from(JSON.stringify(r))) } });
  for (const mutate of [
    r => { r.sourceCommit = 'pinned at build time'; },
    r => { r.sourceCommit = 'z'.repeat(40); },
    r => { r.patchRevision = 0; },
    r => { r.patches.reverse(); },
    r => { r.patches[0].version = 'latest'; },
    r => { r.go.version = 'pinned-by-upstream-go-dot-mod'; },
    r => { r.go.modules.pop(); },
    r => { r.base.index = 'alpine@sha256:pending'; },
    r => { r.base.repository = 'alpine'; },
    r => { r.upstream.archive = '../escape'; },
    r => { r.origins = ['https://evil.example']; },
    r => { r.extra = 'unknown'; },
    r => { delete r.actions; },
  ]) {
    const r = structuredClone(recipe); mutate(r);
    assert.throws(() => validateMaterialInventory(rehash(r)), /scanner-contract/);
  }
  for (const mutate of [
    m => { m.recipeDigest = 'sha256:pending-live-build'; },
    m => { m.materials[0].digest = `sha256:${'g'.repeat(64)}`; },
    m => { m.materials[0].kind = 'unknown-kind'; },
    m => { m.materials[0].size = 0; },
    m => { m.materials[0].url = 'http://insecure.example/source.tar.gz'; },
    m => { m.materials[0].extra = 'unknown'; },
    m => { m.materials.pop(); },
    m => { m.materials.push(structuredClone(m.materials[0])); },
    m => { m.materials.reverse(); },
  ]) {
    const m = structuredClone(real.manifest); mutate(m);
    assert.throws(() => validateMaterialInventory({ recipeBytes: real.recipeBytes, manifest: m }),
      /scanner-contract/);
  }
});

test('should validate a complete synthetic material tuple without granting admission', () => {
  assert.deepEqual(validateMaterialContract(materialFixture()), { contractValid: true, productionAdmitted: false });
});

test('should refuse prose, non-hex pins, missing materials and changed bytes', () => {
  for (const mutate of [
    (f) => { f.manifest.recipeDigest = 'sha256:pending-live-build'; },
    (f) => { f.manifest.materials[0].digest = `sha256:${'g'.repeat(64)}`; },
    (f) => { f.manifest.materials[0].digest = 'sha256:' + '0'.repeat(64); },
    (f) => { f.manifest.materials.pop(); },
    (f) => { f.files['source.tar'] = Buffer.from('changed'); },
    (f) => { f.files['source.tar'] = Buffer.alloc(0); },
    (f) => { f.manifest.materials[0].size = 0; },
    (f) => { f.manifest.materials[0].extra = 'unknown'; },
    (f) => { f.manifest.materials.push(f.manifest.materials[0]); },
  ]) {
    const fixture = materialFixture(); mutate(fixture);
    assert.throws(() => validateMaterialContract(fixture), /scanner-contract/);
  }
});

test('should refuse unresolved source/compiler pins even after rehashing the recipe', () => {
  for (const mutate of [
    (r) => { r.upstream.commit = 'pinned at build time'; },
    (r) => { r.go.version = 'pinned-by-upstream-go-dot-mod'; },
    (r) => { r.actions[0].commit = 'v6'; },
    (r) => { r.patches.reverse(); },
    (r) => { r.base.index = 'alpine@sha256:pending'; },
    (r) => { r.go.modules = []; },
  ]) {
    const fixture = materialFixture(); const recipe = JSON.parse(fixture.recipeBytes);
    mutate(recipe); fixture.recipeBytes = Buffer.from(JSON.stringify(recipe));
    fixture.manifest.recipeDigest = digest(fixture.recipeBytes);
    assert.throws(() => validateMaterialContract(fixture), /scanner-contract/);
  }
});

test('should block vulnerable fixtures and keep admission off without live receipts', async () => {
  const raw = await loadPolicyJson();
  assert.equal(raw.qualified, false);
  assert.equal(raw.publishers['sentropic-patched'].qualified, false);
  assert.throws(() => validateScanner({ indexBytes: '{}', manifestBytes: '{}',
    configBytes: '{}', signature: { verified: false } }), /coverage-blocked/);
});

test('should document scanner qualification placeholders without inventing a live digest', async () => {
  const doc = await readFile(new URL('../../../docs/security/scanner-images/README.md', import.meta.url), 'utf8');
  assert.match(doc, /status: unadmitted/);
  assert.match(doc, /ghcr\.io\/rhanka\/sentropic-trivy/);
  assert.doesNotMatch(doc, /sha256:[a-f0-9]{64}/);
});
