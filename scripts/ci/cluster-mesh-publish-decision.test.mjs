// Publish decision tests for @sentropic/cluster-mesh (make test-publishable-manifests).
// Stable versions publish; a prerelease (the planned bump-gate dev series) is a typed, logged
// skip that never reaches any npm publish call; anything else stays red.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { decideClusterMeshPublish, main, STABLE_CLUSTER_MESH_VERSION } from './cluster-mesh-publish-decision.mjs';
import { GuardError, loadSemver } from './publishable-manifests.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const semver = loadSemver();
const recipe = (target) => {
  const match = makefile.match(new RegExp(`^${target}:[^\\n]*\\n((?:\\t[^\\n]*\\n?)+)`, 'm'));
  return match ? match[1] : null;
};

function manifestFixture(t, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-publish-decision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'package.json');
  fs.writeFileSync(file, JSON.stringify({ name: '@sentropic/cluster-mesh', version }));
  return file;
}

const runMain = async (args) => {
  const chunks = [];
  const out = new Writable({ write(chunk, _encoding, done) { chunks.push(String(chunk)); done(); } });
  const status = await main(args, { cwd: os.tmpdir(), out });
  return { status, stdout: chunks.join('') };
};

test('stable Cluster Mesh versions publish', async t => {
  for (const version of ['0.26.0', '1.0.0', '10.20.30']) {
    assert.deepEqual(decideClusterMeshPublish(version, semver), { decision: 'publish', version });
    assert.equal(STABLE_CLUSTER_MESH_VERSION.test(version), true);
  }
  const { status, stdout } = await runMain(['--manifest', manifestFixture(t, '0.26.0')]);
  assert.equal(status, 0);
  assert.equal(stdout, 'decision=publish\nversion=0.26.0\nsummary=stable 0.26.0: publishing\n'
    + '::notice title=Cluster Mesh publish decision::stable 0.26.0: publishing\n');
});

test('prerelease versions are a typed, logged skip without any npm publish call', async t => {
  for (const version of ['0.26.0-dev.0', '0.26.0-dev.1', '1.0.0-beta.1', '2.0.0-rc.1']) {
    assert.deepEqual(decideClusterMeshPublish(version, semver), { decision: 'skip', reason: 'prerelease', version });
    assert.equal(STABLE_CLUSTER_MESH_VERSION.test(version), false);
  }
  const { status, stdout } = await runMain(['--manifest', manifestFixture(t, '0.26.0-dev.1')]);
  assert.equal(status, 0);
  assert.equal(stdout, 'decision=skip\nreason=prerelease\nversion=0.26.0-dev.1\n'
    + 'summary=prerelease 0.26.0-dev.1: not published\n'
    + '::notice title=Cluster Mesh publish decision::prerelease 0.26.0-dev.1: not published\n');
  // The decision path itself is publish-free: it spawns no process and touches no registry.
  const source = fs.readFileSync(new URL('./cluster-mesh-publish-decision.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /child_process|spawnSync|\bnpm\b|registry\.npmjs|\bfetch\(/);
});

test('versions that are neither stable nor prerelease stay red', async t => {
  for (const version of ['0.26', 'banana', '1.2.3.4', '1.2.3+build', '']) {
    assert.throws(() => decideClusterMeshPublish(version, semver), GuardError);
  }
  assert.throws(() => decideClusterMeshPublish(undefined, semver), GuardError);
  const invalid = manifestFixture(t, '0.26');
  await assert.rejects(() => runMain(['--manifest', invalid]), GuardError);
  const script = fileURLToPath(new URL('./cluster-mesh-publish-decision.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script, '--manifest', invalid], { encoding: 'utf8' });
  assert.ifError(run.error);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /::error title=Cluster Mesh publish decision::/);
});

test('the publish job decides before publishing: a prerelease skip never invokes the npm publish target', () => {
  const steps = ci.jobs['publish-cluster-mesh'].steps;
  const decide = steps.find((step) => step.run === 'make cluster-mesh-publish-decision');
  const publish = steps.find((step) => step.run === 'make publish-cluster-mesh');
  const qualify = steps.find((step) => step.name === 'Qualify published Cluster Mesh from the registry');
  assert.ok(decide, 'decision step exists');
  assert.equal(decide.id, 'cluster_mesh_publish_decision');
  assert.equal(decide.if, 'inputs.capacity_publish_dry_run != true');
  assert.ok(steps.indexOf(decide) < steps.indexOf(publish), 'decision runs before the publish step');
  const gated = "inputs.capacity_publish_dry_run != true && steps.cluster_mesh_publish_decision.outputs.decision == 'publish'";
  assert.equal(publish.if, gated, 'publish only on a publish decision');
  assert.equal(qualify.if, gated, 'post-publication qualification only on a publish decision');
  const decision = recipe('cluster-mesh-publish-decision');
  assert.ok(decision.includes('cluster-mesh-publish-decision.mjs'), 'make entry point runs the decision module');
  assert.match(decision, /GITHUB_OUTPUT/, 'typed decision forwarded to the job outputs');
  assert.match(decision, /GITHUB_STEP_SUMMARY/, 'skip is logged in the step summary');
});

test('the stable publish guard is unchanged and still gates both publish targets', () => {
  const guard = recipe('engram-e2-stable-publish-guard');
  assert.ok(guard.includes('[0-9]+\\.[0-9]+\\.[0-9]+$$'), 'stable version pattern unchanged');
  assert.ok(guard.includes('Only stable Cluster Mesh versions may be published'), 'guard message unchanged');
  assert.match(makefile, /^publish-cluster-mesh: engram-e2-stable-publish-guard build-cluster-mesh /m);
  assert.match(makefile, /^publish-cluster-mesh-token: engram-e2-stable-publish-guard build-cluster-mesh /m);
});
