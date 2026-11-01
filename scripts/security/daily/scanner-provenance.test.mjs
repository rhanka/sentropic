import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { digest, policy, validateScanner } from './toolchain-contract.mjs';

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

test('should pin a reviewed downstream recipe with fixed stages and no floating inputs', async () => {
  const recipe = JSON.parse(await readFile(
    new URL('../../../scripts/security/scanner/recipe.json', import.meta.url)));
  assert.deepEqual(recipe.stages,
    ['acquire-upstream', 'apply-patches', 'rebuild', 'layout-sbom', 'validate']);
  assert.equal(recipe.upstream.version, '0.76.1');
  assert.ok(!JSON.stringify(recipe).includes('latest'));
  assert.ok(!JSON.stringify(recipe).toLowerCase().includes('python'));
  const origins = JSON.stringify(recipe.allowedOrigins);
  assert.ok(origins.includes('github.com/aquasecurity/trivy'));
  assert.ok(origins.includes('ghcr.io'));
  assert.equal(typeof recipe.toolchain.go, 'string');
  assert.ok(recipe.toolchain.go.length > 0);
  assert.equal(typeof recipe.base.image, 'string');
  assert.ok(recipe.base.image.includes('@sha256:'));
  const cves = recipe.patches.map((entry) => entry.cve).sort();
  assert.deepEqual(cves, ['CVE-2026-111497', 'CVE-2026-116587', 'CVE-2026-92392']);
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
