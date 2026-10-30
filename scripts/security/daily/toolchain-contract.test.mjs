import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertQualified, digest, policy, validateFreshness, validateScanner } from './toolchain-contract.mjs';
import { validateTufMetadata } from './qualify-trust-receipt.mjs';
import { createOciClient } from './toolchain-oci.mjs';
import { campaignAcquirer, restoreSnapshot } from './toolchain-cache.mjs';

const now = Date.parse('2026-10-29T12:00:00Z');
const metadata = () => ({ Version: 2, UpdatedAt: '2026-10-29T06:00:00Z',
  NextUpdate: '2026-10-30T06:00:00Z', DownloadedAt: '2026-10-29T11:00:00Z' });
test('should reject stale, future, malformed and incompatible DB metadata', () => {
  assert.equal(validateFreshness(metadata(), 2, now).Version, 2);
  for (const delta of [{ Version: 1 }, { UpdatedAt: '2026-10-27T06:00:00Z' },
    { UpdatedAt: '2026-10-29T12:01:00Z' }, { NextUpdate: '2026-10-29T11:59:59Z' },
    { DownloadedAt: '2026-10-29T12:01:00Z' }, { UpdatedAt: null }, { NextUpdate: 'invalid' },
    { DownloadedAt: '2026-10-29T11:00:00' }]) {
    assert.throws(() => validateFreshness({ ...metadata(), ...delta }, 2, now), /coverage-blocked/);
  }
  assert.throws(() => validateFreshness(metadata(), 2, Date.parse('2026-10-30T06:00:01Z')), /coverage-blocked/);
});
test('should keep daily qualification blocked despite valid version and frozen pins', () => {
  assert.equal(policy.option, 'B');
  assert.equal(policy.qualified, false);
  assert.throws(() => assertQualified(), /S2b qualification pending/);
});

test('should retain self-verifiable raw trust metadata and deterministic public custody bytes', async () => {
  const bytes = await readFile('docs/security/sec5a-trust-custody.json', 'utf8');
  const receipt = JSON.parse(bytes);
  assert.equal(bytes, `${JSON.stringify(receipt)}\n`);
  assert.equal(receipt.qualified, false);
  assert.deepEqual(Object.fromEntries(Object.entries(receipt.metadata).map(([role, entry]) => [role, entry.digest])), {
    root: 'sha256:27aea7e372aa7864065174f0661784fcf8b0e28b1dbfebeada31a0f1fb19167f',
    timestamp: 'sha256:a8c999cf4f4c639c178a453eafd8751d795515ec28468cd8de8a36d802caeba2',
    snapshot: 'sha256:6d61405faa993ba3d07556b79d1e319627cdc06ff879a7b5700967dc25d1d224',
    targets: 'sha256:6a697f7f8908c8ab26c11786ecb490b54acec97fa8c802e399f065f8a0cc1acd',
  });
  assert.deepEqual(receipt.verification.artifacts, {
    cosign: `sha256:${policy.signature.verifierCandidate.sha256}`,
    'index.json': policy.indexDigest,
    'manifest.json': policy.manifestDigest,
    'config.json': policy.configDigest,
    'bundle-manifest.json': 'sha256:356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6',
    'bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json':
      'sha256:e32151ef4929d001118616a1448426b6816c02605d3e7dcd956ecea6d5232a98',
    'wrong-root.json': 'sha256:5dea69365037e4ee92901d219eea0de12ae1b5ebe29f17e8a49161b934c4416e',
    'wrong-bundle.json': 'sha256:5e1e9b78dc62fca634525e01dd88c04ce12dfa4edc8b0fcebc29985ab85f3ad4',
    'changed-index.json': 'sha256:119952d007da1aecb65419d674feaa8019cc2df57f72a83be82dee7683cd55fc',
    'trusted_root.json': 'sha256:6494e21ea73fa7ee769f85f57d5a3e6a08725eae1e38c755fc3517c9e6bc0b66',
    'tls-roots.pem': 'sha256:1f20173c6c5bd4e836fbd5d025ec4eb7464e1521439cde2fea0aca3122c7a1a9',
    'offline-verification.log': 'sha256:80a53f76c7ed6969dade3b6ee47cdb753162db7c00be625448999d08bae77ed8',
    'changed-index.log': 'sha256:25a997f2deb6fa634d3152a43719691fdde5d7e5c21c888406419fe4ca8a2fec',
    'changed-root.log': 'sha256:1de678e305b7e3dc3d752dda507480e813cb0ba0560007009ac53892f1044376',
    'changed-bundle.log': 'sha256:b1b3cc7533f09ebf3b4a9f3b74afd6eadeca2a2ac1bf86d93054557498bfaced',
    'trust-trials.jsonl': 'sha256:e572a8b1af6cb6d55fdeb480e47cee740d612550dde9fa2f795f052150ba3dfd',
  });
  assert.deepEqual(receipt.verification.trials, [
    { trial: 'offline exact index', exitCode: 0 },
    { trial: 'changed-index', exitCode: 1 },
    { trial: 'changed-root', exitCode: 1 },
    { trial: 'changed-bundle', exitCode: 1 },
  ]);
  for (const [role, entry] of Object.entries(receipt.metadata)) {
    const raw = Buffer.from(entry.rawBase64, 'base64');
    assert.equal(digest(raw), entry.digest, role);
    assert.deepEqual(JSON.parse(raw), entry.document);
    assert.ok(Date.parse(entry.document.signed.expires) > Date.parse(receipt.observedAt), role);
  }
  const roots = Buffer.from(receipt.trustedRootRawBase64, 'base64');
  assert.equal(digest(roots), receipt.verification.artifacts['trusted_root.json']);
  assert.deepEqual(JSON.parse(roots), receipt.trustedRoot);
  assert.equal(receipt.metadata.targets.document.signed.targets['trusted_root.json'].hashes.sha256,
    digest(roots).slice(7));
  assert.equal(receipt.verification.artifacts.cosign, `sha256:${policy.signature.verifierCandidate.sha256}`);
  assert.equal(receipt.verification.digest, policy.indexDigest);
  assert.equal(receipt.verification.artifacts['changed-index.json'],
    'sha256:119952d007da1aecb65419d674feaa8019cc2df57f72a83be82dee7683cd55fc');
});

test('should reject tampered bundle linkage, wrong native error classes and expired verification roles', async () => {
  const { createTrustReceipt } = await import('./qualify-trust-receipt.mjs');
  const retained = JSON.parse(await readFile('docs/security/sec5a-trust-custody.json', 'utf8'));
  const bundleName = 'bundle-356b2dc09aa14e36a3a6fb88708f224261c1d8f451e502310308800b8e05bfb6.json';
  const original = { dsseEnvelope: { signatures: [{ sig: Buffer.from([0x30, 1, 2]).toString('base64') }] } };
  const changed = structuredClone(original);
  changed.dsseEnvelope.signatures[0].sig = Buffer.from([0x30, 1, 3]).toString('base64');
  const files = {
    cosign: 'fixture executable', 'index.json': 'fixture index', 'manifest.json': '{}', 'config.json': '{}',
    [bundleName]: JSON.stringify(original), 'wrong-bundle.json': JSON.stringify(changed),
    'wrong-root.json': '{}', 'changed-index.json': 'fixture index\n',
    'trusted_root.json': Buffer.from(retained.trustedRootRawBase64, 'base64'), 'tls-roots.pem': 'fixture CA',
    'offline-verification.log': 'Verified OK',
    'changed-index.log': 'provided artifact digests do not match',
    'changed-root.log': 'leaf certificate verification failed',
    'changed-bundle.log': 'transparency log signature does not match',
    'trust-trials.jsonl': retained.verification.trials.map(t => JSON.stringify(t)).join('\n'),
    'trust-verified-at.txt': retained.observedAt, 'tuf-home.txt': 'tuf-home.fixture',
  };
  files['bundle-manifest.json'] = JSON.stringify({ layers: [{ digest: digest(files[bundleName]) }] });
  const rolePath = role => `tuf-home.fixture/.sigstore/root/tuf-repo-cdn.sigstore.dev/${role}.json`;
  for (const [role, entry] of Object.entries(retained.metadata)) {
    files[rolePath(role)] = Buffer.from(entry.rawBase64, 'base64');
  }
  const pins = Object.fromEntries(['cosign', 'index.json', 'manifest.json', 'config.json', 'bundle-manifest.json']
    .map(file => [file, digest(files[file])]));
  const run = (overrides = {}) => createTrustReceipt(async file => {
    assert.ok(Object.hasOwn(files, file), `unexpected evidence read: ${file}`);
    return Buffer.from(overrides[file] ?? files[file]);
  }, pins);
  const positive = await run();
  assert.deepEqual(positive.verification.trials, retained.verification.trials);
  assert.equal(positive.refreshBy, retained.metadata.timestamp.document.signed.expires);
  const earlierRoot = structuredClone(retained.metadata.root.document);
  earlierRoot.signed.expires = '2026-10-31T00:00:00Z';
  assert.equal((await run({ [rolePath('root')]: JSON.stringify(earlierRoot) })).refreshBy,
    earlierRoot.signed.expires);
  await assert.rejects(run({ [bundleName]: JSON.stringify({ ...original, tampered: true }) }),
    { code: 'ERR_ASSERTION', operator: 'strictEqual' });
  for (const trial of ['changed-index', 'changed-root', 'changed-bundle']) {
    await assert.rejects(run({ [`${trial}.log`]: 'container startup failed' }),
      { code: 'ERR_ASSERTION', operator: 'match' });
  }
  for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
    const document = structuredClone(retained.metadata[role].document);
    document.signed.expires = retained.observedAt;
    await assert.rejects(run({ [rolePath(role)]: JSON.stringify(document) }),
      new RegExp(`${role} expired at verification`));
  }
  const hashedSnapshot = structuredClone(retained.metadata.snapshot.document);
  hashedSnapshot.signed.meta['targets.json'] = { ...hashedSnapshot.signed.meta['targets.json'],
    hashes: { sha256: 'superseded-targets-digest' } };
  await assert.rejects(run({ [rolePath('snapshot')]: JSON.stringify(hashedSnapshot) }),
    /snapshot pins a superseded targets digest/);
  for (const [index, trial] of retained.verification.trials.entries()) {
    const trials = structuredClone(retained.verification.trials);
    trials[index].exitCode = trial.exitCode === 0 ? 1 : 0;
    await assert.rejects(run({ 'trust-trials.jsonl': trials.map(t => JSON.stringify(t)).join('\n') }),
      { code: 'ERR_ASSERTION' });
  }
});

test('should bound retained custody freshness by its earliest role expiry', async () => {
  const receipt = JSON.parse(await readFile('docs/security/sec5a-trust-custody.json', 'utf8'));
  assert.equal(receipt.refreshBy, '2026-11-06T01:22:45Z');
  assert.ok(Date.parse(receipt.refreshBy) > Date.parse(receipt.observedAt));
  for (const entry of Object.values(receipt.metadata)) {
    assert.ok(Date.parse(receipt.refreshBy) <= Date.parse(entry.document.signed.expires));
  }
  const doc = await readFile('docs/security/sec5a-trust-custody.md', 'utf8');
  assert.match(doc, /Refresh by `2026-11-06T01:22:45Z`/);
  assert.match(doc, /After that deadline, this snapshot is historical evidence only/);
});

test('should leave consensus pending without published exact-target reviews', async () => {
  const review = await readFile('docs/security/sec-s2b-qualify-review.md', 'utf8');
  assert.match(review, /^status: pending-independent-review$/m);
  assert.match(review, /^runtime-admission: denied$/m);
  assert.doesNotMatch(review, /consensus-evidence-approved|^review-[12]:|Both independent reviewers|review gap is closed/m);
});

test('should require reviewed content pins, exact publisher and index/platform linkage', () => {
  const p = structuredClone(policy);
  const configBytes = JSON.stringify({ os: 'linux', architecture: 'amd64', config: { Labels: {
    'org.opencontainers.image.version': p.version, 'org.opencontainers.image.revision': p.revision,
  } } });
  p.configDigest = digest(configBytes);
  const manifestBytes = JSON.stringify({ config: { digest: p.configDigest, size: Buffer.byteLength(configBytes) } });
  p.manifestDigest = digest(manifestBytes);
  const indexBytes = JSON.stringify({ manifests: [{ platform: { os: 'linux', architecture: 'amd64' },
    digest: p.manifestDigest, size: Buffer.byteLength(manifestBytes) }] });
  p.indexDigest = digest(indexBytes);
  const signature = { verified: true, digest: p.indexDigest, issuer: p.signature.issuer,
    identity: p.signature.identity, bundleHash: digest('bundle') };
  const evidence = { indexBytes, manifestBytes, configBytes, signature };
  assert.equal(validateScanner(evidence, p).version, p.version);
  for (const changed of [{ ...evidence, configBytes: `${configBytes} ` },
    ...[{ issuer: 'https://evil.example' }, { identity: `${signature.identity}-evil` }, { digest: digest('other') },
      { verified: false }].map((delta) => ({ ...evidence, signature: { ...signature, ...delta } }))]) {
    assert.throws(() => validateScanner(changed, p), /coverage-blocked/);
  }
  for (const delta of [{ platform: 'linux/arm64' }, { version: '0.69.4' }, { version: '0.71.0' },
    { indexDigest: 'latest' }, { repository: 'mirror.example/trivy' }]) {
    assert.throws(() => validateScanner(evidence, { ...p, ...delta }), /coverage-blocked/);
  }
});

test('should refuse unknown repositories before network access and bound rate-limit retries', async () => {
  let calls = 0;
  const client = createOciClient({ fetcher: async () => { calls++; return new Response('{}'); } });
  await assert.rejects(client.resolve('evil'), /untrusted OCI repository/);
  assert.equal(calls, 0);
  const sleeps = [];
  const limited = createOciClient({ fetcher: async () => { calls++; return new Response('', {
    status: 429, headers: { 'retry-after': '2' } }); }, sleep: async (ms) => sleeps.push(ms) });
  await assert.rejects(limited.resolve('vulnerability'), /rate-limit/);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [2000, 2000]);
  for (const retry of ['999999', 'invalid']) {
    const c = createOciClient({ fetcher: async () => new Response('', { status: 503,
      headers: { 'retry-after': retry } }), sleep: async () => assert.fail('must stop') });
    await assert.rejects(c.resolve('java'), /rate-limit/);
  }
  await assert.rejects(createOciClient({ fetcher: async () => { throw new Error('offline'); } })
    .resolve('vulnerability'), /transport unavailable/);
});

test('should verify OCI bytes and refuse redirects to untrusted blob hosts', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'trivy-oci-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from('database');
  const manifest = { schemaVersion: 2, layers: [{ digest: digest(payload), size: payload.length }] };
  let redirect = false;
  const urls = [];
  const client = createOciClient({ fetcher: async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, 'manual');
    if (url.includes('/token?')) return Response.json({ token: 'anonymous' });
    if (url.includes('/manifests/')) return Response.json(manifest);
    return redirect ? new Response('', { status: 302, headers: { location: 'https://evil.example/db' } })
      : new Response(payload);
  } });
  const source = await client.resolve('vulnerability');
  await source.download(join(root, 'blob'));
  assert.deepEqual(await readFile(join(root, 'blob')), payload);
  redirect = true;
  await assert.rejects(source.download(join(root, 'bad')), /untrusted OCI redirect/);
  assert.ok(urls.every((url) => url.startsWith('https://ghcr.io/')));
});

test('should freeze one DB per campaign and reject corrupted or expired restored bytes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'trivy-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'trivy.db'), 'fixture-db');
  await writeFile(join(root, 'metadata.json'), JSON.stringify(metadata()));
  const archive = join(root, 'fixture.tgz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', root, 'trivy.db', 'metadata.json']).status, 0);
  const payload = await readFile(archive);
  const layer = { digest: digest(payload), size: payload.length };
  const manifestBytes = Buffer.from(JSON.stringify({ schemaVersion: 2, layers: [layer] }));
  let acquisitions = 0;
  const acquire = campaignAcquirer({ resolve: async () => {
    acquisitions++;
    return { repository: policy.data.vulnerability.repository, manifestBytes, manifestDigest: digest(manifestBytes), layer,
      download: async (path) => writeFile(path, payload) };
  } });
  const pending = acquire('vulnerability', root, now);
  assert.equal(acquire('vulnerability', root, now + 1), pending);
  const snapshot = await pending;
  assert.equal(acquisitions, 1);
  await assert.rejects(restoreSnapshot({ ...snapshot, path: join(root, 'absent') }, now),
    /coverage-blocked: required cache files unavailable/);
  assert.equal((await restoreSnapshot(snapshot, now)).kind, 'vulnerability');
  await assert.rejects(restoreSnapshot(snapshot, Date.parse('2026-10-30T06:00:01Z')), /freshness/);
  await assert.rejects(restoreSnapshot({ ...snapshot, receiptHash: digest('wrong') }, now), /receipt integrity/);
  await chmod(join(snapshot.path, 'trivy.db'), 0o600);
  await writeFile(join(snapshot.path, 'trivy.db'), 'corrupt');
  await assert.rejects(restoreSnapshot(snapshot, now), /cache integrity/);
  await rm(join(snapshot.path, 'trivy.db'));
  await assert.rejects(restoreSnapshot(snapshot, now), /coverage-blocked: required cache files unavailable/);
  assert.equal(acquisitions, 1, 'restoration must never acquire replacement bytes');
});

test('should reject mismatched OCI bytes and stop when the shared acquisition budget expires', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'trivy-corrupt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const responses = [Response.json({ token: 'anonymous' }), Response.json({ schemaVersion: 2,
    layers: [{ digest: digest('good'), size: 4 }] }), new Response('evil')];
  const source = await createOciClient({ fetcher: async () => responses.shift() }).resolve('vulnerability');
  await assert.rejects(source.download(join(root, 'blob')), /layer integrity/);
  await assert.rejects(readFile(join(root, 'blob')), /ENOENT/);
  let time = 0;
  const budgeted = createOciClient({ now: () => time, fetcher: async () => new Response('', {
    status: 429, headers: { 'retry-after': '1' } }), sleep: async () => { time += 120001; } });
  await assert.rejects(budgeted.resolve('vulnerability'), /budget exhausted/);
});

test('should reject archive traversal and links before extraction and retain failed campaign state', async (t) => {
  for (const unsafe of ['traversal', 'link']) {
    const root = await mkdtemp(join(tmpdir(), 'trivy-archive-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, 'trivy.db'), 'db');
    await writeFile(join(root, 'metadata.json'), JSON.stringify(metadata()));
    if (unsafe === 'link') {
      await rm(join(root, 'trivy.db'));
      const { symlink } = await import('node:fs/promises');
      await symlink('/etc/passwd', join(root, 'trivy.db'));
    }
    const archive = join(root, 'unsafe.tgz');
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', root,
      ...(unsafe === 'traversal' ? ['--transform=s|^|../|'] : []), 'trivy.db', 'metadata.json']).status, 0);
    const payload = await readFile(archive);
    const layer = { digest: digest(payload), size: payload.length };
    const manifestBytes = Buffer.from(JSON.stringify({ layers: [layer] }));
    let calls = 0;
    const acquire = campaignAcquirer({ resolve: async () => {
      calls++;
      return { repository: policy.data.vulnerability.repository, manifestBytes, manifestDigest: digest(manifestBytes), layer,
        download: async (path) => writeFile(path, payload) };
    } });
    const pending = acquire('vulnerability', root, now);
    await assert.rejects(pending, /archive paths|archive links/);
    assert.equal(acquire('vulnerability', root, now), pending);
    assert.equal(calls, 1);
  }
});

test('should bound Java independently without increasing vulnerability layer limits', async () => {
  const measured = 991026356;
  const resolveSize = (kind, size) => createOciClient({ fetcher: async (url) => url.includes('/token?')
    ? Response.json({ token: 'anonymous' }) : Response.json({ schemaVersion: 2,
      layers: [{ digest: digest('bounded-layer'), size }] }) }).resolve(kind);
  assert.equal((await resolveSize('java', measured)).layer.size, measured);
  for (const kind of ['java', 'vulnerability']) {
    await assert.rejects(resolveSize(kind, policy.data[kind].maxLayerBytes + 1), /layer descriptor/);
    await assert.rejects(resolveSize(kind, 0), /layer descriptor/);
  }
  await assert.rejects(resolveSize('vulnerability', measured), /layer descriptor/);
  assert.equal(policy.data.java.maxExpandedBytes, 2 * 1024 ** 3);
  assert.equal(policy.data.vulnerability.maxExpandedBytes, 4 * 1024 ** 3);
});

test('should refuse expired TUF roots and version or digest rollbacks', () => {
  const verifiedAt = Date.parse('2026-10-30T00:00:00Z');
  const documents = {
    root: { signed: { _type: 'root', version: 1, expires: '2027-01-01T00:00:00Z' } },
    timestamp: { signed: { _type: 'timestamp', version: 3, expires: '2026-11-06T00:00:00Z',
      meta: { 'snapshot.json': { version: 5, hashes: { sha256: 'aaa' } } } } },
    snapshot: { signed: { _type: 'snapshot', version: 5, expires: '2026-11-06T00:00:00Z',
      meta: { 'targets.json': { version: 7 } } } },
    targets: { signed: { _type: 'targets', version: 7, expires: '2026-11-06T00:00:00Z' } },
  };
  const digests = { root: 'sha256:r', timestamp: 'sha256:t', snapshot: 'sha256:aaa', targets: 'sha256:g' };
  assert.equal(validateTufMetadata(documents, digests, verifiedAt), true);
  const expired = { ...documents, root: { signed: { ...documents.root.signed, expires: '2026-10-29T23:59:59Z' } } };
  assert.throws(() => validateTufMetadata(expired, digests, verifiedAt), /root expired at verification/);
  const mistyped = { ...documents, snapshot: { signed: { ...documents.snapshot.signed, _type: 'timestamp' } } };
  assert.throws(() => validateTufMetadata(mistyped, digests, verifiedAt), /snapshot metadata is incomplete/);
  const rolledVersion = { ...documents,
    snapshot: { signed: { ...documents.snapshot.signed, version: 4 } } };
  assert.throws(() => validateTufMetadata(rolledVersion, digests, verifiedAt), /no longer pins current snapshot/);
  const rolledDigest = { ...digests, snapshot: 'sha256:bbb' };
  assert.throws(() => validateTufMetadata(documents, rolledDigest, verifiedAt), /superseded snapshot digest/);
  const unpinned = { ...documents,
    timestamp: { signed: { _type: 'timestamp', version: 3, expires: '2026-11-06T00:00:00Z', meta: {} } } };
  assert.throws(() => validateTufMetadata(unpinned, digests, verifiedAt), /no longer pins current snapshot/);
  const rolledTargets = { ...documents,
    targets: { signed: { ...documents.targets.signed, version: 6 } } };
  assert.throws(() => validateTufMetadata(rolledTargets, digests, verifiedAt), /no longer pins current targets/);
  const zeroVersion = { ...documents,
    snapshot: { signed: { ...documents.snapshot.signed, version: 0 } } };
  assert.throws(() => validateTufMetadata(zeroVersion, digests, verifiedAt), /snapshot metadata is incomplete/);
  const fractional = { ...documents,
    snapshot: { signed: { ...documents.snapshot.signed, version: 5.5 } },
    timestamp: { signed: { ...documents.timestamp.signed,
      meta: { 'snapshot.json': { version: 5.5, hashes: { sha256: 'aaa' } } } } } };
  assert.throws(() => validateTufMetadata(fractional, digests, verifiedAt), /snapshot metadata is incomplete/);
  const badExpiry = { ...documents,
    timestamp: { signed: { ...documents.timestamp.signed, expires: 'not-a-date' } } };
  assert.throws(() => validateTufMetadata(badExpiry, digests, verifiedAt), /timestamp metadata is incomplete/);
  assert.throws(() => validateTufMetadata(documents, digests, NaN), /coverage-blocked/);
  assert.throws(() => validateTufMetadata({ ...documents, targets: null }, digests, verifiedAt), /coverage-blocked/);
});

test('should give each data kind its own bounded transfer clock', async () => {
  let time = 0;
  const signals = [];
  const client = createOciClient({ now: () => time, fetcher: async (url, options) => {
    signals.push(options.signal);
    return url.includes('/token?') ? Response.json({ token: 'anonymous' }) : Response.json({ schemaVersion: 2,
      layers: [{ digest: digest('db'), size: 2 }] });
  } });
  await client.resolve('vulnerability');
  time = 120001;
  assert.equal((await client.resolve('java')).kind, 'java');
  assert.ok(signals.every(signal => !signal.aborted));
});
