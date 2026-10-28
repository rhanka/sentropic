import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { checkDag, readiness, runtimeInputs, scanInputs } from './ci-dag.mjs';
import { evaluateExpected, workflowExpected } from './ci-expected-results.mjs';

const YAML = createRequire(path.join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'))('yaml');
const workflow = YAML.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const context = { changes: { global: 'true' }, event: 'pull_request', ref: 'refs/pull/79/merge' };

test('should start runtime and scan consumers at their actual artifact barriers', () => {
  assert.deepEqual(checkDag(workflow, context).errors, []);
  for (const [name] of Object.entries(runtimeInputs)) {
    const changed = structuredClone(workflow);
    changed.jobs[name].needs.push('security-sast-sca');
    assert.equal(checkDag(changed, context).ok, false);
  }
});

test('should keep every selected scan, matrix member and UI child in the final verdict', () => {
  const expected = workflowExpected(workflow, context);
  const good = expected.filter(row => row.selected).map(row => ({ job: row.job, conclusion: 'success' }));
  assert.equal(evaluateExpected({ expected, executed: good }).ok, true);
  for (const row of good.filter(row => /security-|typecheck-|build-ui|test-ui|extension|desktop|test-e2e/.test(row.job))) {
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', '']) {
      const executed = good.map(other => other === row ? { ...row, conclusion } : other);
      assert.equal(evaluateExpected({ expected, executed }).ok, false, `${row.job}: ${conclusion}`);
    }
    assert.equal(evaluateExpected({ expected, executed: good.filter(other => other !== row) }).ok, false);
  }
  for (const kind of Object.keys(scanInputs)) {
    assert.ok(expected.some(row => row.job === `security-container-${kind}` && row.selected));
  }
});

test('should block image promotion after a static or scan failure even with successful browsers', () => {
  for (const publisher of ['publish-api-image', 'publish-ui-image']) {
    const changed = structuredClone(workflow);
    changed.jobs[publisher].needs = changed.jobs[publisher].needs.filter(name => name !== 'security-sast-sca');
    assert.equal(checkDag(changed, context).ok, false);
  }
});

test('should retain exact membership when restoring old runtime wait edges for rollback', () => {
  const rollback = structuredClone(workflow);
  for (const name of Object.keys(runtimeInputs)) rollback.jobs[name].needs.push('security-sast-sca');
  assert.deepEqual(workflowExpected(rollback, context), workflowExpected(workflow, context));
  assert.equal(checkDag(rollback, context).ok, false);
});

test('should publish measured readiness and preserve missing or unexecuted spans', () => {
  const jobs = [{ name: 'artifact', conclusion: 'success', completed_at: '2026-10-28T10:00:05Z' },
    { id: 79, name: 'browser (a)', runner_id: 1, conclusion: 'success',
      started_at: '2026-10-28T10:00:09Z', completed_at: '2026-10-28T10:00:30Z' }];
  const [row] = readiness(jobs, { browser: ['artifact'] });
  assert.equal(row.readyAt, '2026-10-28T10:00:05.000Z');
  assert.equal(row.executions[0].admissionSeconds, 4);
  assert.equal(readiness([], { browser: ['artifact'] })[0].readyAt, null);
  assert.equal(readiness([{ ...jobs[0], conclusion: 'failure' }, jobs[1]], { browser: ['artifact'] })[0].readyAt, null);
});
