// Live-artifact and real loopback-TCP trials; clock replays are explicitly labelled.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmod, open, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { digest, assertQualified, validateFreshness } from './toolchain-contract.mjs';
import { restoreSnapshot } from './toolchain-cache.mjs';
import { createOciClient } from './toolchain-oci.mjs';
import { validateComparison, executeImageScan } from './trivy.mjs';

const ingestion = JSON.parse(await readFile('/evidence/ingestion.json'));
const snapshots = ingestion.snapshots;
const results = [];
async function rejects(name, action, expected, extra = {}) {
  const started = performance.now();
  let message;
  try { await action(); } catch (error) { message = error.message; }
  assert.match(message || 'unexpected success', expected, name);
  results.push({ name, result: 'rejected', message, elapsedMs: performance.now() - started, ...extra });
}
await rejects('actual network cut: GHCR with --network=none', () => createOciClient().resolve('vulnerability'), /transport unavailable/);
let received = 0;
const server = createServer((_request, response) => {
  received++;
  response.writeHead(429, { 'Retry-After': '0' }).end('qualification fault server');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  await rejects('actual loopback TCP 429 exhaustion', () => createOciClient({ fetcher: (_url, options) =>
    fetch(`http://127.0.0.1:${server.address().port}`, options) }).resolve('vulnerability'), /rate-limit/,
  { faultSource: 'controlled HTTP server, not upstream GHCR' });
  assert.equal(received, 3);
  results.at(-1).receivedRequests = received;
} finally { await new Promise(resolve => server.close(resolve)); }
await rejects('untrusted source before any request', () => createOciClient({ fetcher: () => assert.fail('network forbidden') })
  .resolve('evil'), /untrusted OCI repository/);
await rejects('absent cache', () => restoreSnapshot({ ...snapshots.java, path: '/evidence/absent-cache' }), /ENOENT/);
await rejects('wrong trusted receipt hash', () => restoreSnapshot({ ...snapshots.java, receiptHash: digest('changed') }), /receipt integrity/);
const expiredBytes = await readFile('/expired-metadata.json');
const expiredMetadata = JSON.parse(expiredBytes);
await rejects('actual wall-clock expiry of retained 2026-10-23 upstream metadata', () =>
  validateFreshness(expiredMetadata, 2), /freshness/, { sourceMetadataHash: digest(expiredBytes),
  metadata: expiredMetadata, clock: 'actual current UTC clock' });
const snapshot = snapshots.vulnerability;
const database = `${snapshot.path}/trivy.db`;
await chmod(database, 0o600);
const file = await open(database, 'r+');
const first = Buffer.alloc(1);
await file.read(first, 0, 1, 0);
try {
  await file.write(Buffer.from([first[0] ^ 255]), 0, 1, 0);
  await rejects('one-byte corruption of real upstream DB', () => restoreSnapshot(snapshot), /cache integrity/);
} finally {
  await file.write(first, 0, 1, 0);
  await file.close();
  await chmod(database, 0o444);
}
await restoreSnapshot(snapshot);
const receiptPath = `${snapshot.path}/receipt.json`;
const original = await readFile(receiptPath);
const changed = JSON.parse(original);
changed.scannerVersion = '0.0.0';
const incompatible = JSON.stringify(changed);
await chmod(receiptPath, 0o600);
try {
  await writeFile(receiptPath, incompatible);
  await rejects('incompatible scanner on actual cached files', () => restoreSnapshot({ ...snapshot,
    receiptHash: digest(incompatible) }), /compatibility/);
} finally { await writeFile(receiptPath, original); await chmod(receiptPath, 0o444); }
await restoreSnapshot(snapshot);
const expiredAt = Math.min(...Object.values(snapshots).map(s => Math.min(Date.parse(s.receipt.metadata.NextUpdate),
  Date.parse(s.receipt.metadata.UpdatedAt) + 86400000))) + 1;
await rejects('expiry-before-merge clock replay on real DB', () => restoreSnapshot(snapshot, expiredAt + 86400000), /freshness/,
  { clock: 'injected future clock; no live merge or wall-clock wait claimed' });
const before = { status: 0, rawHash: digest('before'), target: { key: 'api-production', platform: 'linux/amd64' },
  parametersHash: digest('flags'), policyHash: digest('policy'), scannerIdentity: { version: '0.76.1' },
  databaseIdentity: Object.fromEntries(Object.entries(snapshots).map(([kind, s]) => [kind,
    { manifestDigest: s.manifestDigest, receiptHash: s.receiptHash }])), snapshots };
const after = { ...before, databaseIdentity: { ...before.databaseIdentity, java: { receiptHash: digest('new snapshot') } } };
await rejects('changed snapshot invalidates comparison', () => validateComparison(before, after), /rescan both inputs/);
await rejects('rollback: restored blocked S2a state', () => executeImageScan({}, {}, () => assert.fail('must not execute')), /qualification pending/);
const rollbackPolicy = JSON.parse(await readFile('/evidence/rollback-policy.json'));
await rejects('rollback: previous main policy refuses admission', () => assertQualified(rollbackPolicy), /qualification pending/);
assert.throws(() => assertQualified(), /qualification pending/);
for (const s of Object.values(snapshots)) validateFreshness(s.receipt.metadata, s.receipt.metadata.Version);
await writeFile('/evidence/failure-trials.json', `${JSON.stringify({ observedAt: new Date().toISOString(), results,
  restoredOriginalBytes: true, serviceQualified: false }, null, 2)}\n`);
console.log(JSON.stringify({ trials: results.length, restoredOriginalBytes: true }));
