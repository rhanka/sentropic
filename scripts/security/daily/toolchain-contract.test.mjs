import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertQualified, digest, policy, validateFreshness, validateScanner } from './toolchain-contract.mjs';
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
  assert.equal((await restoreSnapshot(snapshot, now)).kind, 'vulnerability');
  await assert.rejects(restoreSnapshot(snapshot, Date.parse('2026-10-30T06:00:01Z')), /freshness/);
  await assert.rejects(restoreSnapshot({ ...snapshot, receiptHash: digest('wrong') }, now), /receipt integrity/);
  await chmod(join(snapshot.path, 'trivy.db'), 0o600);
  await writeFile(join(snapshot.path, 'trivy.db'), 'corrupt');
  await assert.rejects(restoreSnapshot(snapshot, now), /cache integrity/);
});
