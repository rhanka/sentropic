import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JOB_ENVIRONMENTS, READER_TOKEN_ENVIRONMENTS, REPOSITORY,
  allowedSecretsForEnvironment, assertBootstrapPlacement, assertJobEnvironment,
  classifyWorkflow, emittedSecurityWorkflow, parseWorkflowJobs,
} from '../src/seat-workflow-contract.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const workflowsDir = join(repoRoot, '.github/workflows');

test('T5-C1/T6-C1: every emitted workflow file refuses inherit, PR-target, expression environments and non-literal secret refs', async () => {
  const files = (await readdir(workflowsDir)).filter(f => f.endsWith('.yml'));
  assert.ok(files.length >= 5, 'expected the real workflow set');
  for (const file of files) {
    const text = await readFile(join(workflowsDir, file), 'utf8');
    const violations = classifyWorkflow(text, { source: 'push', ref: 'refs/heads/main' });
    assert.deepEqual(violations, [], `${file}: ${violations.join('; ')}`);
    const parsed = parseWorkflowJobs(text);
    for (const [jobId, job] of Object.entries(parsed.jobs)) {
      if (job.environment === null) continue;
      assert.match(job.environment, /^[a-z0-9-]+$/, `${file} ${jobId}: non-literal environment`);
      for (const name of job.secrets) assert.match(name, /^[A-Z0-9_]+$/, `${file} ${jobId}: non-literal secret ref ${name}`);
    }
  }
});

test('T6-C1: the fixed §4.1 job map gives each fixed job exactly its single mapped environment', () => {
  const mapped = Object.entries(JOB_ENVIRONMENTS).filter(([, env]) => env !== null) as [string, string][];
  assert.ok(mapped.length >= 30, 'the §4.1 table must enumerate every fixed job');
  for (const [job, env] of mapped) {
    assert.doesNotThrow(() => assertJobEnvironment(job, [env]));
    assert.throws(() => assertJobEnvironment(job, []), /single-environment/);
    assert.throws(() => assertJobEnvironment(job, [env, 'security-nightly']), /single-environment/);
    const wrong = env === 'security-daily-control' ? 'security-seat-writer' : 'security-daily-control';
    assert.throws(() => assertJobEnvironment(job, [wrong]), /environment-mismatch/);
  }
  assert.equal(JOB_ENVIRONMENTS['publish-scanner-image'], 'security-scanner-image-publish');
  assert.equal(JOB_ENVIRONMENTS['state-write-allocate'], 'security-seat-writer');
  assert.equal(JOB_ENVIRONMENTS['publish-fix'], 'security-repair-publish');
  assert.equal(JOB_ENVIRONMENTS['merge-fix'], 'security-repair-merge');
  assert.equal(JOB_ENVIRONMENTS['scan-supervisor'], 'security-daily-control');
  assert.equal(JOB_ENVIRONMENTS['seat-broker'], 'security-nightly');
  assert.equal(JOB_ENVIRONMENTS['key-free-scanner-worker'], null);
});

test('T5-C1: hostile same-repo PR/fork/tag/unprotected-ref, indirection and arbitrary-name attempts are refused', () => {
  const base = emittedSecurityWorkflow();
  for (const source of ['pr', 'fork'] as const) {
    assert.ok(classifyWorkflow(base, { source, ref: 'refs/pull/1/head' }).some(v => v.startsWith('unprotected-ref')), source);
  }
  assert.ok(classifyWorkflow(base, { source: 'push', ref: 'refs/tags/v1' }).some(v => v.startsWith('unprotected-ref')));
  assert.ok(classifyWorkflow(base, { source: 'push', ref: 'refs/heads/feat/x' }).some(v => v.startsWith('unprotected-ref')));
  const inherit = base.replace('permissions:', 'secrets: inherit\npermissions:');
  assert.ok(classifyWorkflow(inherit, { source: 'push', ref: 'refs/heads/main' }).includes('secrets-inherit'));
  const localAction = base.replace('runs-on: ubuntu-latest', 'runs-on: ubuntu-latest\n      uses: ./.github/actions/candidate');
  assert.ok(classifyWorkflow(localAction, { source: 'push', ref: 'refs/heads/main' }).some(v => v.startsWith('local-indirection')));
  const reusable = base.replace('steps:', 'uses: ./.github/workflows/reusable-candidate.yml\n    with:\n      environment: security-nightly\n    steps:');
  assert.ok(classifyWorkflow(reusable, { source: 'push', ref: 'refs/heads/main' }).some(v => v.startsWith('local-indirection')));
  const arbitrary = base.replace('secrets.SECURITY_CONTROL_READER_TOKEN', "secrets['dynamic-name']");
  assert.ok(classifyWorkflow(arbitrary, { source: 'push', ref: 'refs/heads/main' }).some(v => v.startsWith('secret-ref')));
  const lowercase = base.replace('secrets.SECURITY_CONTROL_READER_TOKEN', 'secrets.reader_token');
  assert.ok(classifyWorkflow(lowercase, { source: 'push', ref: 'refs/heads/main' }).some(v => v.startsWith('secret-ref')));
  const doubleEnv = base.replace('environment: security-nightly', 'environment: security-nightly\n      environment: security-seat-writer');
  assert.ok(classifyWorkflow(doubleEnv, { source: 'push', ref: 'refs/heads/main' }).some(v => v.startsWith('single-environment')));
  const noPreflight = base.replace('- name: Key-free preflight', '- name: Skipped preflight');
  assert.ok(classifyWorkflow(noPreflight, { source: 'push', ref: 'refs/heads/main' }).some(v => v.startsWith('preflight')));
  assert.deepEqual(classifyWorkflow(base, { source: 'push', ref: 'refs/heads/main' }), []);
});

test('T6-C1: the emitted security manifest passes its own scan and enumerates exactly twelve reader-token copies', () => {
  const text = emittedSecurityWorkflow();
  assert.deepEqual(classifyWorkflow(text, { source: 'push', ref: 'refs/heads/main' }), []);
  assert.equal(READER_TOKEN_ENVIRONMENTS.length, 12);
  assert.deepEqual([...READER_TOKEN_ENVIRONMENTS].sort(), [
    'security-ci-status', 'security-daily-control', 'security-nightly', 'security-promotion-control',
    'security-repair-merge', 'security-repair-publish', 'security-report-publish', 'security-review-attest',
    'security-seat-admission', 'security-seat-dispatch', 'security-seat-writer', 'security-source-acquire',
  ]);
  for (const env of READER_TOKEN_ENVIRONMENTS) {
    assert.ok(allowedSecretsForEnvironment(env).has('SECURITY_CONTROL_READER_TOKEN'), env);
  }
  assert.ok(!allowedSecretsForEnvironment('security-scanner-image-publish').has('SECURITY_CONTROL_READER_TOKEN'));
  assert.equal(REPOSITORY, 'rhanka/sentropic');
});

test('L3-F/T6-C1: bootstrap launcher exists only on protected main and closes permanently after the #681 merge', () => {
  const main = emittedSecurityWorkflow();
  assert.deepEqual(assertBootstrapPlacement(main, { merged681: false }), []);
  const pr = classifyWorkflow(main, { source: 'pr', ref: 'refs/pull/681/head' });
  assert.ok(pr.some(v => v.startsWith('unprotected-ref')));
  assert.ok(assertBootstrapPlacement(main, { merged681: true }).includes('bootstrap-closed'));
  assert.throws(() => assertBootstrapPlacement(main, { merged681: 'unknown' as never }), /merge-state-unknown/);
  const wrongHost = main.replace('ref: refs/heads/main', 'ref: refs/heads/feat/cyber-act-L03a');
  assert.ok(assertBootstrapPlacement(wrongHost, { merged681: false }).some(v => v.startsWith('bootstrap-ref')));
});
