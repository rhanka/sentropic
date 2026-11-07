#!/usr/bin/env node
// Release assets for the GAS bundle (N4). Deterministic: the bundle is built twice and must be byte-identical.
// `verify` is the built-in check « bundle sha256 = release sha256 » (bundle file vs .sha256 vs manifest [vs expected]).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const BUNDLE = 'cluster-mesh.gas.js';
export const SHA_FILE = `${BUNDLE}.sha256`;
export const MANIFEST = 'cluster-mesh.gas.manifest.json';
export const SBOM = 'cluster-mesh.gas.sbom.cdx.json';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export async function buildRelease({ outDir, gitSha }) {
  if (!/^[0-9a-f]{7,64}$/.test(gitSha ?? '')) throw new Error(`gitSha must be a hex git sha, got ${JSON.stringify(gitSha)}`);
  // esbuild is only needed to build; verify and fetch-syft run without it.
  const { buildGas, HARD_BUDGET_BYTES } = await import('./build-gas.mjs');
  const { version: esbuildVersion } = await import('esbuild');
  const first = await buildGas({ gitSha });
  const second = await buildGas({ gitSha });
  if (first.sha256 !== second.sha256) throw new Error(`non-deterministic build: ${first.sha256} != ${second.sha256}`);
  if (first.size >= HARD_BUDGET_BYTES) throw new Error(`bundle ${first.size} B exceeds the hard budget`);
  const pkg = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8'));
  const manifest = { name: '@sentropic/cluster-mesh/gas', version: pkg.version, gitSha, esbuildVersion, bundle: BUNDLE, bundleSha256: first.sha256, bundleBytes: first.size, inputs: first.inputs };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, BUNDLE), first.code);
  writeFileSync(join(outDir, SHA_FILE), `${first.sha256}  ${BUNDLE}\n`);
  writeFileSync(join(outDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Throws on any disagreement. `expectSha` = sha256 published by the release (e.g. read back from the GitHub release). */
export function verifyRelease(dir, { expectSha, requireSbom = false } = {}) {
  const bytes = readFileSync(join(dir, BUNDLE));
  const actual = sha256(bytes);
  const line = readFileSync(join(dir, SHA_FILE), 'utf8');
  const m = /^([0-9a-f]{64})  (\S+)\n$/.exec(line);
  if (!m || m[2] !== BUNDLE) throw new Error(`${SHA_FILE} is not in sha256sum format for ${BUNDLE}`);
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
  const checks = { [SHA_FILE]: m[1], [MANIFEST]: manifest.bundleSha256, ...(expectSha ? { expected: expectSha } : {}) };
  for (const [label, value] of Object.entries(checks)) if (value !== actual) throw new Error(`bundle sha256 ${actual} != ${label} ${value}`);
  if (manifest.bundleBytes !== bytes.length) throw new Error(`manifest bundleBytes ${manifest.bundleBytes} != ${bytes.length}`);
  if (requireSbom || existsSync(join(dir, SBOM))) {
    const sbom = JSON.parse(readFileSync(join(dir, SBOM), 'utf8'));
    if (sbom.bomFormat !== 'CycloneDX') throw new Error('SBOM is not CycloneDX');
  }
  return { sha256: actual, bytes: bytes.length };
}

/** Download the syft build admitted in scripts/security/scanner/tool-inventory.json and verify digest + size. */
export async function fetchSyft(destDir, inventoryPath) {
  const inv = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const tools = inv.roles ?? [];
  const syft = tools.find((t) => t.role === 'sbom' && t.name === 'syft');
  if (!syft?.url || !/^sha256:[0-9a-f]{64}$/.test(syft.digest ?? '')) throw new Error('syft is not admitted in tool-inventory.json');
  const res = await fetch(syft.url);
  if (!res.ok) throw new Error(`syft download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (`sha256:${sha256(buf)}` !== syft.digest || buf.length !== syft.size) throw new Error('syft archive does not match the admitted digest/size');
  mkdirSync(destDir, { recursive: true });
  const file = join(destDir, 'syft.tar.gz');
  writeFileSync(file, buf);
  return { file, version: syft.version };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, dir, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'build') {
      const sha = process.env.GAS_GIT_SHA;
      console.log(JSON.stringify(await buildRelease({ outDir: dir, gitSha: sha }), null, 2));
    } else if (cmd === 'verify') {
      const expectSha = rest.find((a) => a.startsWith('--expect-sha='))?.slice(13);
      console.log(JSON.stringify(verifyRelease(dir, { expectSha, requireSbom: rest.includes('--require-sbom') })));
    } else if (cmd === 'fetch-syft') {
      console.log(JSON.stringify(await fetchSyft(dir, rest[0] ?? '/source/scripts/security/scanner/tool-inventory.json')));
    } else throw new Error('usage: gas-release.mjs build|verify|fetch-syft <dir> [...]');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
