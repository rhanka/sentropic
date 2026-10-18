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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArtifactManifest } from './receipt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FROZEN_SPEC_SHA256 = 'f90c927964b44fdf6ad712eee9b894762250239384643a3790931c142d3aeeca';
const L0_COMMIT = '60a8bfa828b5eabd360232ea5865391c23f99f48';
const SDK_RANGE = '^1.31.0';

const PLATFORM_MEMORY_DTS = [
  'contracts',
  'invocation-context',
  'mutation-guard',
  'confirmation',
  'index',
];
const BROKER_MEMORY_DTS = ['contracts', 'context-projection', 'compiled-dispatch', 'index'];

function arg(flag) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) throw new Error(`pack.mjs: missing required ${flag}`);
  return argv[i + 1];
}

const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');
const integrityOf = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

function readBytes(rootDir, relPath) {
  const abs = resolve(rootDir, relPath);
  if (!existsSync(abs)) throw new Error(`pack.mjs: missing contract file ${relPath}`);
  return readFileSync(abs);
}

function assertTarball(rootDir, tarPath, name, version) {
  const bytes = readBytes(rootDir, tarPath);
  let tar;
  try {
    tar = gunzipSync(bytes);
  } catch {
    throw new Error(`pack.mjs: ${tarPath} is not a gzip archive`);
  }
  let found = null;
  for (let off = 0; off + 512 <= tar.length; ) {
    const hdr = tar.subarray(off, off + 512);
    if (hdr.every((b) => b === 0)) break;
    const entryName = hdr.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(hdr.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8);
    if (entryName === 'package/package.json') {
      found = JSON.parse(tar.subarray(off + 512, off + 512 + size).toString('utf8'));
      break;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  if (!found || found.name !== name || found.version !== version) {
    throw new Error(`pack.mjs: ${tarPath} package.json mismatch (want ${name}@${version})`);
  }
  return bytes;
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
  const rootDir = resolve(arg('--root') || join(HERE, '..', '..'));

  const platformPkg = JSON.parse(readBytes(rootDir, 'packages/mcp-platform/package.json').toString('utf8'));
  const brokerPkg = JSON.parse(readBytes(rootDir, 'packages/mcp-broker/package.json').toString('utf8'));
  if (platformPkg.name !== '@sentropic/mcp-platform' || brokerPkg.name !== '@sentropic/mcp-broker') {
    throw new Error('pack.mjs: package identity mismatch');
  }

  const archivesDir = resolve(rootDir, 'tools/memory-mcp-l5/artifacts/archives');
  mkdirSync(archivesDir, { recursive: true });
  const packed = [];
  for (const [pkgDir, name, version, role] of [
    ['packages/mcp-platform', platformPkg.name, platformPkg.version, 'platform'],
    ['packages/mcp-broker', brokerPkg.name, brokerPkg.version, 'broker'],
  ]) {
    const out = execFileSync('npm', ['pack', '--pack-destination', archivesDir], {
      cwd: resolve(rootDir, pkgDir),
      encoding: 'utf8',
    }).trim().split('\n').pop();
    const tarPath = `tools/memory-mcp-l5/artifacts/archives/${out}`;
    const bytes = assertTarball(rootDir, tarPath, name, version);
    packed.push({ role, name, version, sha256: sha256Of(bytes), integrity: integrityOf(bytes), sourceHead: l5Head, archive: tarPath });
  }

  const inventory = [];
  const track = (relPath, version) => {
    const bytes = readBytes(rootDir, relPath);
    inventory.push({ path: relPath, version, sha256: sha256Of(bytes) });
  };
  for (const stem of PLATFORM_MEMORY_DTS) track(`packages/mcp-platform/dist/memory/${stem}.d.ts`, platformPkg.version);
  for (const stem of BROKER_MEMORY_DTS) track(`packages/mcp-broker/dist/memory/${stem}.d.ts`, brokerPkg.version);
  track('tools/memory-mcp-l5/schemas/checkpoint-v1.schema.json', '1.0.0');
  track('tools/memory-mcp-l5/schemas/artifact-manifest-v1.schema.json', '1.0.0');
  track('tools/memory-mcp-l5/proof-catalog-v1.json', '1.0.0');
  track('tools/memory-mcp-l5/exports-v1.json', '1.0.0');
  track(
    `tools/memory-mcp-l5/fixtures/l0/${L0_COMMIT}/index.json`,
    '1.0.0',
  );
  track('packages/mcp-platform/etc/mcp-platform.api.md', platformPkg.version);
  track('packages/mcp-platform/etc/mcp-platform-memory.api.md', platformPkg.version);

  const declaredLockSha256 = sha256Of(readBytes(rootDir, 'package-lock.json'));
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
    },
    artifacts: packed,
    contractInventory: inventory,
  };
  const failures = checkArtifactManifest(manifest);
  if (failures.length > 0) {
    throw new Error(`pack.mjs: manifest invalid: ${failures.join('; ')}`);
  }
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  mkdirSync(dirname(resolve(rootDir, manifestPath)), { recursive: true });
  writeFileSync(resolve(rootDir, manifestPath), bytes);
  const sidecar = `${manifestPath}.sha256`;
  writeFileSync(resolve(rootDir, sidecar), `${sha256Of(bytes)}\n`);
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
