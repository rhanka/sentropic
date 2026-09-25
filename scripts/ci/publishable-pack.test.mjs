// Real `npm pack` lifecycle, archive, bump and guarded-publication fixtures (make test-publishable-manifests).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Writable } from 'node:stream';
import { GuardError, TRANSIENT_HINT, commandPack, commandPublish, createRegistry, diffDependencyMaps, isTransientError, runNpmPack, sha256File, withManifestTransform } from './publishable-manifests.mjs';

const sink = () => {
  const chunks = [];
  const out = new Writable({ write(c, _e, cb) { chunks.push(String(c)); cb(); } });
  out.text = () => chunks.join('');
  return out;
};
function fixture(slug, manifest, files = {}) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pack-fixture-')), slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@fx/${slug}`, version: '1.0.0', files: ['index.js', 'hook.cjs'], ...manifest }, null, 2));
  fs.writeFileSync(path.join(dir, 'index.js'), 'export default 1;\n');
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}
const hook = (mutation) => `const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));${mutation};fs.writeFileSync('package.json',JSON.stringify(p));`;
const absentRegistry = { lookup: async (name, version) => ({ status: 'absent', evidence: { name, version } }) };
const presentRegistry = (published) => ({
  lookup: async (name, version) => ({ status: 'present', evidence: { name, version } }),
  fetchPublishedManifest: async () => ({ manifest: published, sha256: 'a'.repeat(64) }),
});
const warnEnv = { CI_MANIFEST_CONTEXT: JSON.stringify({ package_files: '[]', matched_filters: '["global"]' }), CI_MANIFEST_EVENT: 'pull_request' };
async function pack(dir, { env = {}, registry = absentRegistry, destination } = {}) {
  const out = sink();
  const reportDir = path.join(path.dirname(dir), 'reports');
  const opts = { slug: path.basename(dir), 'report-dir': reportDir, ...(destination ? { destination } : {}) };
  const code = await commandPack(opts, { env: { MANIFEST_GUARD_TOOL_DIR: process.env.MANIFEST_GUARD_TOOL_DIR, ...env }, cwd: dir, registry, out });
  const receipt = JSON.parse(fs.readFileSync(path.join(reportDir, `${opts.slug}.receipt.json`), 'utf8'));
  return { code, out: out.text(), receipt };
}

test('normal semver package passes in standalone (BLOCK) mode and leaves no archive behind', async () => {
  const dir = fixture('good', { dependencies: { hono: '^4.10.7' } });
  const r = await pack(dir);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.receipt.manifest_mode, 'block');
  assert.deepEqual(r.receipt.reasons, ['standalone-default']);
  assert.equal(r.receipt.archive, null);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.tgz')).length, 0);
});

test('safe source with a prepack-injected file: dependency fails on the packed member', async () => {
  const dir = fixture('inject', { scripts: { prepack: 'node hook.cjs' } }, { 'hook.cjs': hook("p.dependencies={'@fx/oauth-verify':'file:../oauth-verify'}") });
  const r = await pack(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /packed .*dependencies\[\\?"@fx\/oauth-verify\\?"\].*file:/);
});

test('bad source with a cleaned archive still fails on the source manifest', async () => {
  const dir = fixture('clean', { dependencies: { '@fx/x': 'file:../x' }, scripts: { prepack: 'node hook.cjs' } }, { 'hook.cjs': hook("p.dependencies={'@fx/x':'^1.0.0'}") });
  const r = await pack(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /source package.json: dependencies/);
});

test('WARN context emits a warning annotation and exits zero; BLOCK context exits nonzero', async () => {
  const bad = { dependencies: { '@fx/chat-ui': 'file:../chat-ui' } };
  const warn = await pack(fixture('cowork-desktop', bad), { env: warnEnv });
  assert.equal(warn.code, 0);
  assert.equal(warn.receipt.manifest_mode, 'warn');
  assert.match(warn.out, /::warning file=packages\/cowork-desktop\/package.json/);
  const blockEnv = { ...warnEnv, CI_MANIFEST_CONTEXT: JSON.stringify({ package_files: '["packages/cowork-desktop/src/a.ts"]', matched_filters: '[]' }) };
  const block = await pack(fixture('cowork-desktop', bad), { env: blockEnv });
  assert.equal(block.code, 1);
  assert.match(block.out, /::error file=packages\/cowork-desktop\/package.json/);
  await assert.rejects(pack(fixture('x', {}), { env: { MANIFEST_SEVERITY: 'warn' } }), /only accepts "block"/);
});

test('identity and private tampering in pack hooks are rejected', async () => {
  const priv = await pack(fixture('priv', { scripts: { prepack: 'node hook.cjs' } }, { 'hook.cjs': hook('p.private=true') }));
  assert.equal(priv.code, 1);
  assert.match(priv.out, /switched to private/);
  const ver = await pack(fixture('ver', { scripts: { prepack: 'node hook.cjs' } }, { 'hook.cjs': hook("p.version='9.9.9'") }));
  assert.equal(ver.code, 1);
  assert.match(ver.out, /identity mismatch/);
});

test('npm pack failure is reported separately from dependency violations', async () => {
  await assert.rejects(pack(fixture('fails', { scripts: { prepack: 'exit 3' } })), /npm pack failed/);
});

test('noisy lifecycle stdout is never mistaken for the archive name', () => {
  const dir = fixture('noisy', { scripts: { prepack: 'node hook.cjs' } }, { 'hook.cjs': 'console.log("[");console.log("fake.tgz");console.log("]");' });
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-'));
  const { archive, lifecycleLog } = runNpmPack(dir, dest);
  assert.equal(path.basename(archive), 'fx-noisy-1.0.0.tgz');
  assert.ok(lifecycleLog.length >= 0);
});

test('explicit destination retains the archive and emits step outputs', async () => {
  const dir = fixture('keep', {});
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-'));
  const r = await pack(dir, { destination: dest, env: { PACK_DESTINATION_HOST: '/host/out' } });
  assert.equal(r.code, 0);
  assert.equal(r.receipt.archive, '/host/out/fx-keep-1.0.0.tgz');
  assert.equal(r.receipt.sha256, sha256File(path.join(dest, 'fx-keep-1.0.0.tgz')));
  assert.equal(fs.readFileSync(path.join(path.dirname(dir), 'reports', 'keep.github-output'), 'utf8'), 'tarball=/host/out/fx-keep-1.0.0.tgz\nmanifest_mode=block\n');
});

test('manifest transform is restored after success and failure', () => {
  const dir = fixture('chat-ui', {}, {});
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'make-publish-pkgjson.mjs'), "import fs from 'node:fs';const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.main='./dist/index.js';fs.writeFileSync('package.json',JSON.stringify(p));");
  const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  withManifestTransform(dir, () => assert.match(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), /dist\/index.js/));
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), before);
  assert.throws(() => withManifestTransform(dir, () => { throw new Error('boom'); }), /boom/);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), before);
});

// ---- D7 bump gate
test('dependency map diff: additions, removals, changes fail; key order and absent-vs-empty do not', () => {
  assert.deepEqual(diffDependencyMaps({ dependencies: { a: '1', b: '2' } }, { dependencies: { b: '2', a: '1' }, peerDependencies: {} }), []);
  const changes = diffDependencyMaps(
    { dependencies: { a: 'file:../a', gone: '^1.0.0' }, peerDependencies: { p: '^1.0.0' } },
    { dependencies: { a: '^1.0.0' }, peerDependencies: { p: '^1.0.0' }, optionalDependencies: { o: '^1.0.0' } },
  );
  assert.deepEqual(changes.map((c) => `${c.section}:${c.name}`), ['dependencies:a', 'dependencies:gone', 'optionalDependencies:o']);
  assert.deepEqual(diffDependencyMaps({ devDependencies: { x: '1' } }, { devDependencies: { x: '2' } }), []);
});

test('manifest-only file: -> semver repair at an existing version fails "bump required"; bumped absent version passes', async () => {
  const repaired = fixture('mcp-auth', { dependencies: { '@fx/oauth-verify': '^0.1.0' } });
  const r = await pack(repaired, { registry: presentRegistry({ name: '@fx/mcp-auth', version: '1.0.0', dependencies: { '@fx/oauth-verify': 'file:../oauth-verify' } }) });
  assert.equal(r.code, 1);
  assert.match(r.out, /bump required: @fx\/mcp-auth@1.0.0 is already published/);
  const same = await pack(fixture('mcp-auth', { dependencies: { '@fx/oauth-verify': '^0.1.0' } }), { registry: presentRegistry({ name: '@fx/mcp-auth', version: '1.0.0', dependencies: { '@fx/oauth-verify': '^0.1.0' } }) });
  assert.equal(same.code, 0, same.out);
  const bumped = await pack(fixture('mcp-auth', { version: '1.0.1', dependencies: { '@fx/oauth-verify': '^0.1.0' } }));
  assert.equal(bumped.code, 0);
  const failing = { lookup: async () => ({ status: 'present', evidence: {} }), fetchPublishedManifest: async () => { throw new Error('integrity mismatch'); } };
  await assert.rejects(pack(fixture('mcp-auth', {}), { registry: failing }), /integrity mismatch/);
});

// ---- guarded publication (stub npm publish; nothing is published)
function npmStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-stub-'));
  const stub = path.join(dir, 'npm');
  fs.writeFileSync(stub, `#!/usr/bin/env node\nconst fs=require('fs');const c=require('crypto');const a=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(path.join(dir, 'call.json'))},JSON.stringify({args:a,sha256:c.createHash('sha256').update(fs.readFileSync(a[1])).digest('hex')}));\n`);
  fs.chmodSync(stub, 0o755);
  return { stub, call: () => JSON.parse(fs.readFileSync(path.join(dir, 'call.json'), 'utf8')), called: () => fs.existsSync(path.join(dir, 'call.json')) };
}
const marker = "require('fs').writeFileSync('prepack-ran','1')";

test('existing version skips with WARN before candidate packing and strict checks', async () => {
  const dir = fixture('cowork-desktop', { dependencies: { a: 'file:../a' }, scripts: { prepack: 'node hook.cjs' } }, { 'hook.cjs': marker });
  const npm = npmStub();
  const out = sink();
  const code = await commandPublish({ slug: 'cowork-desktop', passthrough: ['--access', 'public'], 'receipt-dir': path.join(dir, '..', 'r') }, { env: {}, cwd: dir, registry: presentRegistry({}), out, npm: npm.stub });
  assert.equal(code, 0);
  assert.match(out.text(), /::warning .*already exists/);
  assert.equal(fs.existsSync(path.join(dir, 'prepack-ran')), false, 'candidate lifecycle must not run');
  assert.equal(npm.called(), false);
});

test('absent version publishes exactly the inspected archive with retained flags', async () => {
  const dir = fixture('cluster-mesh', { dependencies: { hono: '^4.10.7' }, publishConfig: { provenance: true, access: 'public' } });
  const npm = npmStub();
  const receiptDir = path.join(dir, '..', 'r');
  const code = await commandPublish({ slug: 'cluster-mesh', passthrough: ['--access', 'public', '--no-provenance'], 'receipt-dir': receiptDir }, { env: {}, cwd: dir, registry: absentRegistry, out: sink(), npm: npm.stub });
  assert.equal(code, 0);
  const call = npm.call();
  assert.equal(call.args[0], 'publish');
  assert.match(call.args[1], /fx-cluster-mesh-1.0.0.tgz$/);
  assert.deepEqual(call.args.slice(2), ['--access', 'public', '--no-provenance']);
  const receipt = JSON.parse(fs.readFileSync(path.join(receiptDir, 'cluster-mesh.json'), 'utf8'));
  assert.equal(receipt.sha256, call.sha256);
  assert.equal(receipt.status, 'published');
  assert.equal(fs.readFileSync(path.join(receiptDir, 'cluster-mesh.publish-output'), 'utf8'), 'pkg=@fx/cluster-mesh@1.0.0\nstatus=published\n');
});

test('publication of a violating absent version is rejected strictly', async () => {
  const npm = npmStub();
  const dir = fixture('mcp-auth', { dependencies: { '@fx/oauth-verify': 'file:../oauth-verify' } });
  const code = await commandPublish({ slug: 'mcp-auth', passthrough: [], 'receipt-dir': path.join(dir, '..', 'r') }, { env: {}, cwd: dir, registry: absentRegistry, out: sink(), npm: npm.stub });
  assert.equal(code, 1);
  assert.equal(npm.called(), false);
});

// ---- registry freshness: absent/404 answers are never cached; rechecks always hit the registry
const sequenceFetch = (answers) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const doc = answers[Math.min(calls.length, answers.length) - 1];
    return doc === null ? { status: 404, ok: false } : { status: 200, ok: true, json: async () => doc };
  };
  return { fetchImpl, calls };
};

test('pre-publish recheck performs a fresh registry request and skips a concurrent publication', async () => {
  const dir = fixture('events', {});
  const npm = npmStub();
  const { fetchImpl, calls } = sequenceFetch([null, { versions: { '1.0.0': {} } }]);
  const registry = createRegistry({ registry: 'http://registry.test', fetchImpl, delayMs: 0 });
  const out = sink();
  const code = await commandPublish({ slug: 'events', passthrough: [], 'receipt-dir': path.join(dir, '..', 'r') }, { env: {}, cwd: dir, registry, out, npm: npm.stub });
  assert.equal(code, 0);
  assert.match(out.text(), /already exists \(recheck before publish\)/);
  assert.equal(npm.called(), false);
  assert.equal(calls.length, 2, 'initial lookup and recheck each reach the registry');
  assert.ok(calls.every((c) => c.init.cache === 'no-store'));
});

test('registry cache: present packuments are reused for listed versions only; fresh lookups bypass it', async () => {
  const { fetchImpl, calls } = sequenceFetch([{ versions: { '1.0.0': {} } }, { versions: { '1.0.0': {}, '1.1.0': {} } }]);
  const registry = createRegistry({ registry: 'http://registry.test', fetchImpl, delayMs: 0 });
  assert.equal((await registry.lookup('@fx/a', '1.0.0')).status, 'present');
  assert.equal((await registry.lookup('@fx/a', '1.0.0')).status, 'present');
  assert.equal(calls.length, 1, 'listed version answered from cache');
  assert.equal((await registry.lookup('@fx/a', '1.1.0')).status, 'present', 'unlisted version refetched');
  await registry.lookup('@fx/a', '1.0.0', { fresh: true });
  assert.equal(calls.length, 3);
});

test('registry request: 400/401/403 are permanent (no retry); 408/429/5xx and network exceptions are transient', async () => {
  const run = async (answer) => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (answer instanceof Error) throw answer;
      return { status: answer, ok: false };
    };
    const registry = createRegistry({ registry: 'http://registry.test', fetchImpl, attempts: 3, delayMs: 0 });
    const error = await registry.lookup('@fx/a', '1.0.0').then(() => null, (e) => e);
    assert.ok(error instanceof GuardError);
    return { error, calls };
  };
  for (const status of [400, 401, 403]) {
    const { error, calls } = await run(status);
    assert.equal(error.transient, false, `HTTP ${status}`);
    assert.equal(calls, 1, `HTTP ${status} is not retried`);
    assert.doesNotMatch(error.message, /re-run, not debt/);
    assert.equal(isTransientError(error), false);
  }
  for (const answer of [408, 429, 500, 503, new TypeError('fetch failed')]) {
    const { error, calls } = await run(answer);
    assert.equal(error.transient, true, String(answer));
    assert.equal(calls, 3, `${answer} is retried`);
    assert.equal(error.message.split(TRANSIENT_HINT).length, 2, 'hint appears exactly once');
  }
});

test('transient message classifier: node/undici/npm network codes only', () => {
  for (const msg of ['TypeError: fetch failed', 'ERR_SOCKET_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'HTTP 408', 'HTTP 429', 'HTTP 502',
    'npm error code E429', 'npm error code E503', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']) assert.ok(isTransientError(new Error(msg)), msg);
  for (const msg of ['write EPIPE', 'HTTP 403', 'HTTP 401', 'npm error code E404', 'npm error code E403', 'npm error code EJSONPARSE', 'E4290 unrelated'])
    assert.equal(isTransientError(new Error(msg)), false, msg);
});

test('GuardError wrapping a transient cause carries the re-run hint once', () => {
  const inner = new GuardError('registry request failed: HTTP 503', { transient: true });
  const outer = new GuardError(`cannot resolve packed identity of x: ${inner.message}`, { transient: true });
  assert.equal(outer.message.split(TRANSIENT_HINT).length, 2);
  assert.equal(outer.transient, true);
});
