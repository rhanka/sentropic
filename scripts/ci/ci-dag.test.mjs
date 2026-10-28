import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { checkDag, readiness, runtimeInputs, scanInputs, securityJoin } from './ci-dag.mjs';
import { evaluateExpected, evaluateSelection, workflowExpected } from './ci-expected-results.mjs';

const YAML = createRequire(path.join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'))('yaml');
const workflow = YAML.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const context = { changes: { global: 'true' }, event: 'pull_request', ref: 'refs/pull/79/merge' };

// GitHub implicitly requires success() unless a status function is explicit.
function publisherDispatch(name, changes, overrides = {}) {
  const job = workflow.jobs[name];
  const results = Object.fromEntries(job.needs.map(parent => [parent, 'success']));
  if (changes.global !== 'true') results['security-iac'] = 'skipped';
  if (changes.ui !== 'true' && changes.global !== 'true') {
    results['test-ui'] = 'skipped'; results['build-ui-static'] = 'skipped';
  }
  Object.assign(results, overrides);
  if (!/(always|cancelled|failure|success)\(\)/.test(job.if)
    && job.needs.some(parent => results[parent] !== 'success')) return false;
  return evaluateSelection(job.if, key => {
    if (key === 'github.ref') return 'refs/heads/main';
    if (key.startsWith('needs.changes.outputs.')) return changes[key.slice(22)] ?? 'false';
    const parent = key.match(/^needs\.([\w-]+)\.result$/)?.[1];
    if (parent) return results[parent];
    throw Error(`Unknown publisher context: ${key}`);
  });
}

test('should publish API-only changes with unselected UI jobs and reject every selected failed barrier', () => {
  for (const changes of [{ api: 'true' }, { ui: 'true' }, { global: 'true' }]) {
    for (const name of ['publish-api-image', 'publish-ui-image']) {
      if (changes.global !== 'true' && changes[name === 'publish-api-image' ? 'api' : 'ui'] !== 'true') continue;
      assert.equal(publisherDispatch(name, changes), true, `${name}: ${JSON.stringify(changes)}`);
      for (const parent of workflow.jobs[name].needs) {
        if (['test-ui', 'build-ui-static'].includes(parent) && !changes.ui && !changes.global) continue;
        if (parent === 'security-iac' && !changes.global) continue;
        for (const result of ['failure', 'cancelled', 'skipped']) {
          assert.equal(publisherDispatch(name, changes, { [parent]: result }), false, `${name}: ${parent}=${result}`);
        }
      }
    }
  }
});

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

test('should select exactly the workflow scan lanes for every change-filter combination', () => {
  for (const api of ['false', 'true']) for (const ui of ['false', 'true']) for (const global of ['false', 'true']) {
    const changes = { api, ui, global };
    for (const category of ['code', 'container']) {
      const lanes = Object.entries(workflow.jobs).filter(([name]) => name.startsWith(`security-${category}-`));
      assert.equal(lanes.length, category === 'code' ? 2 : 4);
      const selected = lanes.filter(([, job]) => evaluateSelection(job.if, key => {
        assert.ok(key.startsWith('needs.changes.outputs.'), key);
        return changes[key.slice(22)];
      })).map(([name]) => name);
      const needs = { changes: { result: 'success', outputs: changes },
        ...Object.fromEntries(lanes.map(([name]) => [name, { result: selected.includes(name) ? 'success' : 'skipped' }])) };
      const verdict = securityJoin(needs, category);
      const label = `${category}: ${JSON.stringify(changes)}`;
      assert.equal(verdict.ok, true, label);
      assert.deepEqual(verdict.passed.sort(), [...selected].sort(), label);
      assert.deepEqual(verdict.unselected.sort(), lanes.map(([name]) => name).filter(name => !selected.includes(name)).sort(), label);
      for (const name of selected) {
        for (const result of ['failure', 'cancelled', 'skipped', 'neutral', '']) {
          assert.equal(securityJoin({ ...needs, [name]: { result } }, category).ok, false, `${label}: ${name}=${result}`);
        }
        const missing = { ...needs }; delete missing[name];
        assert.equal(securityJoin(missing, category).ok, false, `${label}: missing ${name}`);
      }
    }
  }
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
  rollback.jobs['build-ui'].needs.push('test-ui', 'build-ui-static');
  assert.deepEqual(workflowExpected(rollback, context), workflowExpected(workflow, context));
  assert.equal(checkDag(rollback, context).ok, false);
  const expected = workflowExpected(rollback, context);
  const executed = expected.filter(row => row.selected).map(row => ({ job: row.job,
    conclusion: row.job === 'security-container-api' ? 'failure' : 'success' }));
  assert.equal(evaluateExpected({ expected, executed }).ok, false);
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
