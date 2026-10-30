import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest, isDigest, policy, requireEvidence, validateFreshness } from './toolchain-contract.mjs';
import { verifyManifest } from './toolchain-oci.mjs';

export async function hashFile(path) {
  const stat = await lstat(path);
  requireEvidence(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 ** 3, 'cache file type/size');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return `sha256:${hash.digest('hex')}`;
}
function extract(archive, directory, filename, maxExpandedBytes) {
  const run = (args) => {
    const result = spawnSync('tar', args, { env: { PATH: '/usr/bin:/bin', LANG: 'C' },
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    requireEvidence(result.status === 0 && !result.error && !result.signal, 'DB archive decoding');
    return result.stdout.trim().split('\n');
  };
  const names = run(['-tzf', archive]);
  requireEvidence(names.length === 2 && new Set(names).size === 2 &&
    names.every((name) => [filename, 'metadata.json'].includes(name)), 'DB archive paths');
  const entries = run(['-tvzf', archive]);
  requireEvidence(entries.length === 2 && entries.every((entry) => entry.startsWith('-')), 'DB archive links/type');
  const sizes = entries.map((entry) => Number(entry.split(/\s+/)[2]));
  requireEvidence(sizes.every((size) => Number.isSafeInteger(size) && size >= 0) &&
    sizes.reduce((total, size) => total + size, 0) <= maxExpandedBytes, 'DB expanded byte bound');
  run(['-xzf', archive, '--directory', directory, '--no-same-owner', '--no-same-permissions', '--', ...names]);
}

// One campaign owns one promise per data kind, including failures. A retry cannot change its snapshot.
export function campaignAcquirer(client) {
  const acquisitions = new Map();
  return (kind, root, now = Date.now()) => {
    if (!acquisitions.has(kind)) acquisitions.set(kind, acquire(client, kind, root, now));
    return acquisitions.get(kind);
  };
}
async function acquire(client, kind, root, now) {
  requireEvidence(['vulnerability', 'java'].includes(kind), 'unqualified IaC bundle acquisition');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const parent = await lstat(root);
  requireEvidence(parent.isDirectory() && (parent.mode & 0o077) === 0, 'trusted private cache directory');
  const source = await client.resolve(kind); // Origin is validated before any cache payload is written.
  const manifest = verifyManifest(source.manifestBytes, source.manifestDigest);
  requireEvidence(source.repository === policy.data[kind].repository &&
    manifest.layers[0].digest === source.layer.digest, 'cache source provenance');
  const scratch = await mkdtemp(join(root, '.ingest-'));
  const filename = kind === 'java' ? 'trivy-java.db' : 'trivy.db';
  try {
    const archive = join(scratch, 'layer.tgz');
    await source.download(archive);
    requireEvidence(await hashFile(archive) === source.layer.digest, 'downloaded layer hash');
    extract(archive, scratch, filename, policy.data[kind].maxExpandedBytes);
    const metadataBytes = await readFile(join(scratch, 'metadata.json'));
    const observedAt = new Date(now).toISOString();
    const metadata = { ...JSON.parse(metadataBytes), DownloadedAt: observedAt };
    validateFreshness(metadata, policy.data[kind].schema, now);
    await writeFile(join(scratch, 'metadata.json'), JSON.stringify(metadata));
    await writeFile(join(scratch, 'manifest.json'), source.manifestBytes);
    const receipt = { schema: 1, kind, repository: source.repository, scannerVersion: policy.version,
      manifestDigest: source.manifestDigest, layerDigest: source.layer.digest, observedAt,
      sourceMetadataHash: digest(metadataBytes), metadata, files: {} };
    for (const name of [filename, 'metadata.json', 'manifest.json', 'layer.tgz']) {
      receipt.files[name] = await hashFile(join(scratch, name));
      await chmod(join(scratch, name), 0o444);
    }
    const bytes = JSON.stringify(receipt);
    await writeFile(join(scratch, 'receipt.json'), bytes, { mode: 0o444 });
    const key = `${kind}-${metadata.Version}-${source.manifestDigest.slice(7)}-${policy.version}`;
    const path = join(root, key);
    await rename(scratch, path); // Atomic publication; never merge partially populated cache trees.
    return { path, receiptHash: digest(bytes), manifestDigest: source.manifestDigest };
  } catch (error) { await rm(scratch, { recursive: true, force: true }); throw error; }
}

export async function restoreSnapshot({ path, receiptHash, manifestDigest }, now = Date.now()) {
  requireEvidence(isDigest(receiptHash) && isDigest(manifestDigest), 'trusted cache receipt identity');
  try {
    return await restoreFiles({ path, receiptHash, manifestDigest }, now);
  } catch (error) {
    requireEvidence(!['ENOENT', 'ENOTDIR'].includes(error.code), 'required cache files unavailable');
    throw error;
  }
}

async function restoreFiles({ path, receiptHash, manifestDigest }, now) {
  const receiptStat = await lstat(join(path, 'receipt.json'));
  requireEvidence(receiptStat.isFile() && receiptStat.size <= 65536, 'cache receipt type/size');
  const bytes = await readFile(join(path, 'receipt.json'));
  requireEvidence(digest(bytes) === receiptHash, 'cache receipt integrity');
  const receipt = JSON.parse(bytes);
  const expected = policy.data[receipt.kind];
  requireEvidence(expected && ['vulnerability', 'java'].includes(receipt.kind) && receipt.schema === 1 &&
    receipt.repository === expected.repository && receipt.scannerVersion === policy.version &&
    receipt.manifestDigest === manifestDigest && isDigest(receipt.layerDigest), 'cache provenance/compatibility');
  const filename = receipt.kind === 'java' ? 'trivy-java.db' : 'trivy.db';
  requireEvidence(Object.keys(receipt.files).sort().join(',') ===
    [filename, 'metadata.json', 'manifest.json', 'layer.tgz'].sort().join(','), 'cache file inventory');
  for (const [name, expectedHash] of Object.entries(receipt.files)) {
    requireEvidence(isDigest(expectedHash) && await hashFile(join(path, name)) === expectedHash, 'restored cache integrity');
  }
  requireEvidence(receipt.files['manifest.json'] === manifestDigest && receipt.files['layer.tgz'] === receipt.layerDigest,
    'restored OCI identities');
  const manifest = verifyManifest(await readFile(join(path, 'manifest.json')), manifestDigest);
  requireEvidence(manifest.layers?.length === 1 && manifest.layers[0].digest === receipt.layerDigest, 'cache OCI linkage');
  const metadata = JSON.parse(await readFile(join(path, 'metadata.json')));
  requireEvidence(JSON.stringify(metadata) === JSON.stringify(receipt.metadata) &&
    receipt.observedAt === metadata.DownloadedAt, 'cache metadata identity');
  validateFreshness(metadata, expected.schema, now);
  return receipt;
}
