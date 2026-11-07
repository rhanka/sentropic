import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { workflowExpected, evaluateExpected } from './ci-expected-results.mjs';

const yaml = createRequire(path.join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'))('yaml');
const workflow = yaml.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));

test('should reject each missing, failed, cancelled or skipped static and artifact member', () => {
  const expected = workflowExpected(workflow, { changes: { global: 'true' }, event: 'pull_request' });
  const members = expected.filter(row => /^(api-static|artifacts-qualification) \(/.test(row.job)
    || row.job === 'idp-web-static');
  assert.equal(members.length, 8);
  const executed = expected.filter(row => row.selected).map(row => ({ job: row.job, conclusion: 'success' }));
  assert.equal(evaluateExpected({ expected, executed }).ok, true);
  for (const member of members) {
    assert.equal(member.selected, true, member.job);
    for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
      const failed = executed.map(row => row.job === member.job ? { ...row, conclusion } : row);
      assert.equal(evaluateExpected({ expected, executed: failed }).ok, false, `${member.job}: ${conclusion}`);
    }
    assert.equal(evaluateExpected({ expected, executed: executed.filter(row => row.job !== member.job) }).ok, false);
  }
});

test('should keep all five artifact obligations and parallel static tools selected by their owning paths', () => {
  assert.deepEqual(workflow.jobs['artifacts-qualification'].strategy.matrix.include.map(row => row.lane),
    ['budget', 'static-package', 'unit', 'integration', 'activation']);
  assert.deepEqual(workflow.jobs['api-static'].strategy.matrix.include.map(row => row.lane), ['typecheck', 'lint']);
  for (const owner of ['api', 'artifacts']) {
    const expected = workflowExpected(workflow, { changes: { [owner]: 'true' }, event: 'pull_request' });
    const prefix = owner === 'api' ? 'api-static (' : 'artifacts-qualification (';
    assert.ok(expected.filter(row => row.job.startsWith(prefix)).every(row => row.selected));
  }
  for (const join of ['ci-gate', 'ci-capacity-receipts']) {
    for (const parent of ['api-static', 'idp-web-static', 'artifacts-qualification']) {
      assert.ok(workflow.jobs[join].needs.includes(parent), `${join}: ${parent}`);
    }
  }
});

test('should execute joins fail closed for failed or absent upstream results', () => {
  const source = fs.readFileSync('scripts/ci/ci-static.mk', 'utf8');
  const run = (target, values) => {
    const recipe = source.split(`${target}: ci-test-env\n`)[1].split('\n\n')[0]
      .replaceAll('\t@', '').replace(/\$\((\w+)\)/g, (_, key) => '${' + key + '}');
    return spawnSync('sh', ['-ec', recipe], { env: values, encoding: 'utf8' }).status;
  };
  const results = { CI_TYPECHECK_RESULT: 'success', CI_LINT_RESULT: 'success', CI_IDP_WEB_RESULT: 'success' };
  assert.equal(run('ci-static-join', results), 0);
  for (const key of Object.keys(results)) {
    for (const value of ['failure', 'cancelled', 'skipped', '']) {
      assert.notEqual(run('ci-static-join', { ...results, [key]: value }), 0);
    }
  }
  assert.equal(run('ci-artifacts-join', { CI_ARTIFACT_RESULT: 'success' }), 0);
  for (const value of ['failure', 'cancelled', 'skipped', '']) {
    assert.notEqual(run('ci-artifacts-join', { CI_ARTIFACT_RESULT: value }), 0);
  }
});
