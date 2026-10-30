import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { digest, policy, requireEvidence } from './toolchain-contract.mjs';

// TUF metadata freshness and rollback gate. Every role document must declare its
// own type with a positive integer version and must not be expired at
// verification time; each parent role must pin the exact current child version,
// and the pinned digest when the parent carries one. An expired root or a
// version/digest rollback refuses receipt creation; it never refreshes, warns,
// or falls back. Independent content/verifier admission remains pending.
export function validateTufMetadata(documents, digests, verifiedAt) {
  requireEvidence(Number.isFinite(verifiedAt), 'verification time is not finite');
  for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
    const document = documents?.[role];
    requireEvidence(document && typeof document === 'object' && !Array.isArray(document) &&
      document.signed?._type === role && Number.isInteger(document.signed?.version) &&
      document.signed.version > 0 && Number.isFinite(Date.parse(document.signed?.expires)),
      `${role} metadata is incomplete`);
    requireEvidence(Date.parse(document.signed.expires) > verifiedAt, `${role} expired at verification`);
  }
  for (const [parent, child] of [['timestamp', 'snapshot'], ['snapshot', 'targets']]) {
    const link = documents[parent].signed.meta?.[`${child}.json`];
    requireEvidence(link && link.version === documents[child].signed.version,
      `${parent} no longer pins current ${child}`);
    if (link.hashes?.sha256) requireEvidence(`sha256:${link.hashes.sha256}` === digests?.[child],
      `${parent} pins a superseded ${child} digest`);
  }
  return true;
}

export async function createTrustReceipt(read, pins = {
  cosign: `sha256:${policy.signature.verifierCandidate.sha256}`, 'index.json': policy.indexDigest,
  'manifest.json': policy.manifestDigest, 'config.json': policy.configDigest,
  'bundle-manifest.json': 'sha256:356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6',
}) {
  const observedAt = (await read('trust-verified-at.txt')).toString().trim();
  const verifiedAt = Date.parse(observedAt);
  assert.ok(Number.isFinite(verifiedAt));
  const artifacts = {};
  for (const file of ['cosign', 'index.json', 'manifest.json', 'config.json', 'bundle-manifest.json',
    'bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json',
    'wrong-root.json', 'wrong-bundle.json', 'changed-index.json',
    'trusted_root.json', 'tls-roots.pem', 'offline-verification.log', 'changed-index.log',
    'changed-root.log', 'changed-bundle.log', 'trust-trials.jsonl']) artifacts[file] = digest(await read(file));
  for (const [file, expected] of Object.entries(pins)) assert.equal(artifacts[file], expected);
  assert.equal(artifacts['changed-index.json'], digest(Buffer.concat([await read('index.json'), Buffer.from('\n')])));
  const bundleManifest = JSON.parse(await read('bundle-manifest.json'));
  assert.equal(bundleManifest.layers.length, 1);
  assert.equal(bundleManifest.layers[0].digest,
    artifacts['bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json']);
  const originalBundle = JSON.parse(await read('bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json'));
  const changedBundle = JSON.parse(await read('wrong-bundle.json'));
  const originalSig = Buffer.from(originalBundle.dsseEnvelope.signatures[0].sig, 'base64');
  const changedSig = Buffer.from(changedBundle.dsseEnvelope.signatures[0].sig, 'base64');
  const expectedSig = Buffer.from(originalSig);
  expectedSig[expectedSig.length - 1] ^= 1;
  assert.equal(originalSig[0], 0x30);
  assert.deepEqual(changedSig, expectedSig);
  changedBundle.dsseEnvelope.signatures[0].sig = originalBundle.dsseEnvelope.signatures[0].sig;
  assert.deepEqual(changedBundle, originalBundle);
  const fresh = (await read('tuf-home.txt')).toString().trim();
  assert.match(fresh, /^tuf-home\.[A-Za-z0-9]+$/);
  const metadata = {};
  for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
    const bytes = await read(`${fresh}/.sigstore/root/tuf-repo-cdn.sigstore.dev/${role}.json`);
    metadata[role] = { digest: digest(bytes), rawBase64: bytes.toString('base64'), document: JSON.parse(bytes) };
  }
  validateTufMetadata(Object.fromEntries(Object.entries(metadata).map(([role, entry]) => [role, entry.document])),
    Object.fromEntries(Object.entries(metadata).map(([role, entry]) => [role, entry.digest])), verifiedAt);
  const target = metadata.targets.document.signed.targets['trusted_root.json'];
  const roots = await read('trusted_root.json');
  assert.equal(target.hashes.sha256, artifacts['trusted_root.json'].slice(7));
  assert.equal(target.length, roots.length);
  assert.match((await read('offline-verification.log')).toString(), /Verified OK/);
  const trials = (await read('trust-trials.jsonl')).toString().trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(trials.map(t => t.trial), ['offline exact index', 'changed-index', 'changed-root', 'changed-bundle']);
  assert.ok(trials[0].exitCode === 0 && trials.slice(1).every(t => Number.isInteger(t.exitCode) && t.exitCode > 0));
  for (const [name, reason] of [['changed-index', /provided artifact digests do not match/],
    ['changed-root', /leaf certificate verification failed/],
    ['changed-bundle', /transparency log signature does not match/]]) {
    assert.match((await read(`${name}.log`)).toString(), reason);
  }
  const refreshBy = Object.values(metadata).map(({ document }) => document.signed.expires)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return { schema: 1, observedAt, refreshBy, qualified: false,
    acquisition: 'public Docker Hub/GitHub; empty isolated TUF home; no prior operator roots',
    trust: 'Cosign 3.1.4 embedded release root authenticates Sigstore TUF; TLS uses pinned Node Mozilla roots',
    verification: { network: 'none', issuer: policy.signature.issuer, identity: policy.signature.identity,
      digest: pins['index.json'], artifacts, trials }, metadata, trustedRoot: JSON.parse(roots),
    trustedRootRawBase64: roots.toString('base64'),
    admission: 'cryptographic observations only; independent content/verifier admission remains required' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const receipt = await createTrustReceipt(file => readFile(`/evidence/${file}`));
  await writeFile(process.argv[2] === 'publish' ? '/receipts/sec5a-trust-custody.json' : '/evidence/trust-custody.json',
    `${JSON.stringify(receipt, null, process.argv[2] === 'publish' ? 0 : 2)}\n`);
}
