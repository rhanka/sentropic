import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { evaluateExpected, workflowExpected } from './ci-expected-results.mjs';

const YAML = createRequire(join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'))('yaml');
const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const jobs = workflow.jobs;

test('should cache exact toolbox inputs without reusing a previous run transport receipt', () => {
  const steps = jobs['build-api-tool-image'].steps;
  const restore = steps.find(s => s.id === 'toolbox-cache');
  assert.ok(restore.with.key.includes('steps.toolbox-key.outputs.key'));
  assert.equal(restore.with['restore-keys'], undefined);
  assert.equal(restore.if, "env.CI_IMAGE_CACHE == '1'");
  for (const command of ['load-api-tool-cache', 'test-ci-api-tool-runtime', 'save-api-tool', 'save-api-tool-cache']) {
    assert.ok(steps.some(s => s.run === `make ${command} ENV=test-ci-api`), command);
  }
  for (const command of ['test-ci-api-tool-runtime', 'save-api-tool']) {
    assert.equal(steps.find(s => s.run === `make ${command} ENV=test-ci-api`).if, undefined);
  }
  assert.equal(steps.find(s => s.run === 'make ci-build-api-tool ENV=test-ci-images').if,
    "steps.toolbox-cache.outputs.cache-hit != 'true' && steps.toolbox-registry.outputs.hit != 'true'");
});

test('should publish the prebuilt toolbox only from a main-only successor after interface verification', () => {
  const producer = jobs['build-api-tool-image'];
  assert.equal(producer.permissions.packages, 'read');
  assert.ok(!producer.steps.some(s => s.run?.includes('push-api-tool-registry')));
  assert.match(producer.steps.find(s => s.id === 'toolbox-registry').if, /CI_IMAGE_CACHE == '1'/);
  const publish = jobs['api-tool-registry-publish'];
  assert.deepEqual(publish.needs, ['changes', 'build-api-tool-image']);
  assert.match(publish.if, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.equal(publish.permissions.packages, 'write');
  const runs = publish.steps.map(s => s.run);
  assert.ok(runs.indexOf('make load-api-tool ENV=test-ci-api') < runs.indexOf('make push-api-tool-registry ENV=test-ci-api'));
  assert.equal(publish.steps.find(s => s.uses?.startsWith('actions/download-artifact@')).with.name, 'api-tool-image');
  for (const name of ['ci-gate', 'ci-capacity-receipts']) assert.ok(jobs[name].needs.includes('api-tool-registry-publish'), name);
});

test('should never grant packages:write to a job that can run on pull_request', () => {
  const expected = workflowExpected(workflow, { changes: { global: 'true' }, event: 'pull_request', ref: 'refs/pull/1/merge' });
  const selectedOnPr = new Set(expected.filter(row => row.selected).map(row => row.job.replace(/ \(.*$/, '')));
  for (const [name, job] of Object.entries(jobs)) {
    if (job.permissions?.packages !== 'write') continue;
    assert.ok(!selectedOnPr.has(name), `${name} holds packages:write on pull_request`);
  }
  assert.ok(!selectedOnPr.has('api-tool-registry-publish'));
  const main = workflowExpected(workflow, { changes: { global: 'true' }, event: 'push', ref: 'refs/heads/main' });
  assert.equal(main.find(row => row.job === 'api-tool-registry-publish').selected, true);
});

test('should start independent consumer checks after selection and retain real archive dependencies', () => {
  assert.deepEqual(jobs['consumer-contracts'].needs, ['changes']);
  assert.ok(!jobs['consumer-contracts'].steps.some(step => step.with?.name === 'package-candidates'));
  assert.deepEqual(jobs['validate-cluster-mesh'].needs, ['changes', 'package-candidates']);
  assert.ok(jobs['validate-cluster-mesh'].steps.some(step => step.run?.includes('make ci-package-verify')));
});

test('should dispatch source suites without waiting for the production image', () => {
  for (const name of ['test-api-unit-integration', 'test-api-ai']) {
    assert.deepEqual(jobs[name].needs, ['changes', 'build-api-tool-image']);
    assert.equal(jobs[name].env.API_TEST_SUT, '0');
    assert.ok(!jobs[name].steps.some(s => s.with?.name === 'api-image'));
  }
  const matrix = jobs['test-api-unit-integration'].strategy.matrix.include;
  assert.deepEqual(matrix.filter(row => row.suite === 'unit').map(row => row.unit_shard), [1, 2, 3, 4]);
  assert.ok(!matrix.some(row => ['smoke', 'limit'].includes(row.suite)));
});

test('should keep both production suites and reject either missing result', () => {
  assert.deepEqual(jobs['test-api-sut'].needs, ['changes', 'build-api-image', 'build-api-tool-image']);
  assert.equal(jobs['test-api-sut'].env.API_TEST_SUT, '1');
  assert.deepEqual(jobs['test-api-sut'].strategy.matrix.include.map(row => row.suite), ['smoke', 'limit']);
  assert.ok(jobs['ci-gate'].needs.includes('test-api-sut'));
  assert.ok(jobs['publish-api-image'].needs.includes('test-api-sut'));
  assert.ok(jobs['publish-api-image'].if.includes("needs.test-api-sut.result == 'success'"));
  const expected = workflowExpected(workflow, { changes: { global: 'true' }, event: 'pull_request' });
  const executed = expected.filter(row => row.selected).map(row => ({ job: row.job, conclusion: 'success' }));
  for (const suite of ['smoke', 'limit']) {
    const name = `test-api-sut (${suite})`;
    assert.ok(expected.some(row => row.job === name && row.selected));
    assert.equal(evaluateExpected({ expected, executed: executed.filter(row => row.job !== name) }).ok, false);
  }
});
