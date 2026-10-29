// ci-expected-results fixtures (make test-ci-expected-results).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { evaluateExpected, evaluateSelection, workflowExpected, reconcileRun, capacityDemand, capacityCapture, wallClockProof } from './ci-expected-results.mjs';

const selected = (job) => ({ job, required: true, selected: true });
const ran = (job, conclusion) => ({ job, conclusion });
const YAML = createRequire(path.join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'))('yaml');
const workflow = YAML.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));

test('should select API and E2E gates for global changes on every pull request', () => {
  assert.doesNotMatch(JSON.stringify(workflow), /decision_fixture_only|feat\/decision-v4-l5/);
  const expected = workflowExpected(workflow, { changes: { global: 'true' }, event: 'pull_request' });
  for (const job of ['test-api-unit-integration', 'test-e2e', 'e2e-vscode']) {
    const members = expected.filter((row) => row.job.startsWith(job));
    assert.ok(members.length > 0 && members.every((row) => row.selected === true));
  }
  assert.equal(expected.find((row) => row.job === 'validate-llm-mesh').selected, true);
  assert.equal(expected.find((row) => row.job === 'validate-cluster-mesh').selected, true);
});

test('should require completed PR and main receipts of the same policy within the baseline', () => {
  const sample = (id, event, head_branch) => ({ policyDigest: 'final-policy', run: {
    id, event, head_branch, status: 'completed', conclusion: 'success',
    created_at: '2026-10-26T10:00:00Z', updated_at: '2026-10-26T10:38:08Z',
  }, jobs: [{ name: 'ci-gate', runner_id: 1, conclusion: 'success',
    started_at: '2026-10-26T10:38:00Z', completed_at: '2026-10-26T10:38:08Z' }] });
  const pr = sample(1, 'pull_request', 'topic');
  const main = sample(2, 'push', 'main');
  const proof = rows => wallClockProof(rows, 'final-policy');
  assert.equal(proof([pr, main]).accepted, true);
  assert.equal(proof([pr, main]).runs[0].wallClockSeconds, 2288);
  const carried = { name: 'publish-contracts', runner_id: 2, conclusion: 'success',
    started_at: '2026-10-26T09:50:00Z', completed_at: '2026-10-26T09:51:00Z' };
  assert.equal(proof([pr, { ...main, jobs: [...main.jobs, carried] }]).accepted, false);
  assert.equal(proof([pr, { ...main, jobs: [{ ...main.jobs[0], started_at: null }] }]).accepted, false);
  for (const rows of [[], [pr], [pr, pr], [pr, { ...main, policyDigest: 'old-policy' }],
    [pr, { ...main, run: { ...main.run, status: 'in_progress' } }],
    [pr, { ...main, run: { ...main.run, conclusion: 'cancelled' } }],
    [pr, { ...main, run: { ...main.run, event: 'workflow_dispatch' } }],
    [pr, { ...main, run: { ...main.run, updated_at: '2026-10-26T10:38:09Z' } }],
    [pr, { ...main, jobs: [] }]]) assert.equal(proof(rows).accepted, false);
});

test('should keep validators independent without static capacity mutexes', () => {
  const concurrency = { group: 'capacity-0', queue: 'max', 'cancel-in-progress': false };
  assert.equal(capacityDemand({ jobs: { a: { concurrency }, b: { concurrency } } }), 1);
  assert.equal(capacityDemand({ jobs: { a: { concurrency }, b: {} } }), 2);
  assert.throws(() => capacityDemand({ jobs: { a: { concurrency: { group: 'capacity-0' } } } }), /queue/);
  const validators = Object.entries(workflow.jobs).filter(([name]) =>
    /^validate-/.test(name) && !['validate-publishable-manifests', 'validate-ci-capacity-metrics', 'validate-idp-sync'].includes(name)
    || name === 'memory-l5-qualification');
  assert.equal(validators.length, 24);
  for (const [name, job] of validators) {
    assert.deepEqual(job.needs, ['changes'], name);
    assert.equal(job.concurrency, undefined, name);
  }
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.ok(!job.concurrency?.group.startsWith('ci-capacity-'), name);
  }
  assert.equal(workflow.jobs['test-api-unit-integration'].strategy['max-parallel'], 15);
  assert.equal(workflow.jobs['test-e2e'].strategy['max-parallel'], 5);
});

test('should run E2E beside API quality checks while retaining promotion barriers', () => {
  assert.ok(!workflow.jobs['test-e2e'].needs.includes('typecheck-lint-api'));
  for (const name of ['ci-gate', 'ci-capacity-receipts', 'publish-api-image', 'publish-ui-image']) {
    assert.ok(workflow.jobs[name].needs.includes('typecheck-lint-api'), name);
  }
  assert.equal(workflow.concurrency.group, 'ci-${{ github.ref }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
});

test('should allow unrelated npm releases when another package fails', () => {
  const train = new Set(['publish-llm-mesh', 'publish-llm-gateway', 'publish-cluster-mesh']);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (!name.startsWith('publish-') || name.endsWith('-image') || train.has(name)) continue;
    const own = name.replace('publish-', 'validate-');
    const required = name === 'publish-mcp-auth' ? ['changes', own, 'publish-oauth-verify'] : ['changes', own];
    assert.deepEqual(job.needs, required, name);
    assert.ok(!job.if.includes('failure()'), name);
    const lookup = key => key === 'github.ref' ? 'refs/heads/main'
      : key.startsWith('needs.changes.outputs.') ? 'true'
      : key === 'needs.publish-oauth-verify.result' ? 'skipped' : 'success';
    assert.equal(evaluateSelection(job.if, lookup), true, name);
    assert.equal(evaluateSelection(job.if, key => key === `needs.${own}.result` ? 'failure' : lookup(key)), false, name);
  }
});

test('should exercise the real publication DAG on a branch without running registry writers', () => {
  const makefile = fs.readFileSync('Makefile', 'utf8');
  const dryRunPackages = makefile.match(/@case '\$\(PACKAGE\)' in ([a-z0-9|\-]+)\) ;;/)?.[1].split('|') ?? [];
  const changes = Object.fromEntries(Object.keys(workflow.jobs.changes.outputs).map(key => [key, key === 'engram_e2' ? 'false' : 'true']));
  const context = { changes, ref: 'refs/heads/topic', event: 'workflow_dispatch', inputs: { capacity_publish_dry_run: true } };
  const selected = workflowExpected(workflow, context).filter(row => row.selected && row.job.startsWith('publish-'));
  assert.equal(selected.length, 21);
  for (const { job: name } of selected) {
    const steps = workflow.jobs[name].steps;
    const dry = steps.find(step => step.name === 'Dry-run package publication');
    assert.equal(dry.if, 'inputs.capacity_publish_dry_run == true', name);
    assert.deepEqual(dry.env, {
      CI_MANIFEST_CONTEXT: '${{ toJSON(needs.changes.outputs) }}',
      CI_MANIFEST_EVENT: '${{ github.event_name }}',
      CI_MANIFEST_BOOTSTRAP_TARGET: "${{ inputs.bootstrap_publish_target || 'none' }}",
    }, name);
    assert.equal(dry.run, `make ci-capacity-publish-dry-run PACKAGE=${name.slice(8)} ENV=test-ci-capacity`);
    assert.ok(dryRunPackages.includes(name.slice(8)), `${name}: accepted dry-run package`);
    for (const step of steps.filter(step => /^Publish |^Qualify published /.test(step.name ?? ''))) {
      assert.equal(step.if, 'inputs.capacity_publish_dry_run != true', `${name}/${step.name}`);
    }
  }
  const normal = workflowExpected(workflow, { ...context, inputs: { capacity_publish_dry_run: false } });
  assert.equal(normal.some(row => row.selected && row.job.startsWith('publish-')), false);
});

test('should gate the integrated client runtime through the core validator and OIDC publisher', () => {
  const steps = workflow.jobs['validate-chat-core'].steps.map(step => step.run ?? '').join('\n');
  for (const target of ['typecheck-chat-core', 'build-chat-core', 'test-pkg-chat-core', 'pack-chat-core', 'qualify-published-install']) {
    assert.ok(steps.includes(target), target);
  }
  assert.match(steps, /PEERS=svelte@5\.55\.7,@sentropic\/chat-ui@0\.34\.1/);
  const pack = workflow.jobs['validate-chat-core'].steps.find(step => step.id === 'pack');
  assert.match(pack.run, /PACK_OUTPUT_FILE="\$GITHUB_OUTPUT"/);
  const qualify = workflow.jobs['validate-chat-core'].steps.find(step => step.run?.includes('make qualify-published-install'));
  assert.equal(qualify.env.CANDIDATE_TARBALL, '${{ steps.pack.outputs.tarball }}');
  assert.match(qualify.run, /TARBALL="\$CANDIDATE_TARBALL"/);
  assert.deepEqual(workflow.jobs['publish-chat-core'].needs, ['changes', 'validate-chat-core']);
  assert.equal(workflow.jobs['publish-chat-core'].permissions['id-token'], 'write');
  assert.equal(workflow.jobs['validate-chat-runtime'], undefined);
  assert.equal(workflow.jobs['publish-chat-runtime'], undefined);
  assert.ok(workflow.jobs['ci-gate'].needs.includes('validate-chat-core'));
});

test('should bound simultaneous execution slots across dependency joins and matrix caps', () => {
  assert.equal(capacityDemand({ jobs: { a: {}, b: { needs: ['a'] }, c: {} } }), 2);
  const matrix = { strategy: { 'max-parallel': 2, matrix: { include: [{ x: 1 }, { x: 2 }, { x: 3 }] } } };
  assert.equal(capacityDemand({ jobs: { a: matrix, b: { needs: ['a'] }, c: {} } }), 3);
  assert.throws(() => capacityDemand({ jobs: { a: { needs: ['missing'] } } }), /dependency/);
  assert.throws(() => capacityDemand({ jobs: { a: { needs: ['b'] }, b: { needs: ['a'] } } }), /cycle/);
});

test('should capture only selected delivery endpoints and reject cross-head receipts', () => {
  const run = { id: 77, head_sha: 'abc', event: 'push' };
  const manifest = { identity: { runId: '77', headSha: 'abc' }, expected: [
    selected('publish-api-image'), selected('deploy-preprod'), selected('publish-comments'),
    { job: 'publish-ui-image', selected: false },
  ] };
  const capture = capacityCapture(workflow, run, [], manifest);
  assert.equal(capture.policyDigest, null, 'unattested source files never prove the executed policy');
  const policyDigest = createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
  assert.equal(capacityCapture(workflow, run, [], { ...manifest, policyDigest }).policyDigest, policyDigest);
  assert.throws(() => capacityCapture(workflow, run, [], { ...manifest, policyDigest: 'other-workflow' }), /policy/);
  assert.deepEqual(capture.endpoints.images, ['publish-api-image']);
  assert.deepEqual(capture.endpoints.packages, ['publish-comments']);
  assert.equal(capture.timings.verdictSeconds, null);
  assert.equal(capacityCapture(workflow, run, [{ name: 'changes', runner_id: 0, conclusion: 'cancelled',
    started_at: '2026-10-26T15:46:09Z', completed_at: '2026-10-26T15:52:57Z' }], manifest).timings.classificationSeconds, null);
  assert.deepEqual(capture.dependencies['ci-gate'], workflow.jobs['ci-gate'].needs);
  assert.throws(() => capacityCapture(workflow, { ...run, head_sha: 'wrong' }, [], manifest), /identity/);
});

test('should authenticate current-attempt receipts and fail closed on API errors', async () => {
  const gate = workflow.jobs['ci-gate'];
  assert.deepEqual(gate.permissions, { contents: 'read', actions: 'write' });
  const script = gate.steps.find((step) => step.name === 'Capture the current attempt for the final verdict').with.script;
  const execute = new (Object.getPrototypeOf(async function () {}).constructor)('require', 'context', 'github', 'process', script);
  const requests = [];
  let captured;
  const files = { writeFileSync: (_file, value) => { captured = JSON.parse(value); } };
  const context = { repo: { owner: 'rhanka', repo: 'sentropic' }, runId: 7 };
  const params = { ...context.repo, run_id: 7, attempt_number: 3 };
  const actions = {
    getWorkflowRunAttempt: async (input) => {
      requests.push(input);
      return { data: { id: 7, run_attempt: 3, head_sha: 'abc' } };
    },
    listJobsForWorkflowRunAttempt: Symbol('authenticated job-list endpoint'),
  };
  const github = { rest: { actions }, paginate: async (endpoint, input) => {
    assert.equal(endpoint, actions.listJobsForWorkflowRunAttempt);
    requests.push(input);
    // Octokit's paginator returns the flattened members of all pages.
    return [1, 2].map(id => ({ id, run_id: 7, run_attempt: 3 }));
  } };
  const process = { env: { GITHUB_RUN_ATTEMPT: '3', GITHUB_WORKFLOW_SHA: 'workflow' } };
  await execute(() => files, context, github, process);
  assert.deepEqual(requests, [params, { ...params, per_page: 100 }]);
  assert.deepEqual(captured.jobs.map(job => job.id), [1, 2]);
  assert.equal(captured.run.run_attempt, 3);
  assert.equal(captured.sourceSha, 'abc');
  assert.equal(captured.workflowSha, 'workflow');
  for (const status of [403, 503]) {
    const reject = async () => { throw new Error(`HTTP ${status}`); };
    for (const client of [
      { ...github, rest: { actions: { ...actions, getWorkflowRunAttempt: reject } } },
      { ...github, paginate: reject },
    ]) {
      captured = undefined;
      await assert.rejects(execute(() => files, context, client, process), new RegExp(`HTTP ${status}`));
      assert.equal(captured, undefined, 'an API error must never produce a receipt');
    }
  }
});

test('should delete only current-run transport artifacts after every consumer, even when validation fails', async () => {
  const names = ['api-tool-image', 'api-image', 'ui-image', 'e2e-image', 'desktop-download'];
  const gate = workflow.jobs['ci-gate'];
  const cleanup = gate.steps.at(-1);
  assert.equal(cleanup.name, 'Delete consumed transport artifacts');
  assert.match(cleanup.if, /^always\(\)/);
  assert.match(cleanup.if, /github.event.pull_request.head.repo.full_name == github.repository/);
  assert.match(cleanup.uses, /^actions\/github-script@[a-f0-9]{40}$/);
  assert.deepEqual(Object.entries(workflow.jobs).filter(([, job]) => job.permissions?.actions === 'write').map(([name]) => name), ['ci-gate']);
  const ancestors = new Set();
  const visit = name => {
    for (const parent of workflow.jobs[name].needs ?? []) if (!ancestors.has(parent)) { ancestors.add(parent); visit(parent); }
  };
  visit('ci-gate');
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (!names.includes(step.with?.name)) continue;
      if (step.uses?.startsWith('actions/upload-artifact@')) assert.equal(step.with['retention-days'], 1);
      if (step.uses?.startsWith('actions/download-artifact@')) {
        assert.ok(ancestors.has(name), `${name} must finish before cleanup`);
        assert.equal(step.with['run-id'], undefined, 'transport stays within this run');
      }
    }
  }
  for (const name of ['publish-api-image', 'publish-ui-image', 'deploy-preprod']) assert.ok(ancestors.has(name));
  const execute = new (Object.getPrototypeOf(async function () {}).constructor)('context', 'github', 'core', cleanup.with.script);
  const context = { repo: { owner: 'rhanka', repo: 'sentropic' }, runId: 7 };
  const list = Symbol('list run artifacts'), deleted = [];
  const github = { rest: { actions: { listWorkflowRunArtifacts: list,
    deleteArtifact: async input => deleted.push(input) } }, paginate: async (endpoint, input) => {
      assert.equal(endpoint, list);
      assert.deepEqual(input, { ...context.repo, run_id: 7, per_page: 100 });
      return [...names, 'security-container-api-results', 'ci-expected-7-1', 'package-candidates', 'api-image-other']
        .map((name, id) => ({ id, name, size_in_bytes: 10 }));
    } };
  await execute(context, github, { info() {} });
  assert.deepEqual(deleted, names.map((_, artifact_id) => ({ ...context.repo, artifact_id })));
  for (const operation of ['list', 'delete']) {
    const reject = async () => { throw Error('HTTP 403'); };
    const client = operation === 'list' ? { ...github, paginate: reject }
      : { ...github, rest: { actions: { ...github.rest.actions, deleteArtifact: reject } } };
    await assert.rejects(execute(context, client, { info() {} }), /HTTP 403/);
  }
});

test('should reject incomplete real gate contexts and missing expanded receipts through its exact script', () => {
  const expected = workflowExpected(workflow, { changes: { global: 'true' }, event: 'pull_request' });
  const gateExpected = workflow.jobs['ci-gate'].needs.map((job) => ({ job,
    selected: job === 'ci-capacity-receipts' || expected.some((row) => row.selected
      && (row.job === job || row.job.startsWith(`${job} (`))) }));
  const needs = Object.fromEntries(gateExpected.map((row) => [row.job, { result: row.selected ? 'success' : 'skipped' }]));
  const executed = expected.map((row) => ran(row.job, row.selected ? 'success' : 'skipped'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-'));
  const script = path.resolve('scripts/ci/ci-expected-results.mjs');
  try {
    fs.mkdirSync(path.join(dir, 'tmp/ci-capacity'), { recursive: true });
    // Forward the exact workflow Make invocation to its Node evaluator inside
    // this existing test container; no nested Docker or host runtime is needed.
    fs.writeFileSync(path.join(dir, 'make'), `#!/bin/sh
set -eu
[ "$1" = ci-expected-results ]; shift
for arg do
  case "$arg" in EXPECTED_FILE=*) expected="\${arg#*=}";; EXECUTED_FILE=*) executed="\${arg#*=}";; ENV=test-ci-62) ;; *) exit 2;; esac
done
exec '${process.execPath}' '${script}' --expected-file "$expected" --executed-file "$executed"
`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'tmp/ci-capacity/expected.json'), JSON.stringify({ expected, gateExpected }));
    const run = (context, rows = executed) => {
      fs.writeFileSync(path.join(dir, 'tmp/ci-capacity/capture.json'), JSON.stringify({ executed: rows }));
      return spawnSync('bash', ['-euo', 'pipefail', '-c', workflow.jobs['ci-gate'].steps.find((s) => s.name === 'Check required CI results').run], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
          CI_GATE_NEEDS: JSON.stringify(context), CI_NEEDS: JSON.stringify(context), CI_EVENT: 'pull_request' },
      });
    };
    const good = run(needs);
    assert.equal(good.status, 0, good.stderr);
    assert.notEqual(run({ changes: needs.changes }).status, 0);
    const member = executed.find((row) => row.job.startsWith('test-e2e ('));
    assert.notEqual(run(needs, executed.filter((row) => row.job !== 'changes')).status, 0);
    assert.notEqual(run(needs, executed.filter((row) => row !== member)).status, 0);
    assert.notEqual(run(needs, executed.map((row) => row === member ? ran(row.job, 'skipped') : row)).status, 0);
    for (const job of ['validate-publishable-manifests', 'validate-ci-capacity-metrics']) {
      assert.notEqual(run({ ...needs, [job]: { result: 'skipped' } }).status, 0);
      assert.notEqual(run(needs, executed.map((row) => row.job === job ? ran(job, 'skipped') : row)).status, 0);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('should reconcile attempt identity, actual members and the complete final needs context', () => {
  const identity = { runId: 7, attempt: 2, headSha: 'abc' };
  const manifest = { identity, expected: [selected('test-e2e (a)'), selected('test-e2e (b)')],
    gateExpected: [selected('changes'), selected('test-e2e'), selected('ci-capacity-receipts')] };
  const capture = { identity, executed: [ran('test-e2e (a)', 'success'), ran('test-e2e (b)', 'success')] };
  const needs = { changes: { result: 'success' }, 'test-e2e': { result: 'success' },
    'ci-capacity-receipts': { result: 'success' } };
  assert.equal(reconcileRun(manifest, capture, needs).ok, true);
  assert.equal(reconcileRun(manifest, { ...capture, identity: { ...identity, attempt: 3 } }, needs).ok, true);
  assert.equal(reconcileRun(manifest, { ...capture, identity: { ...identity, attempt: 1 } }, needs).ok, false);
  assert.equal(reconcileRun(manifest, capture, { changes: needs.changes }).ok, false);
  assert.equal(reconcileRun(manifest, { ...capture, executed: capture.executed.slice(0, 1) }, needs).ok, false);
  for (const key of Object.keys(identity)) {
    assert.equal(reconcileRun(manifest, { ...capture, identity: { ...identity, [key]: 'wrong' } }, needs).ok, false);
  }
  assert.equal(reconcileRun({}, capture).ok, false);
  assert.equal(reconcileRun(manifest, { ...capture, jobs: [{ name: 'wrong-run', run_id: 8, run_attempt: 2 }] }, needs).ok, false);
  assert.equal(workflow.jobs.changes.outputs.expected_attempt, '${{ steps.ci_expected.outputs.attempt }}');
});

test('should reject missing actual workflow members and always-required skipped validators', () => {
  for (const changes of [{ global: 'true' }, { api: 'true' }, { ui: 'true' }, {}]) {
    const expected = workflowExpected(workflow, { changes, event: 'pull_request', ref: 'refs/pull/705/merge' });
    const executed = expected.filter((item) => item.selected).map((item) => ran(item.job, 'success'));
    assert.equal(evaluateExpected({ expected, executed }).ok, true);
    for (const validator of ['validate-publishable-manifests', 'validate-ci-capacity-metrics']) {
      const skipped = executed.map((row) => row.job === validator ? ran(validator, 'skipped') : row);
      assert.equal(evaluateExpected({ expected, executed: skipped }).ok, false);
    }
    assert.equal(evaluateExpected({ expected, executed: [ran('changes', 'success')] }).ok, false);
    const member = executed.find((row) => row.job.startsWith('test-e2e ('));
    if (member) {
      assert.equal(evaluateExpected({ expected, executed: executed.filter((row) => row !== member) }).ok, false);
      assert.equal(evaluateExpected({ expected, executed: executed.map((row) => row === member ? ran(row.job, 'skipped') : row) }).ok, false);
    }
  }
  const main = workflowExpected(workflow, { changes: { global: 'true' }, event: 'push', ref: 'refs/heads/main' });
  assert.equal(main.find((row) => row.job === 'publish-api-image').selected, true);
  const observed = 'test-api-unit-integration (ai, chat-tools,company-enrichment-sync,documents-tool,initiative-gener...';
  assert.equal(main.some((row) => row.job === observed), true);
  assert.equal(evaluateExpected({ expected: [selected(observed)], executed: [ran(observed, 'success')] }).ok, true);
  assert.throws(() => workflowExpected({ jobs: { changes: {}, 'ci-gate': {},
    matrix: { strategy: { matrix: { include: [{ value: 'x'.repeat(110) }, { value: `${'x'.repeat(110)}y` }] } } },
  } }), /Ambiguous truncated matrix names/);
});

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

test('should derive selected expanded members before dispatch independently of received results', () => {
  const workflow = { jobs: {
    changes: {}, 'validate-publishable-manifests': { if: 'always() && !cancelled()' },
    'validate-ci-capacity-metrics': { if: 'always() && !cancelled()' },
    'test-e2e': { if: "needs.changes.outputs.global == 'true'", strategy: { matrix: { include: [
      { group: 'group-a', e2e_groups: '00 02' }, { group: 'group-b', e2e_groups: '01 04' },
    ] } } },
    'publish-api-image': { if: "github.ref == 'refs/heads/main'" },
    'ci-gate': {}, 'ci-capacity-receipts': {},
  } };
  const expected = workflowExpected(workflow, { changes: { global: 'true' }, ref: 'refs/pull/705/merge' });
  const names = expected.filter((row) => row.selected).map((row) => row.job);
  assert.deepEqual(names, ['changes', 'validate-publishable-manifests', 'validate-ci-capacity-metrics',
    'test-e2e (group-a, 00 02)', 'test-e2e (group-b, 01 04)']);
  assert.equal(expected.find((row) => row.job === 'publish-api-image').selected, false);
  assert.equal(evaluateExpected({ expected, executed: [ran('changes', 'success')] }).ok, false);
  const minimal = workflowExpected(workflow, { changes: {} });
  assert.equal(evaluateExpected({ expected: minimal, executed: [ran('changes', 'success'),
    ran('validate-publishable-manifests', 'skipped'), ran('validate-ci-capacity-metrics', 'skipped')] }).ok, false);
});

test('all-success selected sets pass', () => {
  const verdict = evaluateExpected({
    expected: [selected('build-api-image'), selected('ci-gate')],
    executed: [ran('build-api-image', 'success'), ran('ci-gate', 'success')],
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

test('should block failed or absent static and security lanes after browsers finish', () => {
  const expected = ['test-e2e', 'typecheck-lint-ui', 'security-sast-sca', 'security-container'].map(selected);
  const good = expected.map(row => ran(row.job, 'success'));
  for (const job of expected.slice(1).map(row => row.job)) {
    for (const conclusion of ['failure', 'skipped', 'cancelled', 'neutral', '']) {
      assert.equal(evaluateExpected({ expected, executed: good.map(row => row.job === job ? ran(job, conclusion) : row) }).ok, false);
    }
    assert.equal(evaluateExpected({ expected, executed: good.filter(row => row.job !== job) }).ok, false);
  }
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
