#!/usr/bin/env node
// Immutable package candidates; all callers run through Make in disposable containers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { commandPack, DEP_SECTIONS, GuardError, inspectArchive, sha256File } from './publishable-manifests.mjs';

const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = message => { throw new GuardError(message); };
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) fail(`${command} failed: ${result.error?.message ?? result.status}`);
};

export function candidateClosure(root, roots) {
  const packages = new Map(fs.readdirSync(path.join(root, 'packages')).flatMap(slug => {
    const file = path.join(root, 'packages', slug, 'package.json');
    return fs.existsSync(file) ? [[slug, json(file)]] : [];
  }));
  const byName = new Map([...packages].map(([slug, manifest]) => [manifest.name, slug]));
  const order = [], active = new Set(), done = new Set();
  const visit = slug => {
    if (active.has(slug)) fail(`candidate dependency cycle: ${slug}`);
    if (done.has(slug)) return;
    const manifest = packages.get(slug);
    if (!manifest || manifest.private) fail(`missing public candidate: ${slug}`);
    active.add(slug);
    for (const section of DEP_SECTIONS) {
      for (const name of Object.keys(manifest[section] ?? {}).sort()) {
        if (byName.has(name)) visit(byName.get(name));
      }
    }
    active.delete(slug); done.add(slug); order.push(slug);
  };
  roots.forEach(visit);
  return order;
}

export function candidateTuple(root, env = process.env) {
  if (!/^[a-f0-9]{40}$/.test(env.MANIFEST_HEAD_SHA ?? '')) fail('candidate source SHA is required');
  return { head_sha: env.MANIFEST_HEAD_SHA, node: process.version, architecture: process.arch,
    image: env.CANDIDATE_NODE_IMAGE, npm: env.CANDIDATE_NPM_VERSION,
    lock: sha256File(path.join(root, 'package-lock.json')),
    workflow: sha256File(path.join(root, '.github/workflows/ci.yml')) };
}

// No cache hit is accepted on just a filename or package version.
export function verifyCandidates(dir, tuple, roots, { semver, root = process.cwd() } = {}) {
  const index = json(path.join(dir, 'candidates.json'));
  if (JSON.stringify(index.tuple) !== JSON.stringify(tuple)) fail('candidate source/tool tuple mismatch');
  if (index.schema !== 1 || JSON.stringify(index.roots) !== JSON.stringify(roots)
    || JSON.stringify(index.order) !== JSON.stringify(candidateClosure(root, roots))) {
    fail('candidate closure mismatch');
  }
  return verifyCandidateArchives(dir, index, { semver });
}

export function verifyCandidateArchives(dir, index, { semver } = {}) {
  const seen = new Set();
  for (const slug of index.order) {
    const receipt = index.receipts.find(row => row.slug === slug);
    if (!receipt || seen.has(slug) || receipt.guard !== 'pass' || receipt.evidence !== 'release-candidate'
      || receipt.head_sha !== index.tuple.head_sha) fail(`missing or invalid candidate receipt: ${slug}`);
    seen.add(slug);
    if (typeof receipt.file !== 'string' || path.isAbsolute(receipt.file) || receipt.file.split('/').includes('..')) fail('invalid candidate archive path');
    const archive = path.join(dir, receipt.file);
    if (!fs.lstatSync(archive, { throwIfNoEntry: false })?.isFile()) fail(`missing candidate archive: ${slug}`);
    if (sha256File(archive) !== receipt.sha256) fail(`candidate hash mismatch: ${slug}`);
    const result = inspectArchive({ archive, expected: receipt, semver });
    if (result.structural.length || result.findings.length) fail(`candidate packed manifest rejected: ${slug}`);
  }
  if (seen.size !== index.receipts.length) fail('unexpected candidate receipt');
  return index;
}

export async function produceCandidates({ root, dir, roots, tuple, tsc, env = process.env, pack = commandPack }) {
  if (fs.existsSync(path.join(dir, 'candidates.json'))) {
    return verifyCandidates(dir, tuple, roots, { root });
  }
  // A partial attempt is never repaired by silently repacking a subset.
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) fail('candidate output is not empty');
  fs.mkdirSync(dir, { recursive: true });
  const order = candidateClosure(root, roots), receipts = [];
  for (const slug of order) {
    const cwd = path.join(root, 'packages', slug);
    run(tsc, ['--typeRoots', '/tmp/cm-tools/node_modules/@types', '-p', 'tsconfig.json'], cwd);
    const destination = path.join(dir, slug), reports = path.join(dir, 'reports');
    const code = await pack({ slug, destination, 'report-dir': reports }, { cwd,
      env: { ...env, MANIFEST_SEVERITY: 'block', CI_PACKAGE_CANDIDATES: '', MANIFEST_HEAD_SHA: tuple.head_sha, PACK_DESTINATION_HOST: destination } });
    if (code !== 0) fail(`candidate guard failed: ${slug}`);
    const receipt = json(path.join(reports, `${slug}.receipt.json`));
    receipts.push({ ...receipt, file: `${slug}/${path.basename(receipt.archive)}` });
  }
  const index = { schema: 1, roots, order, tuple, receipts };
  fs.writeFileSync(path.join(dir, 'candidates.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

export function exportSiblings(dir, index, slug, destination) {
  const selected = new Set(candidateClosure(process.cwd(), [slug]).filter(member => member !== slug));
  fs.mkdirSync(destination, { recursive: true });
  if (fs.readdirSync(destination).length) fail('sibling destination is not empty');
  const receipts = index.receipts.filter(row => selected.has(row.slug)).map(row => {
    fs.mkdirSync(path.join(destination, row.slug), { recursive: true });
    fs.copyFileSync(path.join(dir, row.file), path.join(destination, row.file));
    return row;
  });
  if (receipts.length !== selected.size) fail('missing selected sibling receipts');
  fs.writeFileSync(path.join(destination, 'receipts.json'), `${JSON.stringify(receipts, null, 2)}\n`);
}

export function verifyCandidateSelection(dir, headSha, primary) {
  const index = json(path.join(dir, 'candidates.json'));
  if (!headSha || index.tuple?.head_sha !== headSha) fail('candidate source SHA mismatch');
  verifyCandidateArchives(dir, index);
  const receipt = index.receipts.find(row => row.name === primary.name && row.version === primary.version);
  if (!receipt || receipt.sha256 !== primary.sha256) fail('primary archive differs from selected candidate');
  return index;
}

export async function main([command, dir, ...roots]) {
  const root = process.cwd(), tuple = candidateTuple(root);
  if (command === 'produce') return produceCandidates({ root, dir, roots, tuple,
    tsc: '/tmp/cm-tools/node_modules/.bin/tsc' });
  if (command === 'verify') return verifyCandidates(dir, tuple, roots);
  if (command === 'siblings') {
    const [slug, destination] = roots;
    const index = verifyCandidates(dir, tuple, ['cluster-mesh']);
    return exportSiblings(dir, index, slug, destination);
  }
  if (command === 'seal') {
    const index = verifyCandidates(dir, tuple, roots);
    index.prepared = { file: 'prepared.tgz', sha256: sha256File(path.join(dir, 'prepared.tgz')) };
    fs.writeFileSync(path.join(dir, 'candidates.json'), `${JSON.stringify(index, null, 2)}\n`);
    return index;
  }
  if (command === 'verify-prepared') {
    // Verify the prepared archive before extraction; package bytes are checked after tools restore.
    const index = json(path.join(dir, 'candidates.json'));
    if (JSON.stringify(index.tuple) !== JSON.stringify(tuple)
      || index.prepared?.file !== 'prepared.tgz'
      || sha256File(path.join(dir, 'prepared.tgz')) !== index.prepared.sha256) fail('prepared candidate hash/tuple mismatch');
    return index;
  }
  fail('expected produce|verify DIR ROOT...');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
}
