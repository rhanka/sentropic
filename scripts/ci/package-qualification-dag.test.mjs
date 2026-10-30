import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { evaluateExpected, evaluateSelection, workflowExpected } from './ci-expected-results.mjs';

const require = createRequire(path.join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'));
const workflow = require('yaml').parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const jobs = workflow.jobs;
const makefile = fs.readFileSync('Makefile', 'utf8');
const storage = fs.readFileSync('packages/cluster-mesh/tests/storage/postgres.mk', 'utf8');
const packaging = fs.readFileSync('packages/cluster-mesh/packaging.mk', 'utf8');
const prepare = fs.readFileSync('packages/cluster-mesh/tests/packaging/prepare.sh', 'utf8');
const lanes = ['source', 'postgres', 'comments', 'crash', 'installed', 'major', 'stateful', 'lazy', 'install'];
const groups = ['source installed major', 'postgres comments crash', 'lazy stateful install'];

test('should require the immutable producer before every selected package qualification', () => {
  assert.deepEqual(jobs['package-candidates'].needs, ['changes']);
  for (const name of ['validate-cluster-mesh', 'validate-llm-mesh', 'validate-llm-gateway', 'validate-publishable-manifests']) {
    assert.deepEqual(jobs[name].needs, ['changes', 'package-candidates']);
    assert.ok(jobs[name].steps.some(step => step.uses?.startsWith('actions/download-artifact@')));
  }
  assert.ok(jobs['ci-gate'].needs.includes('package-candidates'));
  assert.ok(jobs['ci-gate'].needs.includes('validate-cluster-mesh'));
  assert.equal(jobs['validate-cluster-mesh'].strategy['fail-fast'], false);
  assert.equal(jobs['validate-cluster-mesh'].strategy['max-parallel'], 3);
  assert.deepEqual(jobs['validate-cluster-mesh'].strategy.matrix.include.map(row => row.lane), groups);
  assert.deepEqual(groups.flatMap(group => group.split(' ')).sort(), [...lanes].sort());
});
test('should reject every missing, failed, cancelled or skipped actual qualification member', () => {
  const expected = workflowExpected(workflow, { event: 'pull_request', changes: { cluster_mesh: 'true' } });
  const selected = expected.filter(row => row.selected);
  const executed = selected.map(row => ({ job: row.job, conclusion: 'success' }));
  assert.equal(evaluateExpected({ expected, executed }).ok, true);
  for (const lane of groups) {
    const job = `validate-cluster-mesh (${lane})`;
    assert.ok(selected.some(row => row.job === job));
    assert.equal(evaluateExpected({ expected, executed: executed.filter(row => row.job !== job) }).ok, false);
    for (const conclusion of ['failed', 'cancelled', 'skipped', 'neutral']) {
      assert.equal(evaluateExpected({ expected, executed: executed.map(row => row.job === job ? { ...row, conclusion } : row) }).ok, false);
    }
  }
});

test('should qualify candidate implementation changes while application image steps remain unselected', () => {
  const expected = workflowExpected(workflow, { event: 'pull_request', changes: { package_candidates: 'true' } });
  for (const name of ['package-candidates', 'validate-llm-mesh', 'validate-llm-gateway', ...groups.map(lane => `validate-cluster-mesh (${lane})`)]) {
    assert.equal(expected.find(row => row.job === name)?.selected, true, name);
  }
  for (const name of ['build-api-image', 'build-ui', 'build-e2e']) {
    for (const step of jobs[name].steps) {
      assert.ok(step.if, `${name}: explicit step selection`);
      assert.equal(evaluateSelection(step.if, key => {
        assert.ok(key.startsWith('needs.changes.outputs.'));
        return key.endsWith('.package_candidates') ? 'true' : 'false';
      }), false, `${name}: ${step.name ?? step.uses}`);
    }
  }
});
test('should keep mutating lanes on distinct runner workspaces and database namespaces', () => {
  const cluster = jobs['validate-cluster-mesh'];
  const dispatch = cluster.steps.find(step => step.name === 'Qualify the isolated package lane').run;
  assert.match(dispatch, /for lane in \$\{\{ matrix.lane \}\}/);
  assert.match(dispatch, /PACKAGE_LANE="\$lane" ENV=test-ci-br80-\$lane \|\| result=1/);
  assert.match(dispatch, /cluster-mesh-pg-down ENV=test-ci-br80-\$lane \|\| result=1/);
  assert.match(dispatch, /make down ENV=test-ci-br80-\$lane \|\| result=1/);
  assert.match(dispatch, /exit "\$result"/);
  assert.match(storage, /CM_PG_NAME := cm-storage-\$\(ENV\)/);
  const cleanup = cluster.steps.find(step => step.name === 'Remove installed comments qualification Postgres service and volume');
  assert.equal(cleanup.if, 'always()');
  assert.match(cleanup.run, /make down ENV=test-ci-br80-\$lane/);
  assert.match(makefile, /CM_COMMENTS_REPORT=tmp\/ci-manifest-guard\/qualify-cluster-mesh\/\$\(PACKAGE_LANE\)/);
});
test('should retain seed then crash/restart then verification in the same crash fixture', () => {
  const recipe = storage.split('cluster-mesh-pg-crash-test:\n')[1].split('\nCM_PG_NEXT_IMAGE')[0];
  assert.ok(recipe.indexOf('CM_PG_CRASH_PHASE=seed') < recipe.indexOf('cluster-mesh-pg-crash API_PORT='));
  assert.ok(recipe.indexOf('cluster-mesh-pg-crash API_PORT=') < recipe.indexOf('CM_PG_CRASH_PHASE=verify'));
  assert.match(storage, /node installed-major-upgrade\.mjs/);
  assert.match(storage, /node installed-bare\.mjs/);
});
test('should run and clean every grouped qualifier while retaining any failure', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grouped-qualifiers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'make'), '#!/bin/sh\necho "$*" >> "$CALLS"\n[ "$1" != ci-package-qualification ] || [ "$2" != "PACKAGE_LANE=$FAIL_LANE" ]\n', { mode: 0o755 });
  const script = jobs['validate-cluster-mesh'].steps.find(step => step.name === 'Qualify the isolated package lane').run;
  for (const group of groups) for (const failure of ['', ...group.split(' ')]) {
    const log = path.join(dir, 'calls');
    fs.writeFileSync(log, '');
    const result = spawnSync('sh', ['-ec', script.replace('${{ matrix.lane }}', group)], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: log, FAIL_LANE: failure },
    });
    assert.equal(result.status, failure ? 1 : 0);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 9);
    group.split(' ').forEach((lane, i) => {
      assert.equal(calls[i * 3], `ci-package-qualification PACKAGE_LANE=${lane} ENV=test-ci-br80-${lane}`);
      assert.match(calls[i * 3 + 1], new RegExp(`cluster-mesh-pg-down ENV=test-ci-br80-${lane}`));
      assert.equal(calls[i * 3 + 2], `down ENV=test-ci-br80-${lane}`);
    });
  }
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
