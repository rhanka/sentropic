#!/usr/bin/env node
// pack.mjs — L5 Lot 1 pre-candidate packer.
//
// Builds the exact platform/broker tarballs from their built dist output,
// hashes every consumed contract file, and writes then validates the
// ARTIFACT_MANIFEST from those exact bytes. Never fabricates proof: any
// missing contract file, unbuilt dist, tarball mismatch or manifest
// validation failure exits nonzero before writing.
//
// usage: pack.mjs --stage pre-candidate --manifest <out> --l5-head <sha>
//   --base <sha> [--root <dir>]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArtifactManifest } from './receipt.mjs';
import { LOCK_FINGERPRINT_VERSION, computeLockFingerprint } from './lock-fingerprint.mjs';
import { P1_CONFIG_FILES } from './build-inputs.mjs';
import { packMemoryClosure } from './minimal-pack.mjs';
import { verifyPreCandidate } from './precandidate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FROZEN_SPEC_SHA256 = 'f90c927964b44fdf6ad712eee9b894762250239384643a3790931c142d3aeeca';
const L0_COMMIT = '60a8bfa828b5eabd360232ea5865391c23f99f48';
const SDK_RANGE = '^1.31.0';

function arg(flag) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) throw new Error(`pack.mjs: missing required ${flag}`);
  return argv[i + 1];
}

const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readBytes(rootDir, relPath) {
  const abs = resolve(rootDir, relPath);
  if (!existsSync(abs)) throw new Error(`pack.mjs: missing contract file ${relPath}`);
  return readFileSync(abs);
}

function main() {
  const stage = arg('--stage');
  if (stage !== 'pre-candidate') throw new Error(`pack.mjs: unsupported stage ${stage}`);
  const manifestPath = arg('--manifest');
  const l5Head = arg('--l5-head');
  const base = arg('--base');
  if (!/^[0-9a-f]{40}$/.test(l5Head) || !/^[0-9a-f]{40}$/.test(base)) {
    throw new Error('pack.mjs: --l5-head and --base must be 40-hex commits');
  }
  const headLockSha = arg('--head-lock-sha');
  if (!/^[0-9a-f]{64}$/.test(headLockSha || '')) {
    throw new Error('pack.mjs: missing required --head-lock-sha (sha256 of HEAD:package-lock.json)');
  }
  const rootDir = resolve(arg('--root') || join(HERE, '..', '..'));

  const platformPkg = JSON.parse(readBytes(rootDir, 'packages/mcp-platform/package.json').toString('utf8'));
  const brokerPkg = JSON.parse(readBytes(rootDir, 'packages/mcp-broker/package.json').toString('utf8'));
  if (platformPkg.name !== '@sentropic/mcp-platform' || brokerPkg.name !== '@sentropic/mcp-broker') {
    throw new Error('pack.mjs: package identity mismatch');
  }

  const archivesDir = resolve(rootDir, 'tools/memory-mcp-l5/artifacts/archives');
  mkdirSync(archivesDir, { recursive: true });
  const { packed, inventory } = packMemoryClosure(rootDir, archivesDir, l5Head);

  const lockBytes = readBytes(rootDir, 'package-lock.json');
  if (sha256Of(lockBytes) !== headLockSha) {
    throw new Error('pack.mjs: package-lock.json differs from HEAD:package-lock.json; commit the lock change first so the P1 generation stays recoverable');
  }
  const declaredLockSha256 = sha256Of(lockBytes);
  const snapshotRel = `tools/memory-mcp-l5/artifacts/lock-snapshots/${declaredLockSha256}.package-lock.json`;
  const snapshotAbs = resolve(rootDir, snapshotRel);
  if (existsSync(snapshotAbs)) {
    if (!readFileSync(snapshotAbs).equals(lockBytes)) throw new Error('pack.mjs: lock snapshot path occupied by different bytes');
  } else {
    mkdirSync(dirname(snapshotAbs), { recursive: true });
    writeFileSync(snapshotAbs, lockBytes);
  }
  const makefileText = readBytes(rootDir, 'Makefile').toString('utf8');
  const configFiles = Object.fromEntries(P1_CONFIG_FILES.map((path) => [path, readBytes(rootDir, path)]));
  const manifest = {
    manifestVersion: 1,
    stage: 'pre-candidate',
    source: {
      specSha256: FROZEN_SPEC_SHA256,
      l0Commit: L0_COMMIT,
      br3Commit: base,
      l5Head,
      sdkRange: SDK_RANGE,
      declaredLockSha256,
      lockFingerprintVersion: LOCK_FINGERPRINT_VERSION,
      lockFingerprint: computeLockFingerprint({ lockDoc: JSON.parse(lockBytes.toString('utf8')), makefileText, configFiles }),
      declaredLockSnapshot: { path: snapshotRel, sha256: declaredLockSha256 },
    },
    artifacts: packed,
    contractInventory: inventory,
  };
  const failures = checkArtifactManifest(manifest);
  if (failures.length > 0) {
    throw new Error(`pack.mjs: manifest invalid: ${failures.join('; ')}`);
  }
  const inventoryJson = `"contractInventory": [\n${inventory.map(entry => `    ${JSON.stringify(entry)}`).join(',\n')}\n  ]`;
  const manifestJson = JSON.stringify({ ...manifest, contractInventory: [] }, null, 2)
    .replace('"contractInventory": []', () => inventoryJson);
  const bytes = Buffer.from(`${manifestJson}\n`, 'utf8');
  if (existsSync(resolve(rootDir, manifestPath)) && !readBytes(rootDir, manifestPath).equals(bytes)) {
    throw new Error('pack.mjs: immutable manifest already exists; retain it and select a new identity before packing');
  }
  mkdirSync(dirname(resolve(rootDir, manifestPath)), { recursive: true });
  writeFileSync(resolve(rootDir, manifestPath), bytes);
  const sidecar = `${manifestPath}.sha256`;
  writeFileSync(resolve(rootDir, sidecar), `${sha256Of(bytes)}\n`);
  verifyPreCandidate(rootDir, manifestPath);
  console.log(
    JSON.stringify(
      { stage, manifest: manifestPath, sidecar, sha256: sha256Of(bytes), artifacts: packed.length, contracts: inventory.length },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
