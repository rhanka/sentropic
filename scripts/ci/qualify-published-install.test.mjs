// Clean-consumer qualification fixtures (make test-qualify-published-install). Local tarballs only;
// the "registry" is a local 404 server or an in-process stub. Nothing is published.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GuardError, createRegistry, readPackedManifest, runNpmPack, sha256File } from './publishable-manifests.mjs';
import { SLSA_V1, checkProvenance, checkSiblingRanges, entryPoints, loadSiblings, missingSibling, parseExactSpec, qualify, registryNotVisible } from './qualify-published-install.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function build(manifest, files) {
  const dir = path.join(tmp('qfx-'), 'pkg');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0', type: 'module', ...manifest }));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return runNpmPack(dir, tmp('qout-')).archive;
}
let registry;
test.before(async () => {
  const child = spawn(process.execPath, ['-e', "const s=require('http').createServer((q,r)=>{r.writeHead(404,{'content-type':'application/json'});r.end('{\"error\":\"Not found\"}')});s.listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(String(d).trim())));
  registry = { url: `http://127.0.0.1:${port}`, child };
});
test.after(() => registry.child.kill());
const probe = (opts) => qualify({ registry: registry.url, reportDir: tmp('qrep-'), ...opts });
const readReport = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'qualify-report.json'), 'utf8'));

test('good fixture installs and imports every runtime entry point, including a CommonJS branch', async () => {
  const tgz = build({ name: '@fx/good', exports: { '.': { types: './i.d.ts', import: './index.js' }, './sub': './sub.js', './cjs': { import: './index.js', require: './c.cjs' }, './types': { types: './t.d.ts' } } },
    { 'index.js': 'export default 1;', 'sub.js': 'export const s = 1;', 'c.cjs': 'module.exports = 1;' });
  const reportDir = tmp('qrep-');
  assert.equal(await qualify({ tarball: tgz, registry: registry.url, reportDir }), 0);
  const report = readReport(reportDir);
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.entrypoints.map((e) => `${e.phase}:${e.mode}:${e.specifier}`), ['core:import:@fx/good', 'all:import:@fx/good', 'all:import:@fx/good/sub', 'all:import:@fx/good/cjs', 'all:require:@fx/good/cjs']);
  assert.deepEqual(report.entrypointTypesOnly, ['@fx/good/types']);
  assert.equal(report.resolved.sha256, sha256File(tgz));
  assert.equal(fs.existsSync(report.consumer), false, 'disposable consumer removed');
  assert.ok(fs.existsSync(path.join(reportDir, 'qualify.log')) && fs.existsSync(path.join(reportDir, 'qualify-summary.txt')));
});

test('absent dist, misdeclared export and undeclared dependency fail even though install succeeds', async () => {
  assert.equal(await probe({ tarball: build({ name: '@fx/nodist', exports: { '.': './dist/index.js' } }, {}) }), 1);
  assert.equal(await probe({ tarball: build({ name: '@fx/undeclared' , exports: './index.js' }, { 'index.js': "import 'not-declared-anywhere';" }) }), 1);
});

test('packed-manifest guard rejects file: dependencies before installing', async () => {
  const reportDir = tmp('qrep-');
  assert.equal(await qualify({ tarball: build({ name: '@fx/bad', dependencies: { '@fx/x': 'file:../x' } }, { 'index.js': '' }), registry: registry.url, reportDir }), 1);
  assert.match(readReport(reportDir).problems.join('\n'), /packed manifest guard: dependencies/);
});

test('optional peer: core smoke independent of the peer, adapter covered only with explicit PEERS', async () => {
  const peer = build({ name: '@fx/peer', version: '2.0.0' }, { 'index.js': 'export const p = 2;' });
  const pkg = { name: '@fx/opt', peerDependencies: { '@fx/peer': '^2.0.0' }, peerDependenciesMeta: { '@fx/peer': { optional: true } }, exports: { '.': './index.js', './adapter': './adapter.js' } };
  const tgz = build(pkg, { 'index.js': 'export default 1;', 'adapter.js': "export * from '@fx/peer';" });
  const sibs = siblingDir([peer]);
  const without = tmp('qrep-');
  assert.equal(await qualify({ tarball: tgz, siblingsDir: sibs, registry: registry.url, reportDir: without }), 1);
  assert.match(readReport(without).problems.join('\n'), /supply PEERS/);
  assert.equal(readReport(without).entrypoints[0].ok, true, 'core import passed without the optional peer');
  assert.deepEqual(readReport(without).overrides, {}, 'optional sibling peers stay out of the core smoke');
  const withPeer = tmp('qrep-');
  assert.equal(await qualify({ tarball: tgz, siblingsDir: sibs, peers: ['@fx/peer@2.0.0'], registry: registry.url, reportDir: withPeer }), 0);
  assert.deepEqual(readReport(withPeer).peersAdded.map((p) => `${p.name}@${p.version}:${p.source}`), ['@fx/peer@2.0.0:sibling-receipt']);
  const eager = build({ ...pkg, name: '@fx/eager' }, { 'index.js': "export * from '@fx/peer';", 'adapter.js': '' });
  assert.equal(await probe({ tarball: eager }), 1, 'eager optional-peer import fails the core smoke');
});

test('entry point classification: wildcard, asset and browser-only exports are unsupported', () => {
  const statuses = entryPoints({ name: 'x', exports: { '.': './a.js', './*': './*.js', './theme.css': './t.css', './b': { browser: './b.js' }, './t': { types: './t.d.ts' } } }).map((e) => e.status);
  assert.deepEqual(statuses.map((s) => s.split(':')[0]), ['runtime', 'unsupported', 'unsupported', 'unsupported', 'types-only']);
  assert.equal(entryPoints({ name: 'x', main: './i.js' })[0].specifier, 'x');
});

test('invalid inputs are rejected', async () => {
  await assert.rejects(qualify({ reportDir: tmp('q-') }), /exactly one/);
  await assert.rejects(qualify({ pkg: 'a@1.0.0', tarball: '/x.tgz', reportDir: tmp('q-') }), /exactly one/);
  for (const spec of ['a@^1.0.0', 'a@latest', 'a', 'a@file:../a', 'a@1.0']) assert.throws(() => parseExactSpec(spec), /exact-version/);
  assert.deepEqual(parseExactSpec('@sentropic/mcp-auth@0.2.1-rc.1'), { name: '@sentropic/mcp-auth', version: '0.2.1-rc.1' });
  assert.equal(await probe({ tarball: '/does/not/exist.tgz' }), 1);
});

test('published replays: registry failure and absent versions fail; sibling injection is rejected', async () => {
  const failing = { lookup: async () => { throw new GuardError('registry HTTP 503', { transient: true }); } };
  const reportDir = tmp('qrep-');
  assert.equal(await qualify({ pkg: '@fx/a@1.0.0', registryClient: failing, registry: registry.url, reportDir }), 1);
  assert.match(readReport(reportDir).problems[0], /re-run, not debt/);
  assert.equal(await probe({ pkg: '@fx/a@1.0.0', registryClient: { lookup: async () => ({ status: 'absent', evidence: {} }) } }), 1);
  await assert.rejects(probe({ pkg: '@fx/a@1.0.0', siblingsDir: tmp('s-') }), /restricted/);
  await assert.rejects(probe({ tarball: '/x.tgz', siblingsDir: tmp('s-'), mode: 'post-publication' }), /restricted/);
});

// ---- same-PR lockstep siblings
function siblingDir(archives, mutate = (r) => r) {
  const dir = tmp('sibs-');
  const receipts = archives.map((archive, i) => {
    fs.mkdirSync(path.join(dir, `s${i}`));
    const file = path.join(`s${i}`, path.basename(archive));
    fs.copyFileSync(archive, path.join(dir, file));
    const m = readPackedManifest(fs.readFileSync(archive));
    return mutate({ name: m.name, version: m.version, file, sha256: sha256File(archive), head_sha: 'head', guard: 'pass', manifest_mode: 'block', evidence: 'release-candidate' });
  });
  fs.writeFileSync(path.join(dir, 'receipts.json'), JSON.stringify(receipts));
  return dir;
}
function lockstep() {
  const c = build({ name: '@sentropic/fx-c', version: '1.1.0' }, { 'index.js': 'export const c = 1;' });
  const b = build({ name: '@sentropic/fx-b', version: '1.1.0', dependencies: { '@sentropic/fx-c': '^1.1.0' } }, { 'index.js': "export * from '@sentropic/fx-c';" });
  const a = build({ name: '@sentropic/fx-a', version: '1.1.0', dependencies: { '@sentropic/fx-b': '^1.1.0' }, exports: './index.js' }, { 'index.js': "export * from '@sentropic/fx-b';" });
  return { a, b, c };
}

test('lockstep bump installs direct and transitive sibling archives from guarded receipts', async () => {
  const { a, b, c } = lockstep();
  const reportDir = tmp('qrep-');
  assert.equal(await qualify({ tarball: a, siblingsDir: siblingDir([b, c]), headSha: 'head', registry: registry.url, reportDir }), 0);
  const report = readReport(reportDir);
  assert.deepEqual(Object.keys(report.overrides).sort(), ['@sentropic/fx-b', '@sentropic/fx-c']);
  assert.equal(report.siblingEdges.every((e) => e.ok), true);
});

test('sibling hash, head, identity, unlisted archive and range mismatches block', async () => {
  const { a, b, c } = lockstep();
  assert.throws(() => loadSiblings(siblingDir([b, c], (r) => ({ ...r, sha256: '0'.repeat(64) })), {}), /hash mismatch/);
  assert.throws(() => loadSiblings(siblingDir([b, c]), { headSha: 'other' }), /not head other/);
  assert.throws(() => loadSiblings(siblingDir([b], (r) => ({ ...r, version: '9.9.9' })), {}), /identity mismatch/);
  assert.throws(() => loadSiblings(siblingDir([b], (r) => ({ ...r, guard: 'fail' })), {}), /not a passing BLOCK/);
  const extra = siblingDir([b]);
  fs.copyFileSync(c, path.join(extra, 'stray.tgz'));
  assert.throws(() => loadSiblings(extra, {}), /unlisted archive/);
  assert.throws(() => checkSiblingRanges([{ name: 'x', version: '1', dependencies: { '@sentropic/fx-b': '^2.0.0' } }], [{ name: '@sentropic/fx-b', version: '1.1.0' }]), /does not accept/);
  assert.equal(await probe({ tarball: a, siblingsDir: siblingDir([b, c], (r) => ({ ...r, sha256: '0'.repeat(64) })) }), 1);
});

test('confirmed missing sibling: pending (non-blocking) in PR candidates, blocking after publication', async () => {
  const { a } = lockstep();
  const pr = tmp('qrep-');
  assert.equal(await qualify({ tarball: a, registry: registry.url, reportDir: pr }), 0);
  assert.equal(readReport(pr).status, 'pending-sibling-publish');
  assert.equal(readReport(pr).pendingSibling.name, '@sentropic/fx-b');
  assert.match(fs.readFileSync(path.join(pr, 'qualify-summary.txt'), 'utf8'), /PENDING-SIBLING-PUBLISH/);
  const post = tmp('qrep-');
  assert.equal(await qualify({ tarball: a, mode: 'post-publication', registry: registry.url, reportDir: post, attempts: 2, delaySeconds: 0 }), 1);
  assert.equal(readReport(post).status, 'pending-sibling-publish');
  assert.equal(missingSibling("npm error 404 Not Found - GET http://r/@sentropic%2ffx-b - Not found\nnpm error 404  '@sentropic/fx-b@^1.1.0' is not in this registry.").name, '@sentropic/fx-b');
  assert.equal(missingSibling('npm error notarget No matching version found for @sentropic/fx-b@^9.0.0.\n').range, '^9.0.0');
  assert.equal(missingSibling('npm error ECONNREFUSED'), null);
});

// ---- post-publication propagation: a lagging first lookup must not be cached
// Serves packuments/tarballs (query strings ignored); `lag[name]` 404s the first N packument reads,
// `forbidden` names answer 403 on their tarball. Requests are logged in `server.requests()`.
async function serveRegistry(tgzs, { lag = {}, forbidden = [] } = {}) {
  const pkgs = [tgzs].flat().map((tgz, i) => {
    const bytes = fs.readFileSync(tgz);
    const manifest = readPackedManifest(bytes);
    const digest = createHash('sha512').update(bytes).digest('base64');
    return { manifest, tgz, file: `/pkg${i}.tgz`, integrity: `sha512-${digest}`, forbidden: forbidden.includes(manifest.name) };
  });
  const dir = tmp('qreg-');
  const script = path.join(dir, 'server.cjs');
  fs.writeFileSync(script, `const fs=require('fs');const http=require('http');const pkgs=${JSON.stringify(pkgs)};const lag=${JSON.stringify(lag)};const log=${JSON.stringify(path.join(dir, 'requests.log'))};
const s=http.createServer((q,r)=>{const base='http://127.0.0.1:'+s.address().port;const url=decodeURIComponent(q.url.split('?')[0]);fs.appendFileSync(log,url+'\\n');
for(const p of pkgs){const m=p.manifest;
if(url==='/'+m.name){if(lag[m.name]>0){lag[m.name]-=1;r.writeHead(404,{'content-type':'application/json'});return r.end('{}');}
r.writeHead(200,{'content-type':'application/json'});return r.end(JSON.stringify({name:m.name,'dist-tags':{latest:m.version},versions:{[m.version]:{...m,dist:{tarball:base+p.file,integrity:p.integrity}}}}));}
if(url===p.file&&p.forbidden){r.writeHead(403,{'content-type':'application/json'});return r.end('{"error":"forbidden"}');}
if(url===p.file){r.writeHead(200,{'content-type':'application/octet-stream'});return r.end(fs.readFileSync(p.tgz));}}
r.writeHead(404,{'content-type':'application/json'});r.end('{}');});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`);
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(String(d).trim())));
  const requests = () => (fs.existsSync(path.join(dir, 'requests.log')) ? fs.readFileSync(path.join(dir, 'requests.log'), 'utf8').split('\n').filter(Boolean) : []);
  return { url: `http://127.0.0.1:${port}`, child, manifest: pkgs[0].manifest, requests };
}

test('post-publication: an absent-then-present registry answer passes after a fresh re-lookup', async () => {
  const tgz = build({ name: '@fx/late', exports: './index.js' }, { 'index.js': 'export default 1;' });
  const server = await serveRegistry(tgz);
  try {
    let packumentCalls = 0;
    const fetchImpl = async (url, init) => {
      if (url.split('?')[0] === `${server.url}/@fx%2Flate` && (packumentCalls += 1) === 1) return { status: 404, ok: false };
      return fetch(url, init);
    };
    const registryClient = createRegistry({ registry: server.url, fetchImpl, delayMs: 0 });
    const reportDir = tmp('qrep-');
    const code = await qualify({ pkg: '@fx/late@1.0.0', mode: 'post-publication', registryClient, registry: server.url, reportDir, attempts: 3, delaySeconds: 0 });
    assert.equal(code, 0, JSON.stringify(readReport(reportDir).problems));
    assert.equal(packumentCalls, 2, 'second attempt re-fetched the packument instead of reusing the cached 404');
    assert.match(fs.readFileSync(path.join(reportDir, 'qualify.log'), 'utf8'), /waiting for @fx\/late@1.0.0 \(1\/3\)/);
  } finally {
    server.child.kill();
  }
});

// ---- post-publication PEERS: registry-not-yet-visible errors are retried within the budget, others fail at once
function peerHost() {
  const peer = build({ name: '@fx/lagpeer', version: '1.0.0' }, { 'index.js': 'export const p = 1;' });
  const host = build({ name: '@fx/host', peerDependencies: { '@fx/lagpeer': '^1.0.0' }, peerDependenciesMeta: { '@fx/lagpeer': { optional: true } }, exports: { '.': './index.js', './adapter': './adapter.js' } },
    { 'index.js': 'export default 1;', 'adapter.js': "export * from '@fx/lagpeer';" });
  return { peer, host };
}

test('registry-not-yet-visible classifier: ETARGET/E404/notarget only', () => {
  for (const out of ['npm error code ETARGET', 'npm error notarget No matching version found for @fx/a@1.0.0.', 'npm error code E404', "npm error 404 Not Found - GET http://r/@fx%2fa - Not found"]) assert.ok(registryNotVisible(out), out);
  for (const out of ['npm error code EINTEGRITY', 'npm error code E401', 'npm error code ENEEDAUTH', 'npm error ECONNREFUSED']) assert.equal(registryNotVisible(out), false, out);
});

test('post-publication: a lagging registry PEERS version is retried until visible', async () => {
  const { peer, host } = peerHost();
  // The core install reads the optional peer packument once (ignored 404); the first PEERS install gets the second 404.
  const server = await serveRegistry([host, peer], { lag: { '@fx/lagpeer': 2 } });
  try {
    const reportDir = tmp('qrep-');
    const code = await qualify({ pkg: '@fx/host@1.0.0', peers: ['@fx/lagpeer@1.0.0'], mode: 'post-publication', registry: server.url, reportDir, attempts: 3, delaySeconds: 0 });
    const report = readReport(reportDir);
    assert.equal(code, 0, JSON.stringify(report.problems));
    assert.deepEqual(report.peersAdded.map((p) => `${p.name}@${p.version}:${p.exit}:${p.attempts}`), ['@fx/lagpeer@1.0.0:0:2']);
    assert.match(fs.readFileSync(path.join(reportDir, 'qualify.log'), 'utf8'), /waiting for optional peer @fx\/lagpeer@1\.0\.0 \(1\/3\)/);
  } finally {
    server.child.kill();
  }
});

test('post-publication: a PEERS install error other than not-yet-visible fails without retry', async () => {
  const { peer, host } = peerHost();
  const server = await serveRegistry([host, peer], { forbidden: ['@fx/lagpeer'] });
  try {
    const reportDir = tmp('qrep-');
    const code = await qualify({ pkg: '@fx/host@1.0.0', peers: ['@fx/lagpeer@1.0.0'], mode: 'post-publication', registry: server.url, reportDir, attempts: 3, delaySeconds: 0 });
    const report = readReport(reportDir);
    assert.equal(code, 1);
    assert.equal(report.peersAdded[0].attempts, 1, 'E403 is not retried');
    assert.match(report.problems.join('\n'), /optional peer install failed: @fx\/lagpeer@1\.0\.0/);
  } finally {
    server.child.kill();
  }
});

test('post-publication: a PEERS version still invisible after the budget fails', async () => {
  const { peer, host } = peerHost();
  const server = await serveRegistry([host, peer], { lag: { '@fx/lagpeer': 99 } });
  try {
    const reportDir = tmp('qrep-');
    assert.equal(await qualify({ pkg: '@fx/host@1.0.0', peers: ['@fx/lagpeer@1.0.0'], mode: 'post-publication', registry: server.url, reportDir, attempts: 2, delaySeconds: 0 }), 1);
    assert.equal(readReport(reportDir).peersAdded[0].attempts, 2);
  } finally {
    server.child.kill();
  }
});

// ---- SLSA provenance source commit (tarball publishing records no gitHead)
const SHA = 'a'.repeat(40);
const slsaDoc = ({ name, version, integrity, commits, subjectName }) => ({
  attestations: [
    { predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1', bundle: {} },
    { predicateType: SLSA_V1, bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify({
      _type: 'https://in-toto.io/Statement/v1', predicateType: SLSA_V1,
      subject: [{ name: subjectName ?? `pkg:npm/${name.replace(/^@/, '%40')}@${version}`, digest: { sha512: Buffer.from(integrity.slice(7), 'base64').toString('hex') } }],
      predicate: { buildDefinition: { resolvedDependencies: commits.map((c) => ({ uri: 'git+https://github.com/o/r@refs/heads/main', digest: { gitCommit: c } })) } },
    })).toString('base64') } } },
  ],
});

test('provenance check: workflow commit and published subject must match the SLSA v1 statement', () => {
  const integrity = `sha512-${createHash('sha512').update('x').digest('base64')}`;
  const id = { name: '@fx/p', version: '1.0.0', integrity, commit: SHA };
  assert.deepEqual(checkProvenance(slsaDoc({ ...id, commits: [SHA] }), id), { problems: [], sourceCommits: [SHA] });
  assert.match(checkProvenance(slsaDoc({ ...id, commits: ['b'.repeat(40)] }), id).problems.join(), /differs from the workflow commit/);
  assert.match(checkProvenance(slsaDoc({ ...id, commits: [] }), id).problems.join(), /names no source gitCommit/);
  assert.match(checkProvenance(slsaDoc({ ...id, commits: [SHA], subjectName: 'pkg:npm/%40fx/other@1.0.0' }), id).problems.join(), /subject does not match/);
  assert.match(checkProvenance(slsaDoc({ ...id, commits: [SHA] }), { ...id, integrity: `sha512-${createHash('sha512').update('y').digest('base64')}` }).problems.join(), /subject does not match/);
  assert.match(checkProvenance({ attestations: [] }, id).problems.join(), /no SLSA v1 provenance/);
});

test('provenance commit input: 40-hex SHA, PKG post-publication only', async () => {
  await assert.rejects(probe({ pkg: '@fx/a@1.0.0', mode: 'post-publication', provenanceCommit: 'HEAD' }), /40-hex/);
  await assert.rejects(probe({ pkg: '@fx/a@1.0.0', provenanceCommit: SHA }), /restricted to PKG post-publication/);
  await assert.rejects(probe({ tarball: '/x.tgz', mode: 'post-publication', provenanceCommit: SHA }), /restricted to PKG post-publication/);
});

test('post-publication: provenance is awaited within the budget and gates the qualification', async () => {
  const tgz = build({ name: '@fx/prov', exports: './index.js' }, { 'index.js': 'export default 1;' });
  const server = await serveRegistry(tgz);
  const integrity = `sha512-${createHash('sha512').update(fs.readFileSync(tgz)).digest('base64')}`;
  const run = async (answers, attempts = 3) => {
    let calls = 0;
    const registryClient = { ...createRegistry({ registry: server.url, delayMs: 0 }), attestations: async () => answers[Math.min((calls += 1), answers.length) - 1] };
    const reportDir = tmp('qrep-');
    const code = await qualify({ pkg: '@fx/prov@1.0.0', mode: 'post-publication', provenanceCommit: SHA, registryClient, registry: server.url, reportDir, attempts, delaySeconds: 0 });
    return { code, calls, report: readReport(reportDir), log: fs.readFileSync(path.join(reportDir, 'qualify.log'), 'utf8') };
  };
  try {
    const good = await run([null, slsaDoc({ name: '@fx/prov', version: '1.0.0', integrity, commits: [SHA] })]);
    assert.equal(good.code, 0, JSON.stringify(good.report.problems));
    assert.deepEqual(good.report.provenance, { commit: SHA, sourceCommits: [SHA], ok: true });
    assert.match(good.log, /waiting for provenance of @fx\/prov@1\.0\.0 \(1\/3\)/);
    const other = await run([slsaDoc({ name: '@fx/prov', version: '1.0.0', integrity, commits: ['c'.repeat(40)] })]);
    assert.equal(other.code, 1);
    assert.match(other.report.problems.join(), /differs from the workflow commit/);
    const never = await run([null], 2);
    assert.equal(never.code, 1);
    assert.equal(never.calls, 2);
    assert.match(never.report.problems.join(), /provenance attestations for @fx\/prov@1\.0\.0 unavailable after 2 x 0s/);
  } finally {
    server.child.kill();
  }
});
