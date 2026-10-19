// ci-expected-results fixtures (make test-ci-expected-results).
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateExpected } from './ci-expected-results.mjs';

const selected = (job) => ({ job, required: true, selected: true });
const ran = (job, conclusion) => ({ job, conclusion });

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

test('legitimately unselected jobs do not block', () => {
  const verdict = evaluateExpected({
    expected: [selected('ci-gate'), { job: 'e2e-vscode', required: true, selected: false }],
    executed: [ran('ci-gate', 'success'), ran('e2e-vscode', 'skipped')],
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.unselected, ['e2e-vscode']);
});
