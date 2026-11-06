import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { evaluateExpected, workflowExpected } from './ci-expected-results.mjs';

const YAML = createRequire(join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'))('yaml');
const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const jobs = workflow.jobs;

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
