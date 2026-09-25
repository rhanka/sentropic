// BLOCK/WARN classification fixtures (make test-publishable-manifests).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Writable } from 'node:stream';
import { changedPackages, classifyPackages, commandInventory, GuardError, normalizeContext, readContext } from './publishable-manifests.mjs';

const ctx = (over = {}) => normalizeContext({
  outputs: { package_files: JSON.stringify(over.files ?? []), matched_filters: JSON.stringify(over.filters ?? []) },
  event: over.event ?? 'pull_request',
  bootstrap: over.bootstrap,
  changesResult: 'success',
});
const PUBLIC = ['cluster-mesh', 'cowork-desktop', 'oauth-verify', 'mcp-auth', 'focus', 'skills', 'events'];
const classify = async (context, absentSet = new Set()) => {
  const { classification, removed } = await classifyPackages({ publicSlugs: PUBLIC, context, absent: async (s) => absentSet.has(s) });
  return { block: PUBLIC.filter((s) => classification.get(s).severity === 'block'), removed, classification };
};

test('source, test, README and manifest-only edits put only that package in C', async () => {
  for (const file of ['src/index.ts', 'tests/a.test.ts', 'README.md', 'package.json']) {
    assert.deepEqual((await classify(ctx({ files: [`packages/cluster-mesh/${file}`] }))).block, ['cluster-mesh']);
  }
});

test('Makefile/ci.yml/scripts-only and docs-only changes leave every package WARN', async () => {
  assert.deepEqual((await classify(ctx({ files: [], filters: ['global', 'manifest_guard', 'llm_mesh'] }))).block, []);
});

test('oauth-verify change blocks oauth-verify only; mcp-auth stays WARN', async () => {
  const r = await classify(ctx({ files: ['packages/oauth-verify/src/a.ts'], filters: ['oauth_verify', 'mcp_auth', 'oauth_verify_publish'] }));
  assert.deepEqual(r.block, ['oauth-verify']);
});

test('root lock changes: existing packed versions WARN, absent packed versions BLOCK, on PR and main', async () => {
  const filters = ['cowork_desktop_publish', 'mcp_auth_publish', 'focus_publish'];
  for (const event of ['pull_request', 'push']) {
    assert.deepEqual((await classify(ctx({ files: [], filters, event }))).block, []);
    assert.deepEqual((await classify(ctx({ files: [], filters, event }), new Set(['mcp-auth']))).block, ['mcp-auth']);
  }
});

test('focus_publish has no steady-state publisher: an absent focus version is not selected by it alone', async () => {
  assert.deepEqual((await classify(ctx({ filters: ['focus_publish'] }), new Set(['focus']))).block, []);
});

test('bootstrap: explicit target BLOCK even if published; all keeps existing WARN; none is empty', async () => {
  assert.deepEqual((await classify(ctx({ event: 'workflow_dispatch', bootstrap: 'cowork-desktop' }))).block, ['cowork-desktop']);
  assert.deepEqual((await classify(ctx({ event: 'workflow_dispatch', bootstrap: 'all' }), new Set(['events']))).block, ['events']);
  assert.deepEqual((await classify(ctx({ event: 'workflow_dispatch', bootstrap: 'none' }))).block, []);
  assert.deepEqual((await classify(ctx({ event: 'pull_request', bootstrap: 'cowork-desktop' }))).block, [], 'bootstrap input ignored outside dispatch');
});

test('new, public-transition, deleted and renamed packages', async () => {
  const r = await classify(ctx({ files: ['packages/old-name/src/a.ts', 'packages/skills/src/a.ts', 'packages/focus/package.json'] }));
  assert.deepEqual(r.block, ['focus', 'skills']);
  assert.deepEqual(r.removed, ['old-name']);
  assert.deepEqual([...changedPackages(['packages/a/x', 'packages/b', 'README.md'])], ['a']);
});

test('lookup failure propagates as ERROR, never WARN', async () => {
  await assert.rejects(
    classifyPackages({ publicSlugs: PUBLIC, context: ctx({ filters: ['mcp_auth_publish'] }), absent: async () => { throw new GuardError('registry down', { transient: true }); } }),
    /re-run, not debt/,
  );
});

test('missing, corrupt or failed context is rejected', () => {
  assert.throws(() => normalizeContext({ outputs: {}, event: 'push', changesResult: 'success' }), /package_files/);
  assert.throws(() => normalizeContext({ outputs: { package_files: '[', matched_filters: '[]' }, event: 'push' }), /not valid JSON/);
  assert.throws(() => normalizeContext({ outputs: { package_files: '[]', matched_filters: '[]' }, event: 'push', changesResult: 'failure' }), /not success/);
  assert.throws(() => normalizeContext({ outputs: { package_files: '[]', matched_filters: '[]' }, event: 'schedule' }), /unsupported/);
  assert.throws(() => normalizeContext({ outputs: { package_files: '[]', matched_filters: '[]' }, event: 'workflow_dispatch', bootstrap: 'nope' }), /unknown bootstrap/);
  assert.throws(() => readContext({ CI_MANIFEST_CONTEXT: '{', CI_MANIFEST_EVENT: 'push' }), /not valid JSON/);
  assert.equal(readContext({}), null);
});

// ---- inventory integration with a fake repository, snapshot and registry
const sink = () => {
  const chunks = [];
  const out = new Writable({ write(c, _e, cb) { chunks.push(String(c)); cb(); } });
  out.text = () => chunks.join('');
  return out;
};
function fakeRepo(packages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-'));
  for (const [slug, manifest] of Object.entries(packages)) {
    fs.mkdirSync(path.join(root, 'packages', slug), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', slug, 'package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  }
  return root;
}
const COWORK = { name: '@sentropic/cowork-desktop', version: '0.2.0', dependencies: { '@sentropic/chat-ui': 'file:../chat-ui' } };
const MESH = { name: '@sentropic/cluster-mesh', version: '0.11.0', dependencies: { hono: '^4.10.7' } };
const inventoryEnv = (files, filters, event = 'pull_request', bootstrap = 'none') => ({
  CI_MANIFEST_CONTEXT: JSON.stringify({ package_files: JSON.stringify(files), matched_filters: JSON.stringify(filters) }),
  CI_MANIFEST_EVENT: event, CI_MANIFEST_BOOTSTRAP_TARGET: bootstrap, CI_MANIFEST_CHANGES_RESULT: 'success',
});
const snapshotFrom = (versions = {}) => (dir) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const packed = { ...manifest, version: versions[path.basename(dir)] ?? manifest.version };
  return { name: packed.name, version: packed.version, packed, sha256: 'f'.repeat(64) };
};
async function inventory({ packages, env, published = new Set(), versions, failLookup = false }) {
  const root = fakeRepo(packages);
  const reportDir = path.join(root, 'reports');
  const out = sink();
  const registry = { lookup: async (name, version) => {
    if (failLookup) throw new GuardError('registry HTTP 503', { transient: true });
    return { status: published.has(`${name}@${version}`) ? 'present' : 'absent', evidence: { name, version } };
  } };
  const code = await commandInventory({ 'report-dir': reportDir }, { env, root, registry, out, snapshot: snapshotFrom(versions) });
  const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'classification.json'), 'utf8'));
  return { code, out: out.text(), report, blockFile: fs.existsSync(path.join(reportDir, 'block-packages.txt')) ? fs.readFileSync(path.join(reportDir, 'block-packages.txt'), 'utf8') : null };
}

test('inventory: root-lock-only change with published cowork WARNs and exits zero', async () => {
  const r = await inventory({ packages: { 'cowork-desktop': COWORK, 'cluster-mesh': MESH, private: { name: 'p', version: '0.0.0', private: true } }, env: inventoryEnv([], ['cowork_desktop_publish']), published: new Set(['@sentropic/cowork-desktop@0.2.0']) });
  assert.equal(r.code, 0);
  assert.match(r.out, /::warning file=packages\/cowork-desktop\/package.json.*file%3A|::warning file=packages\/cowork-desktop\/package.json/);
  assert.equal(r.report.packages['cowork-desktop'].severity, 'warn');
  assert.equal(r.report.packages.private, undefined);
  assert.equal(r.blockFile, '');
});

test('inventory: changed cowork BLOCKs with an error annotation and nonzero exit', async () => {
  const r = await inventory({ packages: { 'cowork-desktop': COWORK }, env: inventoryEnv(['packages/cowork-desktop/src/a.ts'], []) });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error file=packages\/cowork-desktop\/package.json/);
  assert.equal(r.blockFile, 'cowork-desktop\n');
});

test('inventory: packed version (not the source guess) drives absent-version selection', async () => {
  const r = await inventory({ packages: { 'cluster-mesh': MESH }, env: inventoryEnv([], ['cluster_mesh_publish']), published: new Set(['@sentropic/cluster-mesh@0.11.0']), versions: { 'cluster-mesh': '0.12.0' } });
  assert.equal(r.report.packages['cluster-mesh'].severity, 'block');
  assert.deepEqual(r.report.packages['cluster-mesh'].reasons, ['publication-selected-absent-version']);
});

test('inventory: registry outage is an ERROR that says re-run, not debt', async () => {
  const r = await inventory({ packages: { 'cluster-mesh': MESH }, env: inventoryEnv([], ['cluster_mesh_publish']), failLookup: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /classification ERROR.*re-run, not debt/);
});

test('inventory: selected public package without a pack lane fails (skills)', async () => {
  const r = await inventory({ packages: { skills: { name: '@sentropic/skills', version: '0.1.2' } }, env: inventoryEnv(['packages/skills/src/a.ts'], []) });
  assert.equal(r.code, 1);
  assert.match(r.out, /missing pack lane/);
});

test('inventory: non-boolean private and invalid JSON are structural errors; context is mandatory', async () => {
  const r = await inventory({ packages: { a: { name: 'a', version: '1.0.0', private: 'yes' }, b: '{' }, env: inventoryEnv([], []) });
  assert.equal(r.code, 1);
  assert.match(r.out, /must be a boolean/);
  assert.match(r.out, /invalid package.json/);
  await assert.rejects(commandInventory({}, { env: {}, root: fakeRepo({}), out: sink() }), /refusing to guess/);
});

test('sibling plan: BLOCK packages in the dependency closure only; no context injects nothing', async () => {
  const { commandSiblingPlan } = await import('./publishable-manifests.mjs');
  const root = fakeRepo({
    'mcp-auth': { name: '@sentropic/mcp-auth', version: '0.2.2', dependencies: { '@sentropic/oauth-verify': '^0.1.1' }, peerDependencies: { hono: '^4.0.0' } },
    'oauth-verify': { name: '@sentropic/oauth-verify', version: '0.1.1' },
    'cluster-mesh': MESH,
  });
  const outFile = path.join(root, 'plan.txt');
  const registry = { lookup: async (name, version) => ({ status: 'present', evidence: { name, version } }) };
  const run = (env) => commandSiblingPlan({ slug: 'mcp-auth', out: outFile }, { env, root, registry, out: sink(), snapshot: snapshotFrom() });
  assert.equal(await run(inventoryEnv(['packages/mcp-auth/src/a.ts', 'packages/oauth-verify/src/b.ts'], [])), 0);
  assert.equal(fs.readFileSync(outFile, 'utf8'), 'oauth-verify\n');
  assert.equal(await run(inventoryEnv(['packages/mcp-auth/src/a.ts'], [])), 0);
  assert.equal(fs.readFileSync(outFile, 'utf8'), '', 'unchanged published sibling resolves from the registry');
  assert.equal(await run({}), 0);
  assert.equal(fs.readFileSync(outFile, 'utf8'), '');
});
