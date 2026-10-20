import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { readArchive, scanGraph, graphRoots } from './contract-graph.mjs';
import { checkArtifactManifest } from './receipt.mjs';
import { LOCK_FINGERPRINT_VERSION, computeLockFingerprint } from './lock-fingerprint.mjs';
import { P1_CONFIG_FILES } from './build-inputs.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
export const ANCILLARY = [
  'tools/memory-mcp-l5/schemas/checkpoint-v1.schema.json',
  'tools/memory-mcp-l5/schemas/artifact-manifest-v1.schema.json',
  'tools/memory-mcp-l5/proof-catalog-v1.json', 'tools/memory-mcp-l5/exports-v1.json',
  'tools/memory-mcp-l5/fixtures/l0/60a8bfa828b5eabd360232ea5865391c23f99f48/index.json',
  'tools/memory-mcp-l5/fixtures/l0/60a8bfa828b5eabd360232ea5865391c23f99f48/memory-mcp-spec-rules.ts',
  'tools/memory-mcp-l5/fixtures/l0/60a8bfa828b5eabd360232ea5865391c23f99f48/memory-mcp-sol-rules.ts',
  'tools/memory-mcp-l5/fixtures/l0/tool-schemas.json', 'tools/memory-mcp-l5/fixtures/l0/schema-assets.sha256',
  'spec/evidence/memory-mcp-l5/l0-freeze.json',
  'packages/mcp-platform/etc/mcp-platform.api.md', 'packages/mcp-platform/etc/mcp-platform-memory.api.md',
];
export function readInside(root, path) {
  const full = resolve(root, path), rel = relative(root, full);
  if (!rel || rel.startsWith('..') || rel.startsWith('/')) throw new Error(`manifest path escapes root: ${path}`);
  return readFileSync(full);
}
export function consumedInventory(root, files, packages, report) {
  if (report.failures.length) throw new Error(report.failures.join('\n'));
  const paths = new Set([...report.resolvedFiles, ...[...packages.values()].map(p => `${p.prefix}/package.json`)]);
  const inventory = [...paths].map(path => ({ path,
    version: [...packages.values()].find(p => path.startsWith(`${p.prefix}/`)).manifest.version,
    sha256: sha256(files.get(path)) }));
  for (const path of ANCILLARY) {
    const owner = [...packages.values()].find(p => path.startsWith(`${p.prefix}/`));
    inventory.push({ path, version: owner?.manifest.version ?? '1.0.0', sha256: sha256(readInside(root, path)) });
  }
  return inventory.sort((a, b) => a.path.localeCompare(b.path));
}

/** Verifies immutable manifest bytes, archives, packed closure, metadata and exact inventory. */
export function verifyPreCandidate(root, manifestPath) {
  const bytes = readInside(root, manifestPath), digest = sha256(bytes);
  if (readInside(root, `${manifestPath}.sha256`).toString() !== `${digest}\n`) throw new Error('manifest SHA-256 sidecar mismatch');
  const manifest = JSON.parse(bytes), failures = checkArtifactManifest(manifest);
  if (failures.length) throw new Error(failures.join('\n'));
  if (manifest.stage !== 'pre-candidate' || manifest.artifacts.length !== 2) throw new Error('manifest must contain exactly the two P1 artifacts');
  const freeze = JSON.parse(readInside(root, 'spec/evidence/memory-mcp-l5/l0-freeze.json'));
  if (manifest.source.specSha256 !== freeze.specSha256 || manifest.source.l0Commit !== freeze.l0Commit) throw new Error('manifest freeze mismatch');
  const liveLock = JSON.parse(readInside(root, 'package-lock.json').toString('utf8'));
  const makefileText = readInside(root, 'Makefile').toString('utf8');
  const configFiles = Object.fromEntries(P1_CONFIG_FILES.map((path) => [path, readInside(root, path)]));
  if (manifest.source.lockFingerprintVersion !== LOCK_FINGERPRINT_VERSION ||
      manifest.source.lockFingerprint !== computeLockFingerprint({ lockDoc: liveLock, makefileText, configFiles })) {
    throw new Error('manifest P1 lock fingerprint mismatch: relevant dependency or build inputs changed; regenerate the P1 manifest');
  }
  const snapRef = manifest.source.declaredLockSnapshot;
  let snapBytes = null;
  try {
    snapBytes = snapRef && typeof snapRef.path === 'string' ? readInside(root, snapRef.path) : null;
  } catch {
    snapBytes = null;
  }
  const snapSha = snapBytes ? sha256(snapBytes) : null;
  if (!snapBytes || snapSha !== manifest.source.declaredLockSha256 || snapSha !== snapRef.sha256 ||
      String(snapRef.path).split('/').pop() !== `${snapSha}.package-lock.json`) {
    throw new Error('manifest P1 lock provenance snapshot missing or corrupt; regenerate the P1 manifest');
  }
  const packages = new Map(), files = new Map();
  for (const artifact of manifest.artifacts) {
    const name = artifact.role === 'platform' ? '@sentropic/mcp-platform' : artifact.role === 'broker' ? '@sentropic/mcp-broker' : null;
    if (!name || name !== artifact.name || packages.has(name) || artifact.sourceHead !== manifest.source.l5Head) throw new Error('manifest artifact identity mismatch');
    const archive = readInside(root, artifact.archive);
    if (sha256(archive) !== artifact.sha256 || integrity(archive) !== artifact.integrity) throw new Error('manifest archive digest/integrity mismatch');
    const members = readArchive(archive), pkg = JSON.parse(members.get('package.json'));
    if (pkg.name !== name || pkg.version !== artifact.version || JSON.stringify(Object.keys(pkg.exports)) !== '["./memory"]' ||
        pkg.main || pkg.types || pkg.typesVersions || pkg.scripts || pkg.devDependencies || pkg.peerDependencies) throw new Error('P1 packed public surface mismatch');
    const prefix = `packages/${name.split('/')[1]}`;
    packages.set(name, { prefix, manifest: pkg });
    for (const [path, data] of members) files.set(`${prefix}/${path}`, data);
  }
  for (const pkg of packages.values()) for (const [name, range] of Object.entries(pkg.manifest.dependencies ?? {})) {
    if (range !== `^${packages.get(name)?.manifest.version}`) throw new Error('P1 dependency closure mismatch');
  }
  const report = scanGraph(files, graphRoots(packages), packages);
  const inventory = consumedInventory(root, files, packages, report);
  const packedPaths = inventory.filter(i => files.has(i.path)).map(i => i.path).sort();
  if (JSON.stringify(packedPaths) !== JSON.stringify([...files.keys()].sort())) throw new Error('P1 archive contains bytes outside the consumed closure');
  if (JSON.stringify(inventory) !== JSON.stringify(manifest.contractInventory)) throw new Error('manifest consumed-contract inventory is not closed or has wrong digests');
  return { ...report, manifestSha256: digest, inventory, files, packages };
}
