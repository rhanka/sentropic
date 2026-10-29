import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { evaluateExpected, workflowExpected } from './ci-expected-results.mjs';

const require = createRequire(path.join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'));
const workflow = require('yaml').parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const jobs = workflow.jobs;
const makefile = fs.readFileSync('Makefile', 'utf8');
const storage = fs.readFileSync('packages/cluster-mesh/tests/storage/postgres.mk', 'utf8');
const packaging = fs.readFileSync('packages/cluster-mesh/packaging.mk', 'utf8');
const prepare = fs.readFileSync('packages/cluster-mesh/tests/packaging/prepare.sh', 'utf8');
const lanes = ['source', 'postgres', 'comments', 'crash', 'installed', 'major', 'stateful', 'lazy', 'install'];

test('should require the immutable producer before every selected package qualification', () => {
  assert.deepEqual(jobs['package-candidates'].needs, ['changes']);
  for (const name of ['validate-cluster-mesh', 'validate-llm-mesh', 'validate-llm-gateway', 'validate-publishable-manifests']) {
    assert.deepEqual(jobs[name].needs, ['changes', 'package-candidates']);
    assert.ok(jobs[name].steps.some(step => step.uses?.startsWith('actions/download-artifact@')));
  }
  assert.ok(jobs['ci-gate'].needs.includes('package-candidates'));
  assert.ok(jobs['ci-gate'].needs.includes('validate-cluster-mesh'));
  assert.equal(jobs['validate-cluster-mesh'].strategy['fail-fast'], false);
  assert.deepEqual(jobs['validate-cluster-mesh'].strategy.matrix.include.map(row => row.lane), lanes);
});
test('should reject every missing, failed, cancelled or skipped actual qualification member', () => {
  const expected = workflowExpected(workflow, { event: 'pull_request', changes: { cluster_mesh: 'true' } });
  const selected = expected.filter(row => row.selected);
  const executed = selected.map(row => ({ job: row.job, conclusion: 'success' }));
  assert.equal(evaluateExpected({ expected, executed }).ok, true);
  for (const lane of lanes) {
    const job = `validate-cluster-mesh (${lane})`;
    assert.ok(selected.some(row => row.job === job));
    assert.equal(evaluateExpected({ expected, executed: executed.filter(row => row.job !== job) }).ok, false);
    for (const conclusion of ['failed', 'cancelled', 'skipped', 'neutral']) {
      assert.equal(evaluateExpected({ expected, executed: executed.map(row => row.job === job ? { ...row, conclusion } : row) }).ok, false);
    }
  }
});
test('should keep mutating lanes on distinct runner workspaces and database namespaces', () => {
  const cluster = jobs['validate-cluster-mesh'];
  assert.ok(cluster.steps.some(step => step.run?.includes('PACKAGE_LANE=${{ matrix.lane }} ENV=test-ci-br80-${{ matrix.lane }}')));
  assert.match(storage, /CM_PG_NAME := cm-storage-\$\(ENV\)/);
  const cleanup = cluster.steps.find(step => step.run?.includes('cluster-mesh-pg-down'));
  assert.equal(cleanup.if, 'always()');
  assert.match(cleanup.run, /make down ENV=test-ci-br80-\$\{\{ matrix.lane \}\}/);
  assert.match(makefile, /CM_COMMENTS_REPORT=tmp\/ci-manifest-guard\/qualify-cluster-mesh\/\$\(PACKAGE_LANE\)/);
});
test('should retain seed then crash/restart then verification in the same crash fixture', () => {
  const recipe = storage.split('cluster-mesh-pg-crash-test:\n')[1].split('\nCM_PG_NEXT_IMAGE')[0];
  assert.ok(recipe.indexOf('CM_PG_CRASH_PHASE=seed') < recipe.indexOf('cluster-mesh-pg-crash API_PORT='));
  assert.ok(recipe.indexOf('cluster-mesh-pg-crash API_PORT=') < recipe.indexOf('CM_PG_CRASH_PHASE=verify'));
  assert.match(storage, /node installed-major-upgrade\.mjs/);
  assert.match(storage, /node installed-bare\.mjs/);
});
test('should retain lazy bare, selected-peer, latest, global and refused-tuple consumers without rebuilding candidates', () => {
  for (const member of ['fixture bare', 'tuple selected', 'tuple selected-session', 'tuple latest', 'stage global-consumer', 'tuple old-tuple', 'tuple partial-bump']) {
    assert.ok(prepare.includes(member), member);
  }
  assert.match(packaging, /ifeq \(\$\(CI_PACKAGE_CANDIDATES\),\)\n\t@\$\(MAKE\).*build-cluster-mesh/);
  assert.match(packaging, /run tests\/packaging --exclude tests\/packaging\/activation-vectors\.spec\.ts/);
  assert.match(prepare, /candidate_archive cluster-mesh/);
  assert.match(prepare, /package-candidate\.mjs verify/);
});
test('should grant only source read permissions and pin each candidate-related external action', () => {
  for (const name of ['package-candidates', 'validate-cluster-mesh', 'validate-llm-mesh', 'validate-llm-gateway', 'validate-publishable-manifests']) {
    assert.deepEqual(jobs[name].permissions, { contents: 'read' });
    assert.ok(!JSON.stringify(jobs[name]).includes('secrets.'));
    for (const step of jobs[name].steps.filter(step => step.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
});
