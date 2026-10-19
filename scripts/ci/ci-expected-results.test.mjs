// ci-expected-results fixtures (make test-ci-expected-results).
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateExpected, evaluateSelection } from './ci-expected-results.mjs';

const selected = (job) => ({ job, required: true, selected: true });
const ran = (job, conclusion) => ({ job, conclusion });

test('should evaluate workflow selection expressions without running expression text as code', () => {
  const values = { 'needs.changes.outputs.global': 'true', 'github.ref': 'refs/pull/705/merge' };
  const lookup = (key) => values[key] ?? '';
  assert.equal(evaluateSelection("!cancelled() && (needs.changes.outputs.global == 'true' || always())", lookup), true);
  assert.equal(evaluateSelection("github.ref == 'refs/heads/main' && needs.changes.outputs.global == 'true'", lookup), false);
  assert.equal(evaluateSelection("needs.changes.outputs.api != 'true'", lookup), true);
  for (const expression of ["unknown()", "true; process.exit()", "(true", "true false"]) {
    assert.throws(() => evaluateSelection(expression, lookup), /Unsupported|Expected|Unexpected/);
  }
});

test('all-success selected sets pass', () => {
  const verdict = evaluateExpected({
    expected: [selected('build-api-image'), selected('ci-gate')],
    executed: [ran('build-api-image', 'success'), ran('ci-gate', 'neutral')],
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.failures, []);
});

test('failed required members are rejected', () => {
  const verdict = evaluateExpected({
    expected: [selected('test-e2e')],
    executed: [ran('test-e2e', 'failure')],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.failures[0].reason, /failed|rejected/);
});

test('missing required members are rejected', () => {
  const verdict = evaluateExpected({ expected: [selected('deploy-preprod')], executed: [] });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failures[0].reason, 'missing');
});

test('cancelled required members are rejected', () => {
  for (const conclusion of ['cancelled', 'timed_out']) {
    const verdict = evaluateExpected({
      expected: [selected('publish-api-image')],
      executed: [ran('publish-api-image', conclusion)],
    });
    assert.equal(verdict.ok, false, conclusion);
  }
});

test('unexpectedly skipped required members are rejected', () => {
  const verdict = evaluateExpected({
    expected: [selected('security-container')],
    executed: [ran('security-container', 'skipped')],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failures[0].reason, 'unexpectedly-skipped');
});

test('expanded matrix members are enforced individually', () => {
  const verdict = evaluateExpected({
    expected: [{ job: 'test-e2e', matrix: ['group-a, 00 02 06 10', 'group-b, 01 04'], required: true, selected: true }],
    executed: [ran('test-e2e (group-a, 00 02 06 10)', 'success'), ran('test-e2e (group-b, 01 04)', 'skipped')],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failures.length, 1);
  assert.equal(verdict.failures[0].job, 'test-e2e (group-b, 01 04)');
  assert.equal(verdict.failures[0].reason, 'unexpectedly-skipped');
});

test('a missing matrix member is rejected while unselected matrices pass', () => {
  const missing = evaluateExpected({
    expected: [{ job: 'test-e2e', matrix: ['group-a, 00 02 06 10', 'group-b, 01 04'], required: true, selected: true }],
    executed: [ran('test-e2e (group-a, 00 02 06 10)', 'success')],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.failures[0].reason, 'missing');
  const unselected = evaluateExpected({
    expected: [{ job: 'test-e2e', matrix: ['group-a, 00 02 06 10'], required: true, selected: false }],
    executed: [ran('test-e2e (group-a, 00 02 06 10)', 'skipped')],
  });
  assert.equal(unselected.ok, true);
  assert.deepEqual(unselected.unselected, ['test-e2e (group-a, 00 02 06 10)']);
});

test('explicit member lists expand with shared flags', () => {
  const verdict = evaluateExpected({
    expected: [{ members: ['test-api-unit-integration (smoke)', 'test-api-unit-integration (unit)'], required: true, selected: true }],
    executed: [ran('test-api-unit-integration (smoke)', 'success'), ran('test-api-unit-integration (unit)', 'success')],
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.passed, ['test-api-unit-integration (smoke)', 'test-api-unit-integration (unit)']);
});

test('legitimately unselected jobs do not block', () => {
  const verdict = evaluateExpected({
    expected: [selected('ci-gate'), { job: 'e2e-vscode', required: true, selected: false }],
    executed: [ran('ci-gate', 'success'), ran('e2e-vscode', 'skipped')],
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.unselected, ['e2e-vscode']);
});
