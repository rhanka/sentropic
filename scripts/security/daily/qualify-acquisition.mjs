// Explicit qualification experiment, never an admission or service entry point.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { digest, policy, requireEvidence } from './toolchain-contract.mjs';

const root = '/evidence';
await mkdir(root, { recursive: true });
const kind = process.argv[2];
requireEvidence(['vulnerability', 'java', 'checks'].includes(kind), 'qualification data kind');
const repository = policy.data[kind].repository.replace('ghcr.io/', '');
const started = performance.now();
const request = (url, headers = {}) => fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(120000) });
const auth = await request(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`);
requireEvidence(auth.ok, 'qualification anonymous registry access');
const { token } = await auth.json();
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.manifest.v1+json' };
const manifestResponse = await request(`https://ghcr.io/v2/${repository}/manifests/${policy.data[kind].tag}`, headers);
requireEvidence(manifestResponse.ok, 'qualification manifest access');
const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
requireEvidence(manifestBytes.length <= 1048576, 'qualification manifest bound');
const manifest = JSON.parse(manifestBytes);
requireEvidence(manifest.schemaVersion === 2 && manifest.layers?.length === 1, 'qualification single layer');
const layer = manifest.layers[0];
// Measurement ceiling only: this does not change the production ingestion policy.
requireEvidence(layer.size > 0 && layer.size <= 1280 * 1024 ** 2, 'qualification compressed bound');
await writeFile(`${root}/${kind}-manifest.json`, manifestBytes);
let response = await request(`https://ghcr.io/v2/${repository}/blobs/${layer.digest}`, headers);
if ([301, 302, 303, 307, 308].includes(response.status)) {
  const destination = new URL(response.headers.get('location'));
  requireEvidence(destination.protocol === 'https:' && destination.hostname === 'pkg-containers.githubusercontent.com' &&
    !destination.username && !destination.password && !destination.port, 'qualification redirect');
  await response.body?.cancel();
  response = await request(destination.href);
}
requireEvidence(response.ok, 'qualification blob access');
const file = await open(`${root}/${kind}.tgz`, 'w', 0o600);
const hash = createHash('sha256');
let compressedBytes = 0;
const transferStarted = performance.now();
try {
  for await (const chunk of response.body) {
    compressedBytes += chunk.length;
    requireEvidence(compressedBytes <= layer.size && performance.now() - started < 120000, 'qualification transfer bound');
    hash.update(chunk);
    await file.writeFile(chunk);
  }
} finally { await file.close(); }
requireEvidence(compressedBytes === layer.size && `sha256:${hash.digest('hex')}` === layer.digest, 'qualification layer integrity');
const transferMs = performance.now() - transferStarted;
const listStarted = performance.now();
const listing = spawnSync('tar', ['-tvzf', `${root}/${kind}.tgz`], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 ** 2 });
requireEvidence(listing.status === 0, 'qualification archive listing');
await writeFile(`${root}/${kind}-listing.txt`, listing.stdout);
const entries = listing.stdout.trim().split('\n');
const expandedBytes = entries.reduce((total, entry) => total + Number(entry.split(/\s+/)[2]), 0);
const report = { observedAt: new Date().toISOString(), kind, repository: policy.data[kind].repository,
  manifestDigest: digest(manifestBytes), layerDigest: layer.digest, compressedBytes, expandedBytes,
  transferMs, listingMs: performance.now() - listStarted, elapsedMs: performance.now() - started,
  nodeMaxRssKiB: process.resourceUsage().maxRSS, entries, qualified: false };
await writeFile(`${root}/${kind}-measurement.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
