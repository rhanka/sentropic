import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { integrity, sha256 } from './precandidate.mjs';

export const PUBLICATIONS = { 'mcp-platform': '0.4.0', 'cluster-mesh': '0.22.4', 'llm-gateway': '0.21.3', engram: '0.21.2' };
export function verifyPublication(pkg, bytes, entry, name, version) {
  const computed = integrity(bytes);
  if (pkg.name !== name || pkg.version !== version || !pkg.dist?.tarball?.startsWith('https://registry.npmjs.org/')) {
    throw Error(`Published identity mismatch: ${name}@${version}`);
  }
  if (!entry || entry.link || entry.version !== version || entry.resolved !== pkg.dist.tarball ||
      entry.integrity !== computed || pkg.dist.integrity !== computed) throw Error(`Published archive/registry/lock mismatch: ${name}`);
  return { name, version, integrity: computed, archiveSha256: sha256(bytes), tarball: pkg.dist.tarball };
}
export async function collectPublications(root) {
  const dir = resolve(root, 'tmp/lot3-inputs'), lockDir = resolve(dir, 'registry-lock');
  mkdirSync(lockDir, { recursive: true });
  const dependencies = Object.fromEntries(Object.entries(PUBLICATIONS).map(([slug, version]) => [`@sentropic/${slug}`, version]));
  const npm = args => {
    const run = spawnSync('npm', [...args, '--registry=https://registry.npmjs.org'], {
      cwd: lockDir, encoding: 'utf8', env: { ...process.env, HOME: '/tmp', npm_config_cache: '/tmp/lot3-npm-cache' },
    });
    if (run.error || run.status !== 0) throw Error(`npm ${args.join(' ')}: ${run.error?.message ?? run.stderr}`);
    return run.stdout;
  };
  writeFileSync(resolve(lockDir, 'package.json'), JSON.stringify({ private: true, dependencies }));
  npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
  const lockBytes = readFileSync(resolve(lockDir, 'package-lock.json')), lock = JSON.parse(lockBytes);
  const receipts = [];
  for (const [slug, version] of Object.entries(PUBLICATIONS)) {
    const name = `@sentropic/${slug}`, args = ['view', `${name}@${version}`, 'name', 'version', 'dist', 'gitHead', '--json'];
    const metadata = npm(args), pkg = JSON.parse(metadata);
    const response = await fetch(pkg.dist.tarball);
    if (!response.ok) throw Error(`Published download ${name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const receipt = verifyPublication(pkg, bytes, lock.packages[`node_modules/${name}`], name, version);
    writeFileSync(resolve(dir, `${slug === 'engram' ? 'engram-e2' : slug}-registry.json`), metadata);
    writeFileSync(resolve(dir, `published-${slug}-${version}.tgz`), bytes);
    receipts.push({ ...receipt, observedAt: new Date().toISOString(), command: ['npm', ...args],
      metadata: pkg, metadataSha256: sha256(metadata), lockSha256: sha256(lockBytes),
      lockEntry: lock.packages[`node_modules/${name}`] });
  }
  writeFileSync(resolve(dir, 'publication-receipts.json'), JSON.stringify({
    purpose: 'registry observations only; not the pending gr-conductor host lock or installed acceptance',
    lockCommand: 'npm install --package-lock-only --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org',
    lockSha256: sha256(lockBytes), receipts,
  }, null, 2) + '\n');
  console.log(JSON.stringify(receipts.map(({ name, version, integrity }) => ({ name, version, integrity }))));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await collectPublications(process.cwd());
