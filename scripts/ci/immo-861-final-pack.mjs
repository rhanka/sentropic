import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', ...options });
const out = resolve(process.env.CANDIDATE_OUT ?? 'tmp/final-861');
const siblings = resolve('tmp/ci-manifest-guard/siblings/cluster-mesh');
mkdirSync(out, { recursive: true });
mkdirSync('/tmp/final-tools', { recursive: true });
run('npm', ['install', '--prefix', '/tmp/final-tools', '--no-save', '--no-audit', '--no-fund',
  'semver@7.7.2', 'typescript@5.4.5', '@types/node'], { stdio: 'inherit' });
run('/tmp/final-tools/node_modules/.bin/tsc', ['-p', 'packages/llm-mesh/tsconfig.json',
  '--typeRoots', '/tmp/final-tools/node_modules/@types'], { stdio: 'inherit' });
const env = { ...process.env, MANIFEST_GUARD_TOOL_DIR: '/tmp/final-tools',
  GITHUB_SHA: process.env.SOURCE_SHA, MANIFEST_SEVERITY: 'block' };
const tuple = [];
for (const [slug, version] of [['artifacts', '0.2.0'], ['cluster-mesh', '0.22.0'], ['llm-mesh', '0.27.1']]) {
  const destination = `${siblings}/${slug}`;
  const reports = `${siblings}/receipts`;
  mkdirSync(destination, { recursive: true });
  mkdirSync(reports, { recursive: true });
  for (const file of readdirSync(destination)) {
    renameSync(`${destination}/${file}`, `${out}/previous-${slug}-${file}`);
  }
  run('node', [resolve('scripts/ci/publishable-manifests.mjs'), 'pack', '--slug', slug,
    '--report-dir', reports, '--destination', destination], { env, stdio: 'inherit', cwd: `packages/${slug}` });
  const path = `${destination}/sentropic-${slug}-${version}.tgz`;
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const receipt = JSON.parse(readFileSync(`${reports}/${slug}.receipt.json`));
  assert.equal(receipt.guard, 'pass');
  assert.equal(receipt.head_sha, process.env.SOURCE_SHA);
  assert.equal(receipt.sha256, sha256);
  tuple.push({ name: `@sentropic/${slug}`, version, path, sha256, integrity });
}
writeFileSync(`${siblings}/plan.txt`, 'artifacts\ncluster-mesh\nllm-mesh\n');
run('node', ['scripts/ci/publishable-manifests.mjs', 'sibling-collect', '--dir', siblings], { env, stdio: 'inherit' });
writeFileSync(`${out}/candidate.json`, JSON.stringify({ sourceCommit: process.env.SOURCE_SHA,
  image: 'node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6',
  node: process.version, npm: run('npm', ['--version']).trim(), tuple }, null, 2) + '\n');
console.log(JSON.stringify(tuple, null, 2));
