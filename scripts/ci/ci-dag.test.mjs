import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { checkDag, readiness, runtimeInputs, scanInputs, securityJoin } from './ci-dag.mjs';
import { evaluateExpected, workflowExpected } from './ci-expected-results.mjs';

const YAML = createRequire(path.join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'))('yaml');
const workflow = YAML.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const context = { changes: { global: 'true' }, event: 'pull_request', ref: 'refs/pull/79/merge' };

test('should reject a missing or failed selected scan while allowing unselected lanes', () => {
  for (const changes of [{ global: 'true' }, { api: 'true' }, { ui: 'true' }]) {
    const needs = { changes: { result: 'success', outputs: { api: 'false', ui: 'false', global: 'false', ...changes } } };
    for (const kind of Object.keys(scanInputs)) {
      const selected = changes.global || (kind === 'ui' ? changes.ui : kind === 'e2e' ? changes.api || changes.ui : changes.api);
      needs[`security-container-${kind}`] = { result: selected ? 'success' : 'skipped' };
    }
    assert.equal(securityJoin(needs, 'container').ok, true);
    for (const [name, row] of Object.entries(needs).filter(([name, row]) => name !== 'changes' && row.result === 'success')) {
      for (const result of ['failure', 'skipped', 'cancelled', 'neutral', '']) {
        assert.equal(securityJoin({ ...needs, [name]: { result } }, 'container').ok, false);
      }
      const missing = { ...needs }; delete missing[name];
      assert.equal(securityJoin(missing, 'container').ok, false);
    }
  }
  assert.equal(securityJoin({}, 'container').ok, false);
  assert.equal(securityJoin({ changes: { result: 'success', outputs: {} } }, 'container').ok, false);
  assert.throws(() => securityJoin({}, 'unknown'), /Unknown scan category/);
});

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
