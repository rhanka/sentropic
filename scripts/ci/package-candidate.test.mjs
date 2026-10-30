import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Writable } from 'node:stream';
import { candidateClosure, copyCandidate, exportSiblings, produceCandidates, verifyCandidates, verifyPrepared } from './package-candidate.mjs';
import { commandPack, runNpmPack, sha256File } from './publishable-manifests.mjs';

const tuple = { head_sha: 'a'.repeat(40), node: process.version, image: 'node:test', npm: '11.0.0' };
const out = new Writable({ write(_chunk, _encoding, done) { done(); } });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const slug of ['leaf', 'root']) {
    write(path.join(root, 'packages', slug, 'package.json'), { name: `@fx/${slug}`, version: '1.0.0',
      dependencies: slug === 'root' ? { '@fx/leaf': '^1.0.0' } : {}, files: ['index.js'] });
    fs.writeFileSync(path.join(root, 'packages', slug, 'index.js'), 'export default 1;\n');
  }
  return { root, dir: path.join(root, 'out'), roots: ['root'], tuple, tsc: '/bin/true' };
}
async function produce(opts, registry = { lookup: async () => ({ status: 'absent' }) }) {
  let packs = 0;
  const result = await produceCandidates({ ...opts, pack: (args, deps) => {
    packs++; return commandPack(args, { ...deps, registry, out });
  } });
  return { result, packs };
}

test('should topologically pack the complete closure once and reuse identical guarded bytes', async t => {
  const opts = fixture(t);
  assert.deepEqual(candidateClosure(opts.root, ['root', 'leaf']), ['leaf', 'root']);
  assert.equal((await produce(opts)).packs, 2);
  assert.equal((await produce(opts)).packs, 0);
  const index = verifyCandidates(opts.dir, tuple, opts.roots, { root: opts.root });
  assert.equal(index.receipts.length, 2);
});
test('should reject source, tool and selected-closure substitution', async t => {
  const opts = fixture(t); await produce(opts);
  for (const changed of [{ head_sha: 'b'.repeat(40) }, { npm: '12' }, { image: 'different' }]) {
    assert.throws(() => verifyCandidates(opts.dir, { ...tuple, ...changed }, opts.roots, { root: opts.root }), /tuple mismatch/);
  }
  assert.throws(() => verifyCandidates(opts.dir, tuple, ['leaf'], { root: opts.root }), /closure mismatch/);
});
test('should copy exact qualification bytes and reject a substituted tuple or sibling', async t => {
  const opts = fixture(t);
  fs.renameSync(path.join(opts.root, 'packages/root'), path.join(opts.root, 'packages/cluster-mesh'));
  opts.roots = ['cluster-mesh'];
  const { result } = await produce(opts);
  const destination = path.join(opts.root, 'consumer');
  const copy = slug => copyCandidate(opts.dir, tuple, slug, destination, { root: opts.root });
  assert.equal(sha256File(copy('cluster-mesh')), result.receipts[1].sha256);
  assert.equal(sha256File(copy('leaf')), result.receipts[0].sha256);
  assert.throws(() => copy('outside'), /missing selected candidate/);
  assert.throws(() => copyCandidate(opts.dir, { ...tuple, head_sha: 'b'.repeat(40) }, 'leaf', destination,
    { root: opts.root }), /tuple mismatch/);
  fs.appendFileSync(path.join(opts.dir, result.receipts[0].file), 'tampered');
  assert.throws(() => copy('cluster-mesh'), /hash mismatch/);
});
test('should reject missing sibling receipts and archives', async t => {
  const opts = fixture(t); const { result } = await produce(opts);
  fs.unlinkSync(path.join(opts.dir, result.receipts[0].file));
  assert.throws(() => verifyCandidates(opts.dir, tuple, opts.roots, { root: opts.root }), /missing candidate archive/);
  result.receipts.shift(); write(path.join(opts.dir, 'candidates.json'), result);
  assert.throws(() => verifyCandidates(opts.dir, tuple, opts.roots, { root: opts.root }), /missing or invalid candidate receipt/);
});
test('should reject changed archive bytes and a newly hashed invalid packed manifest', async t => {
  const opts = fixture(t); const { result } = await produce(opts);
  const receipt = result.receipts[0], archive = path.join(opts.dir, receipt.file);
  fs.appendFileSync(archive, 'tampered');
  assert.throws(() => verifyCandidates(opts.dir, tuple, opts.roots, { root: opts.root }), /hash mismatch/);
  fs.unlinkSync(archive);
  write(path.join(opts.root, 'packages/leaf/package.json'), { name: '@fx/leaf', version: '1.0.0', dependencies: { bad: 'file:../bad' } });
  runNpmPack(path.join(opts.root, 'packages/leaf'), path.dirname(archive));
  receipt.sha256 = sha256File(archive); write(path.join(opts.dir, 'candidates.json'), result);
  assert.throws(() => verifyCandidates(opts.dir, tuple, opts.roots, { root: opts.root }), /packed manifest rejected/);
});
test('should fail closed on registry failure and refuse partial-attempt reuse', async t => {
  const opts = fixture(t);
  await assert.rejects(produce(opts, { lookup: async () => { throw new Error('registry unavailable'); } }), /registry unavailable/);
  await assert.rejects(produce(opts), /output is not empty/);
});
test('should reject workspace dependency cycles and missing roots', t => {
  const opts = fixture(t);
  write(path.join(opts.root, 'packages/leaf/package.json'), { name: '@fx/leaf', version: '1.0.0', peerDependencies: { '@fx/root': '*' } });
  assert.throws(() => candidateClosure(opts.root, ['root']), /cycle/);
  assert.throws(() => candidateClosure(opts.root, ['missing']), /missing public candidate/);
});

test('should reject unsealed, substituted and corrupted preparation before extraction', async t => {
  const opts = fixture(t); const { result } = await produce(opts);
  assert.throws(() => verifyPrepared(opts.dir, tuple), /prepared candidate hash\/tuple mismatch/);
  const archive = path.join(opts.dir, 'prepared.tgz');
  fs.writeFileSync(archive, 'immutable preparation');
  result.prepared = { file: 'prepared.tgz', sha256: sha256File(archive) };
  write(path.join(opts.dir, 'candidates.json'), result);
  assert.equal(verifyPrepared(opts.dir, tuple).prepared.sha256, sha256File(archive));
  assert.throws(() => verifyPrepared(opts.dir, { ...tuple, npm: 'different' }), /tuple mismatch/);
  fs.appendFileSync(archive, 'changed');
  assert.throws(() => verifyPrepared(opts.dir, tuple), /hash\/tuple mismatch/);
});

test('should inject every selected same-PR sibling while retaining unchanged frozen peers', async t => {
  const opts = fixture(t);
  const context = { CI_MANIFEST_EVENT: 'pull_request', CI_MANIFEST_CONTEXT: JSON.stringify({
    package_files: '["packages/leaf/src/index.ts"]', matched_filters: '[]' }) };
  const { result } = await produce({ ...opts, env: context });
  assert.deepEqual(result.siblingSelection, ['leaf']);
  const destination = path.join(opts.root, 'siblings');
  exportSiblings(opts.dir, result, 'root', destination, { root: opts.root });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, 'receipts.json'))).map(row => row.slug), ['leaf']);
  const standalone = fixture(t);
  const { result: unselected } = await produce(standalone);
  assert.deepEqual(unselected.siblingSelection, []);
  exportSiblings(standalone.dir, unselected, 'root', path.join(standalone.root, 'siblings'), { root: standalone.root });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(standalone.root, 'siblings/receipts.json'))), []);
});
