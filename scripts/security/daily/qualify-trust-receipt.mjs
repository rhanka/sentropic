import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { digest, policy } from './toolchain-contract.mjs';

const read = (file) => readFile(`/evidence/${file}`);
const artifacts = {};
for (const file of ['cosign', 'index.json', 'manifest.json', 'config.json', 'bundle-manifest.json',
  'bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json',
  'wrong-root.json', 'wrong-bundle.json', 'changed-index.json',
  'trusted_root.json', 'tls-roots.pem', 'offline-verification.log', 'changed-index.log',
  'changed-root.log', 'changed-bundle.log', 'trust-trials.jsonl']) artifacts[file] = digest(await read(file));
assert.equal(artifacts.cosign, `sha256:${policy.signature.verifierCandidate.sha256}`);
for (const [file, expected] of [['index.json', policy.indexDigest], ['manifest.json', policy.manifestDigest],
  ['config.json', policy.configDigest]]) assert.equal(artifacts[file], expected);
assert.equal(artifacts['bundle-manifest.json'], 'sha256:356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6');
const bundleManifest = JSON.parse(await read('bundle-manifest.json'));
assert.equal(bundleManifest.layers.length, 1);
assert.equal(bundleManifest.layers[0].digest,
  artifacts['bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json']);
const fresh = (await read('tuf-home.txt')).toString().trim();
assert.match(fresh, /^tuf-home\.[A-Za-z0-9]+$/);
const metadata = {};
for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
  const bytes = await read(`${fresh}/.sigstore/root/tuf-repo-cdn.sigstore.dev/${role}.json`);
  const document = JSON.parse(bytes);
  assert.equal(document.signed._type, role);
  assert.ok(Date.parse(document.signed.expires) > Date.now(), `${role} expired`);
  metadata[role] = { digest: digest(bytes), rawBase64: bytes.toString('base64'), document };
}
for (const [parent, child] of [['timestamp', 'snapshot'], ['snapshot', 'targets']]) {
  const link = metadata[parent].document.signed.meta[`${child}.json`];
  assert.equal(link.version, metadata[child].document.signed.version);
  if (link.hashes?.sha256) assert.equal(`sha256:${link.hashes.sha256}`, metadata[child].digest);
}
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
const receipt = { schema: 1, observedAt: (await read('trust-verified-at.txt')).toString().trim(), qualified: false,
  acquisition: 'public Docker Hub/GitHub; empty isolated TUF home; no prior operator roots',
  trust: 'Cosign 3.1.4 embedded release root authenticates Sigstore TUF; TLS uses pinned Node Mozilla roots',
  verification: { network: 'none', issuer: policy.signature.issuer, identity: policy.signature.identity,
    digest: policy.indexDigest, artifacts, trials }, metadata, trustedRoot: JSON.parse(roots),
  trustedRootRawBase64: roots.toString('base64'),
  admission: 'cryptographic observations only; independent content/verifier admission remains required' };
await writeFile(process.argv[2] === 'publish' ? '/receipts/sec5a-trust-custody.json' : '/evidence/trust-custody.json',
  `${JSON.stringify(receipt, null, process.argv[2] === 'publish' ? 0 : 2)}\n`);
