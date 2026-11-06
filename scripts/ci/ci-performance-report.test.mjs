import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { campaign, distribution, measureRun } from './ci-performance-report.mjs';
import { evaluateExpected, workflowExpected } from './ci-expected-results.mjs';

const stamp = seconds => new Date(Date.UTC(2026, 10, 6) + seconds * 1000).toISOString();
function fixture() {
  const names = ['changes', 'test-api-unit-integration (unit, 1)', 'ci-gate'];
  return { run: { id: 10, run_attempt: 1, head_sha: 'abc', head_branch: 'example', event: 'pull_request',
    status: 'completed', conclusion: 'success', created_at: stamp(0), updated_at: stamp(600) },
    manifest: { identity: { runId: 10, attempt: 1, headSha: 'abc' },
      expected: names.map(job => ({ job, selected: true, required: true })),
      dependencies: { changes: [], 'test-api-unit-integration': ['changes'], 'ci-gate': ['test-api-unit-integration'] } },
    records: names.map((name, i) => ({ name, runId: 10, attempt: 1, jobId: i + 1,
      status: 'completed', conclusion: 'success', dispatched: true,
      queuedAt: stamp(i * 100), startedAt: stamp(i * 100 + 2), completedAt: stamp(i * 100 + 90) })) };
}

test('should calculate nearest-rank distributions without hiding maxima or inventing missing data', () => {
  assert.deepEqual(distribution([null, NaN, -1]), { n: 0, median: null, p90: null, p95: null, maximum: null });
  assert.deepEqual(distribution(Array.from({ length: 20 }, (_, i) => i + 1)),
    { n: 20, median: 10, p90: 18, p95: 19, maximum: 20 });
});

test('should retain full workflow wall time separately from qualification and queue', () => {
  const row = measureRun(fixture());
  assert.equal(row.wallSeconds, 600);
  assert.equal(row.qualificationSeconds, 290);
  assert.equal(row.gapSeconds, 0);
  assert.equal(row.qualified, true);
  assert.equal(row.jobs[0].queueSeconds, 2);
  assert.equal(row.criticalPaths.qualification.seconds, 26);
  assert.equal(row.endpoints.packages.status, 'unselected');
  assert.equal(row.fullProduct, false);
});

test('should expose breaches and refuse missing jobs, manifests, cross-head receipts and reruns', () => {
  const breach = fixture(); breach.run.updated_at = stamp(601);
  assert.equal(measureRun(breach).gapSeconds, 1);
  for (const change of [f => f.records.pop(), f => delete f.manifest,
    f => { f.manifest.identity.headSha = 'different'; }, f => { f.run.run_attempt = 2; },
    f => { f.records[1].dispatched = false; }, f => { f.records[1].completedAt = null; }]) {
    const capture = fixture(); change(capture);
    assert.equal(measureRun(capture).qualified, false);
    assert.equal(campaign([capture]).accepted, false);
  }
  assert.throws(() => campaign([breach, breach]), /Duplicate/);
});

test('should preserve failed, cancelled, unexpectedly skipped and in-progress runs without success credit', () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
    const capture = fixture(); capture.records[1].conclusion = conclusion;
    assert.equal(measureRun(capture).qualified, false);
    assert.equal(campaign([capture]).count, 1);
    assert.equal(campaign([capture]).distribution.n, 0);
  }
  const pending = fixture(); pending.run.status = 'in_progress';
  assert.equal(measureRun(pending).wallSeconds, null);
  assert.equal(campaign([fixture()]).accepted, false, 'one library-only run is never a campaign');
});

test('should include selected package publication and preproduction after the qualification endpoint', () => {
  const capture = fixture();
  for (const [i, name] of ['publish-cluster-mesh', 'deploy-preprod'].entries()) {
    capture.manifest.expected.push({ job: name, selected: true });
    capture.records.push({ ...capture.records[2], jobId: i + 20, name, startedAt: stamp(300), completedAt: stamp(620) });
  }
  capture.run.updated_at = stamp(630);
  const row = measureRun(capture);
  assert.equal(row.endpoints.packages.elapsedSeconds, 620);
  assert.equal(row.endpoints.preproduction.elapsedSeconds, 620);
  assert.equal(row.gapSeconds, 30);
  capture.records.at(-1).conclusion = 'failure';
  assert.equal(measureRun(capture).endpoints.preproduction.elapsedSeconds, null);
});

test('should retain every API shard and all artifact lanes in the actual workflow verdict', () => {
  const YAML = createRequire(path.join(process.env.CI_EXPECTED_TOOL_DIR, 'package.json'))('yaml');
  const workflow = YAML.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
  const matrix = workflow.jobs['test-api-unit-integration'].strategy.matrix.include;
  assert.deepEqual(matrix.filter(row => row.suite === 'unit').map(row => row.unit_shard), [1, 2, 3, 4]);
  assert.deepEqual(matrix.filter(row => row.suite === 'endpoints').map(row => row.endpoints_shard), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(matrix.filter(row => row.suite === 'app-cluster-mesh').map(row => row.app_shard), [1, 2]);
  const expected = workflowExpected(workflow, { changes: { global: 'true' }, event: 'pull_request' });
  const executed = expected.filter(row => row.selected).map(row => ({ job: row.job, conclusion: 'success' }));
  for (const row of expected.filter(row => /^(test-api-unit-integration|test-api-sut|artifacts-qualification) \(/.test(row.job))) {
    assert.equal(row.selected, true);
    assert.equal(evaluateExpected({ expected, executed: executed.filter(item => item.job !== row.job) }).ok, false);
  }
});

test('should fail the delivered proof CLI when a short run lacks the campaign evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br84-'));
  try {
    const input = path.join(dir, 'runs.json');
    fs.writeFileSync(input, JSON.stringify({ runs: [fixture()] }));
    const cli = spawnSync(process.execPath, ['scripts/ci/ci-performance-report.mjs',
      '--input', input, '--json', '--require-proof'], { encoding: 'utf8' });
    assert.equal(cli.status, 1, cli.stderr);
    const result = JSON.parse(cli.stdout);
    assert.equal(result.accepted, false);
    assert.equal(result.after.n, 0);
    assert.equal(result.before.n, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('should expose active workflow and ready-queue lower bounds without treating placeholder starts as execution', () => {
  const capture = fixture();
  capture.run.status = 'queued'; capture.run.conclusion = null; capture.capturedAt = stamp(900);
  capture.records[1] = { ...capture.records[1], status: 'queued', conclusion: null,
    dispatched: false, startedAt: stamp(100), completedAt: null };
  const row = measureRun(capture);
  assert.equal(row.wallSeconds, null);
  assert.equal(row.elapsedLowerBoundSeconds, 900);
  assert.equal(row.gapLowerBoundSeconds, 300);
  assert.equal(row.jobs[1].queueSeconds, null);
  assert.equal(row.jobs[1].queueLowerBoundSeconds, 800);
  assert.equal(row.jobs[1].seconds, null);
  assert.equal(row.qualified, false);
});
