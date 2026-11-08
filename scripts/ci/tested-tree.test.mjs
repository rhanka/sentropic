// Tested-tree shortcut (BR92-EX1): a main push skips test members only with
// identified same-tree PR evidence; every other case keeps the complete run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { evaluateSelection, policyDigest, qualifiedSelection, reconcileRun, workflowExpected } from './ci-expected-results.mjs';
import { assessTestedTree, qualificationProblems } from './tested-tree.mjs';

const YAML = createRequire(path.join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const tree = 'c'.repeat(40);
const mainSha = 'a'.repeat(40);
const prSha = 'b'.repeat(40);
const repository = 'rhanka/sentropic';
const skip = "needs.changes.outputs.tested_tree != 'true'";
const mini = { jobs: {
  changes: {},
  unit: { needs: ['changes'], if: `${skip} && needs.changes.outputs.api == 'true'`,
    strategy: { matrix: { include: [{ shard: 1 }, { shard: 2 }] } } },
  build: { needs: ['changes'] },
  publish: { needs: ['changes', 'build', 'unit'], if: "!cancelled() && github.ref == 'refs/heads/main' && needs.build.result == 'success' && (needs.changes.outputs.tested_tree == 'true' || needs.unit.result == 'success')" },
  'ci-gate': { needs: ['changes', 'unit', 'build'], if: 'always()' },
} };
const main = (changes = { api: 'true' }) => ({ changes, event: 'push', ref: 'refs/heads/main',
  identity: { runId: '900', attempt: '1', headSha: mainSha, tree } });
const prRun = (overrides = {}) => ({ id: 800, run_attempt: 1, event: 'pull_request', status: 'completed',
  conclusion: 'success', workflow_id: 77, path: '.github/workflows/ci.yml', head_sha: prSha, head_branch: 'topic',
  html_url: 'https://github.com/rhanka/sentropic/actions/runs/800', tree_id: tree,
  head_repository: repository, repository, ...overrides });
const prJobs = names => names.map((name, index) => ({ id: 100 + index, name, status: 'completed', conclusion: 'success',
  run_id: 800, run_attempt: 1, html_url: `https://github.com/rhanka/sentropic/actions/runs/800/job/${100 + index}` }));
const prManifest = (workflow, changes) => ({ identity: { runId: '800', attempt: '1', headSha: prSha, tree },
  policyDigest: policyDigest(workflow),
  expected: workflowExpected(workflow, { changes, event: 'pull_request', ref: 'refs/pull/5/merge' }) });
const evidence = (overrides = {}) => ({ tree, sha: mainSha, repository, workflowId: 77,
  candidates: [prRun()], run: prRun(), jobs: prJobs(['changes', 'unit (1)', 'unit (2)', 'build', 'ci-gate']),
  expected: prManifest(mini, { api: 'true', tested_tree: 'false' }), ...overrides });
const reason = (input, workflow = mini, context = main()) => qualifiedSelection(workflow, context, input).qualification.reason;

test('should skip test members with run evidence when the merge tree equals a green PR run tree', () => {
  const { qualification, expected } = qualifiedSelection(mini, main(), evidence());
  assert.equal(qualification.mode, 'tested-tree');
  assert.equal(qualification.runId, 800);
  assert.equal(qualification.tree, tree);
  assert.equal(qualification.url, 'https://github.com/rhanka/sentropic/actions/runs/800');
  assert.deepEqual(qualification.satisfied.map(row => [row.job, row.url]), [
    ['unit (1)', 'https://github.com/rhanka/sentropic/actions/runs/800/job/101'],
    ['unit (2)', 'https://github.com/rhanka/sentropic/actions/runs/800/job/102']]);
  const row = name => expected.find(item => item.job === name);
  assert.deepEqual(row('unit (1)'), { job: 'unit (1)', required: true, selected: false, satisfiedBy: 800 });
  assert.equal(row('build').selected, true);
  assert.equal(row('publish').selected, true, 'delivery still runs on the qualified tree');
  const manifest = { identity: main().identity, qualification, expected, gateExpected: [] };
  const executed = [{ job: 'changes', conclusion: 'success' }, { job: 'build', conclusion: 'success' },
    { job: 'publish', conclusion: 'success' }, { job: 'unit (1)', conclusion: 'skipped' }];
  const verdict = reconcileRun(manifest, { identity: main().identity, executed });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.failures));
  assert.deepEqual(verdict.satisfied, [{ job: 'unit (1)', satisfiedBy: 800 }, { job: 'unit (2)', satisfiedBy: 800 }]);
  assert.equal(verdict.qualification.runId, 800);
});

test('should reject a satisfied member that executed and failed, or one without a tested-tree reference', () => {
  const { qualification, expected } = qualifiedSelection(mini, main(), evidence());
  const manifest = { identity: main().identity, qualification, expected };
  const identity = main().identity;
  const failed = reconcileRun(manifest, { identity, executed: [{ job: 'changes', conclusion: 'success' }, { job: 'build', conclusion: 'success' },
    { job: 'publish', conclusion: 'success' }, { job: 'unit (1)', conclusion: 'failure' }] });
  assert.deepEqual(failed.failures.map(row => row.reason), ['satisfied-member-executed']);
  const executed = [{ job: 'changes', conclusion: 'success' }, { job: 'build', conclusion: 'success' },
    { job: 'publish', conclusion: 'success' }];
  assert.equal(reconcileRun(manifest, { identity, executed }).ok, true);
  for (const [forged, pattern] of [[{ mode: 'in-run' }, /unqualified-satisfied-member/],
    [{ ...qualification, runId: 801 }, /unqualified-satisfied-member/], [{ ...qualification, runId: 900 }, /own run/],
    [{ ...qualification, tree: 'not-a-tree' }, /without a tree/], [{ mode: 'cached' }, /unknown qualification mode/]]) {
    const verdict = reconcileRun({ ...manifest, qualification: forged }, { identity, executed });
    assert.equal(verdict.ok, false, JSON.stringify(forged));
    assert.match(verdict.failures.map(row => row.reason).join('\n'), pattern, JSON.stringify(forged));
  }
});

test('should run everything when the tree differs, the run is a fork, failed, or the capture erred', () => {
  const full = qualifiedSelection(mini, main(), null);
  assert.equal(full.qualification.reason, 'no-evidence');
  assert.equal(full.expected.find(row => row.job === 'unit (1)').selected, true);
  const other = prRun({ tree_id: 'd'.repeat(40) });
  assert.equal(reason(evidence({ candidates: [other], run: other })), 'no-tested-run');
  const fork = prRun({ head_repository: 'someone/sentropic' });
  assert.equal(reason(evidence({ candidates: [fork], run: fork })), 'no-same-repository-run');
  assert.equal(reason(evidence({ run: prRun({ head_repository: 'someone/sentropic' }) })), 'foreign-repository');
  assert.equal(reason(evidence({ run: prRun({ conclusion: 'failure' }) })), 'run-completed-failure');
  assert.equal(reason(evidence({ run: prRun({ status: 'in_progress', conclusion: null }) })), 'run-in_progress-null');
  const newest = prRun({ id: 805, conclusion: 'failure' });
  assert.equal(reason(evidence({ candidates: [prRun(), newest] })), 'evidence-not-newest-run', 'a newer red run wins');
  assert.equal(reason(evidence({ error: 'HTTP 502' })), 'capture-error: HTTP 502');
  assert.match(reason(evidence({ candidates: { broken: true } })), /^assessment-error: /);
  for (const input of [null, evidence({ error: 'HTTP 502' }), evidence({ run: prRun({ conclusion: 'failure' }) })]) {
    const { expected } = qualifiedSelection(mini, main(), input);
    assert.deepEqual(expected, workflowExpected(mini, { ...main(), changes: { api: 'true', tested_tree: 'false' } }));
  }
});

test('should keep the complete run without a green gate, expected set, workflow policy or coverage', () => {
  const red = prJobs(['changes', 'unit (1)', 'unit (2)', 'build', 'ci-gate']);
  red[4].conclusion = 'failure';
  assert.equal(reason(evidence({ jobs: red })), 'ci-gate-not-success');
  const failedMember = prJobs(['changes', 'unit (1)', 'unit (2)', 'build', 'ci-gate']);
  failedMember[2].conclusion = 'cancelled';
  assert.equal(reason(evidence({ jobs: failedMember })), 'expected-result-not-success: unit (2)');
  assert.equal(reason(evidence({ expected: null })), 'missing-expected-set');
  assert.equal(reason(evidence({ expected: { ...prManifest(mini, { api: 'true' }), policyDigest: 'f'.repeat(64) } })),
    'policy-digest-mismatch');
  assert.equal(reason(evidence({ expected: { ...prManifest(mini, { api: 'true' }), identity: { runId: '799', headSha: prSha, tree } } })),
    'expected-set-identity-mismatch');
  // A PR whose merge ref (another base, a stale base) checked out a different tree.
  assert.equal(reason(evidence({ expected: { ...prManifest(mini, { api: 'true' }),
    identity: { runId: '800', attempt: '1', headSha: prSha, tree: 'd'.repeat(40) } } })), 'tested-tree-mismatch');
  assert.equal(reason(evidence({ expected: { ...prManifest(mini, { api: 'true' }),
    identity: { runId: '800', attempt: '1', headSha: prSha } } })), 'tested-tree-mismatch');
  assert.equal(reason(evidence(), mini, { ...main(), identity: { ...main().identity, tree: 'd'.repeat(40) } }),
    'source-tree-mismatch');
  assert.equal(reason(evidence({ run: prRun({ path: '.github/workflows/other.yml' }) })), 'foreign-workflow');
  assert.equal(reason(evidence({ jobs: prJobs(['changes', 'build', 'ci-gate']).map(job => ({ ...job, run_attempt: 2 })) })),
    'job-identity-mismatch');
  // The PR run legitimately skipped the unit shards: nothing proves them.
  assert.equal(reason(evidence({ jobs: prJobs(['changes', 'build', 'ci-gate']),
    expected: prManifest(mini, { api: 'false' }) })), 'coverage-gap: unit (1)');
  assert.equal(reason(evidence(), mini, { ...main(), event: 'pull_request', ref: 'refs/pull/5/merge' }), 'not-a-main-push');
  assert.equal(reason(evidence({ sha: prSha })), 'source-mismatch');
  assert.equal(reason(evidence({ tree: 'HEAD' })), 'invalid-tree');
  assert.equal(reason(evidence(), mini, { ...main(), identity: { ...main().identity, runId: '800' } }), 'self-reference');
});

test('should validate a recorded qualification reference for every receipt consumer', () => {
  assert.deepEqual(qualificationProblems(undefined), []);
  assert.deepEqual(qualificationProblems({ mode: 'in-run' }), []);
  assert.deepEqual(qualificationProblems({ mode: 'tested-tree', runId: 800, tree }, { runId: 900, tree }), []);
  assert.equal(qualificationProblems({ mode: 'tested-tree', runId: 'x', tree }).length, 1);
  assert.equal(qualificationProblems({ mode: 'tested-tree', runId: 900, tree }, { runId: '900' }).length, 1);
  assert.equal(qualificationProblems({ mode: 'tested-tree', runId: 800, tree }, { tree: 'd'.repeat(40) }).length, 1);
  assert.equal(qualificationProblems({ mode: 'replayed' }).length, 1);
  assert.equal(assessTestedTree({}).mode, 'in-run');
});

test('should skip only test members of the real workflow and keep build, publication and preproduction', () => {
  const changes = Object.fromEntries(Object.keys(ci.jobs.changes.outputs).map(key =>
    [key, ['engram_e2', 'tested_tree'].includes(key) ? 'false' : 'true']));
  const context = main(changes);
  const full = workflowExpected(ci, context);
  const executedNames = full.filter(row => row.selected).map(row => row.job);
  const realJobs = prJobs([...executedNames, 'ci-gate']);
  const expected = { identity: { runId: '800', attempt: '1', headSha: prSha, tree }, policyDigest: policyDigest(ci),
    expected: full.filter(row => !['publish-', 'deploy-', 'release-', 'retain-', 'api-tool-registry']
      .some(prefix => row.job.startsWith(prefix))) };
  const result = qualifiedSelection(ci, context, evidence({ jobs: realJobs, expected }));
  assert.equal(result.qualification.mode, 'tested-tree', result.qualification.reason);
  const selected = new Set(result.expected.filter(row => row.selected).map(row => row.job.replace(/ \(.*$/, '')));
  for (const name of ['changes', 'build-api-image', 'build-api-tool-image', 'build-ui', 'build-ui-static', 'build-e2e',
    'build-desktop', 'package-candidates', 'api-image-guards', 'publish-api-image', 'publish-ui-image',
    'publish-llm-mesh', 'publish-cluster-mesh', 'publish-chat-core', 'publish-mcp-auth', 'release-receipts',
    'deploy-preprod', 'retain-daily-identities', 'api-tool-registry-publish', 'validate-publishable-manifests',
    'validate-ci-capacity-metrics', 'verify-train-lock-integrity']) {
    assert.ok(selected.has(name), `${name} must still run on a tested tree`);
  }
  for (const name of ['test-e2e', 'test-api-unit-integration', 'test-api-sut', 'test-api-ai', 'e2e-vscode', 'test-ui',
    'smoke-idp-screens', 'test-smoke-restore', 'typecheck-lint-ui', 'typecheck-lint-api', 'api-static',
    'security-container', 'security-sast-sca', 'security-iac', 'validate-llm-mesh', 'validate-cluster-mesh',
    'validate-chat-core', 'artifacts-qualification', 'consumer-contracts', 'memory-l5-qualification']) {
    assert.ok(!selected.has(name), `${name} is satisfied by the PR run`);
  }
  const satisfied = result.expected.filter(row => row.satisfiedBy === 800).map(row => row.job);
  assert.deepEqual(satisfied, result.qualification.satisfied.map(row => row.job));
  assert.ok(satisfied.includes('test-e2e (1)') && satisfied.some(job => job.startsWith('test-api-unit-integration (')));
  // Removing one PR member (or one PR job) keeps the complete real run.
  const gap = realJobs.filter(job => job.name !== 'test-e2e (3)');
  const kept = qualifiedSelection(ci, context, evidence({ jobs: gap, expected: { ...expected,
    expected: expected.expected.filter(row => row.job !== 'test-e2e (3)') } }));
  assert.equal(kept.qualification.reason, 'coverage-gap: test-e2e (3)');
  assert.deepEqual(kept.expected, full);
});

// Publishers: a skipped test barrier counts only on a tested tree; builds,
// image guards and candidates gate in every mode; a failed member never passes.
test('should publish a tested tree only from successful builds and never past a failed barrier', () => {
  const builds = new Set(['changes', 'build-api-image', 'build-e2e', 'build-ui', 'build-ui-static', 'api-image-guards',
    'package-candidates', 'publish-llm-mesh', 'publish-llm-gateway', 'publish-oauth-verify', 'publish-mcp-platform',
    'publish-events', 'publish-contracts', 'publish-artifacts']);
  const dispatch = (name, testedTree, overrides = {}) => evaluateSelection(ci.jobs[name].if, key => {
    if (key === 'github.ref') return 'refs/heads/main';
    if (key === 'needs.changes.outputs.tested_tree') return testedTree;
    if (key.startsWith('needs.changes.outputs.')) return 'true';
    if (key.startsWith('inputs.')) return 'none';
    const parent = key.match(/^needs\.([\w-]+)\.result$/)?.[1];
    if (parent) return overrides[parent] ?? (builds.has(parent) ? 'success' : 'skipped');
    throw Error(`Unknown publisher context: ${key}`);
  });
  for (const name of ['publish-api-image', 'publish-ui-image', 'publish-llm-mesh', 'publish-cluster-mesh',
    'publish-chat-core', 'publish-mcp-auth', 'publish-artifacts']) {
    assert.equal(dispatch(name, 'true'), true, `${name}: tested tree publishes`);
    assert.equal(dispatch(name, 'false'), false, `${name}: skipped tests without evidence never publish`);
    assert.equal(dispatch(name, ''), false, `${name}: a missing decision never publishes`);
    for (const parent of ci.jobs[name].needs.filter(parent => !['changes', 'publish-oauth-verify'].includes(parent))) {
      for (const result of ['failure', 'cancelled']) {
        assert.equal(dispatch(name, 'true', { [parent]: result }), false, `${name}: ${parent}=${result}`);
      }
    }
  }
  for (const name of ['publish-api-image', 'publish-ui-image']) {
    for (const parent of ['build-api-image', 'build-e2e', 'build-ui', 'api-image-guards']
      .filter(parent => ci.jobs[name].needs.includes(parent))) {
      assert.equal(dispatch(name, 'true', { [parent]: 'skipped' }), false, `${name}: ${parent} skipped`);
    }
  }
  assert.equal(dispatch('publish-llm-mesh', 'true', { 'package-candidates': 'skipped' }), false);
});
