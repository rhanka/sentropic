// ci-run-metrics fixtures (make test-ci-run-metrics).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  admissionDecision,
  budgetVerdict,
  cacheIdentities,
  cancellationOwnership,
  captureRecords,
  concurrencyPeak,
  releaseContinuity,
  dedupeJobs,
  deliveryElapsed,
  durationSeconds,
  endpointReadiness,
  isTimestampGap,
  overlappingSeconds,
  queueSeconds,
  queueWaits,
  runnerMinutes,
  stepSpans,
  summarizeRun,
  toMs,
} from './ci-run-metrics.mjs';

const job = (overrides = {}) => ({
  runId: 1,
  attempt: 1,
  jobId: 10,
  name: 'build-api-image',
  conclusion: 'success',
  startedAt: '2026-10-18T10:00:00.000Z',
  completedAt: '2026-10-18T10:03:44.000Z',
  ...overrides,
});

test('should retain Jobs API identities and step timestamps without inventing readiness', () => {
  const [record] = captureRecords({ run: { id: 7 }, jobs: [{ run_id: 7, run_attempt: 2,
    id: 11, name: 'changes', conclusion: 'success', started_at: '2026-10-18T10:00:00Z',
    completed_at: '2026-10-18T10:01:00Z', steps: [{ name: 'Test', number: 3,
      started_at: '2026-10-18T10:00:01Z', completed_at: '2026-10-18T10:00:59Z' }] }] });
  assert.deepEqual([record.runId, record.attempt, record.jobId], [7, 2, 11]);
  assert.equal(queueSeconds(record), null);
  assert.equal(stepSpans(record)[0].seconds, 58);
  assert.throws(() => captureRecords({}), /Missing run\/jobs/);
});

test('durations are completion minus start; missing values stay null, never zero', () => {
  assert.equal(durationSeconds('2026-10-18T10:00:00.000Z', '2026-10-18T10:03:44.000Z'), 224);
  assert.equal(durationSeconds(job().startedAt, null), null);
  assert.equal(durationSeconds(null, job().completedAt), null);
  assert.equal(durationSeconds('not-a-date', job().completedAt), null);
  assert.equal(toMs(null), null);
});

test('timestamp gaps cover one-sided stamps and inverted intervals', () => {
  assert.equal(isTimestampGap(job({ startedAt: null })), true);
  assert.equal(isTimestampGap(job({ completedAt: null })), true);
  assert.equal(
    isTimestampGap(job({ startedAt: '2026-10-18T10:05:00.000Z', completedAt: '2026-10-18T10:00:00.000Z' })),
    true,
  );
  assert.equal(isTimestampGap(job()), false);
  assert.equal(isTimestampGap(job({ startedAt: null, completedAt: null, conclusion: 'skipped' })), false);
});

test('overlapping PR/main branches report shared execution time', () => {
  const pr = [job({ runId: 100, startedAt: '2026-10-18T10:00:00.000Z', completedAt: '2026-10-18T10:10:00.000Z' })];
  const main = [job({ runId: 200, startedAt: '2026-10-18T10:05:00.000Z', completedAt: '2026-10-18T10:15:00.000Z' })];
  assert.equal(overlappingSeconds(pr, main), 300);
  assert.equal(overlappingSeconds(pr, []), null);
});

test('contention windows ignore skipped and unmeasurable rows', () => {
  const pr = [job({ runId: 100, startedAt: '2026-10-18T10:00:00.000Z', completedAt: '2026-10-18T10:10:00.000Z' })];
  const main = [
    job({ runId: 200, startedAt: '2026-10-18T10:05:00.000Z', completedAt: '2026-10-18T10:15:00.000Z' }),
    job({ runId: 200, jobId: 21, conclusion: 'skipped',
      startedAt: '2026-10-18T12:00:00.000Z', completedAt: '2026-10-18T12:00:00.000Z' }),
    job({ runId: 200, jobId: 22, startedAt: '2026-10-18T10:20:00.000Z', completedAt: '2026-10-18T10:10:00.000Z' }),
    job({ runId: 200, jobId: 23, startedAt: null, completedAt: '2026-10-18T10:15:00.000Z' }),
  ];
  assert.equal(overlappingSeconds(pr, main), 300);
  assert.equal(overlappingSeconds(pr, [main[1]]), null);
});

test('reruns do not double-count carried-forward jobs', () => {
  const first = job({ runId: 7, attempt: 1, jobId: 11 });
  const carried = job({ runId: 7, attempt: 2, jobId: 11 });
  // A distinct execution carries a distinct name (matrix members and jobs
  // never share a name); the same name with the same interval is one
  // execution even under a new job ID.
  const fresh = job({ runId: 7, attempt: 2, jobId: 12, name: 'build-ui-image' });
  const { jobs, dropped } = dedupeJobs([first, carried, fresh]);
  assert.equal(jobs.length, 2);
  assert.equal(dropped, 1);
  assert.deepEqual(
    jobs.map((row) => row.jobId).sort(),
    [11, 12],
  );
  assert.equal(jobs.find((row) => row.jobId === 11).attempt, 2);
});

test('partial runs and skipped rows are reported without invented spans', () => {
  const summary = summarizeRun(
    [job({ jobId: 1 }), job({ jobId: 2, conclusion: 'skipped', startedAt: null, completedAt: null }), job({ jobId: 3, completedAt: null })],
    { expectedJobCount: 66 },
  );
  assert.equal(summary.jobs, 3);
  assert.equal(summary.measured, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.unmeasured, 1);
  assert.equal(summary.timestampGaps, 1);
  assert.equal(summary.partial, true);
  assert.equal(summary.maxJobSeconds, 224);
});

test('concurrency peak counts overlapping measurable jobs only', () => {
  const records = [
    job({ jobId: 1, startedAt: '2026-10-18T10:00:00.000Z', completedAt: '2026-10-18T10:10:00.000Z' }),
    job({ jobId: 2, startedAt: '2026-10-18T10:05:00.000Z', completedAt: '2026-10-18T10:15:00.000Z' }),
    job({ jobId: 3, startedAt: '2026-10-18T10:20:00.000Z', completedAt: '2026-10-18T10:25:00.000Z' }),
    job({ jobId: 4, startedAt: null, completedAt: null }),
  ];
  assert.equal(concurrencyPeak(records), 2);
});

test('carried-forward copies under new job IDs count once; fresh intervals count separately', () => {
  // Reference run 39113919235: `changes` is job 117635669586 in attempt 1 and
  // job 117665333718 in attempt 2 with the same 09:04:44Z-09:04:52Z interval.
  const first = job({
    runId: 39113919235,
    attempt: 1,
    jobId: 117635669586,
    name: 'changes',
    startedAt: '2026-10-18T09:04:44.000Z',
    completedAt: '2026-10-18T09:04:52.000Z',
  });
  const carried = job({
    runId: 39113919235,
    attempt: 2,
    jobId: 117665333718,
    name: 'changes',
    startedAt: '2026-10-18T09:04:44.000Z',
    completedAt: '2026-10-18T09:04:52.000Z',
  });
  const fresh = job({
    runId: 39113919235,
    attempt: 2,
    jobId: 117665333719,
    name: 'changes',
    startedAt: '2026-10-18T11:38:20.000Z',
    completedAt: '2026-10-18T11:38:28.000Z',
  });
  const { jobs, dropped } = dedupeJobs([first, carried, fresh]);
  assert.equal(jobs.length, 2);
  assert.equal(dropped, 1);
});

test('skipped rows and shared start/end boundaries do not inflate the peak', () => {
  const sixty = job({ jobId: 1, startedAt: '2026-10-18T10:00:00.000Z', completedAt: '2026-10-18T10:01:00.000Z' });
  const skippedAtEnd = job({
    jobId: 2,
    conclusion: 'skipped',
    startedAt: '2026-10-18T10:01:00.000Z',
    completedAt: '2026-10-18T10:01:00.000Z',
  });
  assert.equal(concurrencyPeak([sixty, skippedAtEnd]), 1);
  const first = job({ jobId: 3, startedAt: '2026-10-18T10:00:00.000Z', completedAt: '2026-10-18T10:01:00.000Z' });
  const second = job({ jobId: 4, startedAt: '2026-10-18T10:01:00.000Z', completedAt: '2026-10-18T10:02:00.000Z' });
  assert.equal(concurrencyPeak([first, second]), 1);
});

test('queue waits require job readiness and never substitute workflow age', () => {
  assert.equal(queueSeconds(job({ queuedAt: '2026-10-18T09:59:50.000Z' }), null), 10);
  assert.equal(
    queueSeconds(job({ queuedAt: undefined }), '2026-10-18T09:59:00.000Z'),
    null,
  );
  assert.equal(queueSeconds(job({ startedAt: null }), '2026-10-18T09:59:00.000Z'), null);
  assert.equal(
    queueSeconds(job({ queuedAt: '2026-10-18T10:01:00.000Z' }), null),
    null,
  );
  const waits = queueWaits(
    [job({ queuedAt: '2026-10-18T09:59:50.000Z' }), job({ queuedAt: '2026-10-18T09:59:00.000Z' })],
    null,
  );
  assert.deepEqual([waits.count, waits.minSeconds, waits.p50Seconds, waits.maxSeconds], [2, 10, 60, 60]);
});

test('should exclude timestamped skipped rows from execution queue statistics', () => {
  const executed = job({ queuedAt: '2026-10-18T09:58:57.000Z' });
  const skipped = job({ conclusion: 'skipped', queuedAt: executed.startedAt });
  assert.equal(queueSeconds(skipped), null);
  const waits = queueWaits([executed, skipped, skipped]);
  assert.equal(waits.count, 1);
  assert.equal(waits.p50Seconds, 63);
  const late = job({ startedAt: '2026-10-18T10:11:00Z' });
  assert.equal(queueSeconds(late, '2026-10-18T10:00:00Z'), null);
  assert.equal(queueSeconds({ ...late, queuedAt: '2026-10-18T10:10:00Z' }), 60);
});

test('step spans report per-step durations without invention', () => {
  const spans = stepSpans(
    job({
      steps: [
        { name: 'Set up job', conclusion: 'success', startedAt: '2026-10-18T09:04:45.000Z', completedAt: '2026-10-18T09:04:46.000Z' },
        { name: 'Pending', conclusion: null, startedAt: null, completedAt: null },
      ],
    }),
  );
  assert.equal(spans[0].seconds, 1);
  assert.equal(spans[1].seconds, null);
  assert.deepEqual(stepSpans(job({ steps: undefined })), []);
});

test('should emit identified job and step measurements through the delivered CLI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-metrics-'));
  try {
    const file = path.join(dir, 'capture.json');
    const record = job({ steps: [{ name: 'Test', conclusion: 'success',
      startedAt: '2026-10-18T10:00:00Z', completedAt: '2026-10-18T10:00:58Z' }] });
    fs.writeFileSync(file, JSON.stringify({ records: [record], sourceSha: 'source', workflowSha: 'workflow' }));
    const cli = spawnSync(process.execPath, ['scripts/ci/ci-run-metrics.mjs', '--run-file', file], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const [execution] = JSON.parse(cli.stdout).executions;
    assert.deepEqual(JSON.parse(cli.stdout).identity, { sourceSha: 'source', workflowSha: 'workflow' });
    assert.equal(execution.runId, 1);
    assert.equal(execution.attempt, 1);
    assert.equal(execution.jobId, 10);
    assert.equal(execution.seconds, 224);
    assert.equal(execution.queueSeconds, null);
    assert.equal(execution.steps[0].name, 'Test');
    assert.equal(execution.steps[0].seconds, 58);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('should emit capacity receipts through the delivered CLI when inputs exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-metrics-'));
  try {
    const file = path.join(dir, 'capture.json');
    fs.writeFileSync(file, JSON.stringify({ records: [job()], sourceSha: 'source', workflowSha: 'workflow',
      endpoints: { images: ['build-api-image'] },
      capacity: { availableSlots: 24, reserveSlots: 2 },
      timings: { classificationSeconds: 8, verdictSeconds: 12 } }));
    const cli = spawnSync(process.execPath, ['scripts/ci/ci-run-metrics.mjs', '--run-file', file], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const out = JSON.parse(cli.stdout);
    assert.equal(out.admission.status, 'admitted');
    assert.equal(out.admission.headroom, 21);
    assert.equal(out.budgets.budgets.classificationSeconds.status, 'pass');
    assert.equal(out.budgets.budgets.verdictSeconds.status, 'breach');
    assert.equal(out.cancellation.cancelledCount, 0);
    assert.equal(out.continuity.continuous, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runner-minutes group executed spans and ignore skipped rows', () => {
  const minutes = runnerMinutes([
    job({ runnerName: 'GitHub Actions 1', startedAt: '2026-10-18T10:00:00.000Z', completedAt: '2026-10-18T10:01:00.000Z' }),
    job({ jobId: 2, runnerName: 'GitHub Actions 1', conclusion: 'skipped', startedAt: '2026-10-18T10:00:00.000Z', completedAt: '2026-10-18T10:00:00.000Z' }),
    job({ jobId: 3, labels: ['ubuntu-latest'], startedAt: '2026-10-18T10:00:00.000Z', completedAt: '2026-10-18T10:02:00.000Z' }),
  ]);
  assert.equal(minutes.totalMinutes, 3);
  assert.equal(minutes.byRunner['GitHub Actions 1'], 1);
  assert.equal(minutes.byRunner['ubuntu-latest'], 2);
});

test('delivery elapsed needs every endpoint member measured', () => {
  const records = [
    job({ name: 'publish-api-image', startedAt: '2026-10-18T10:00:00.000Z', completedAt: '2026-10-18T10:03:44.000Z' }),
  ];
  const base = '2026-10-18T10:00:00.000Z';
  const full = deliveryElapsed(records, base, { images: ['publish-api-image'] });
  assert.equal(full.images.elapsedSeconds, 224);
  const incomplete = deliveryElapsed(records, base, { images: ['publish-api-image', 'publish-ui-image'] });
  assert.equal(incomplete.images.elapsedSeconds, null);
  const unmeasured = deliveryElapsed(
    [job({ name: 'publish-api-image', completedAt: null })],
    base,
    { images: ['publish-api-image'] },
  );
  assert.equal(unmeasured.images.elapsedSeconds, null);
});

test('should leave skipped delivery endpoints unmeasured for zero and inverted intervals', () => {
  const base = '2026-10-19T01:47:28Z';
  const stamp = '2026-10-19T02:10:23Z';
  const endpoints = { images: ['publish-api-image', 'publish-ui-image'], preproduction: ['deploy-preprod'] };
  for (const completedAt of [stamp, '2026-10-19T02:10:22Z']) {
    const records = ['publish-api-image', 'publish-ui-image', 'deploy-preprod'].map((name) =>
      job({ name, conclusion: 'skipped', startedAt: stamp, completedAt }));
    const readiness = endpointReadiness(records, endpoints);
    const elapsed = deliveryElapsed(records, base, endpoints);
    for (const endpoint of Object.keys(endpoints)) {
      assert.equal(readiness[endpoint].status, 'unselected');
      assert.equal(elapsed[endpoint].elapsedSeconds, null);
    }
    records[0] = job({ name: 'publish-api-image', startedAt: stamp, completedAt: stamp });
    assert.equal(endpointReadiness(records, endpoints).images.status, 'partial');
    assert.equal(deliveryElapsed(records, base, endpoints).images.elapsedSeconds, null);
  }
});

test('cache identities stay explicit', () => {
  const cache = cacheIdentities([
    job({ name: 'build-ui', cache: 'node-modules:hit' }),
    job({ jobId: 2, name: 'build-api-image' }),
  ]);
  assert.deepEqual(cache.known, { 'build-ui': 'node-modules:hit' });
  assert.deepEqual(cache.unknown, ['build-api-image']);
});

test('an endpoint with an omitted required publisher is missing, not measured', () => {
  const apiOnly = [job({ name: 'publish-api-image' })];
  const both = [job({ name: 'publish-api-image' }), job({ jobId: 100, name: 'publish-ui-image' })];
  const patterns = { images: ['publish-api-image', 'publish-ui-image'] };
  const omitted = endpointReadiness(apiOnly, patterns);
  assert.equal(omitted.images.status, 'missing');
  assert.deepEqual(omitted.images.missing, ['publish-ui-image']);
  const complete = endpointReadiness(both, patterns);
  assert.equal(complete.images.status, 'measured');
});

test('admission compares measured peak against declared slots', () => {
  assert.deepEqual(admissionDecision({ peak: 17, availableSlots: 24, reserveSlots: 2 }),
    { status: 'admitted', peak: 17, availableSlots: 24, reserveSlots: 2, headroom: 5 });
  assert.equal(admissionDecision({ peak: 25, availableSlots: 24 }).status, 'over-capacity');
  assert.equal(admissionDecision({ peak: 17, availableSlots: null }).status, 'to-measure');
  assert.equal(admissionDecision({ peak: null, availableSlots: 24 }).status, 'to-measure');
});

test('timing budgets flag breaches and keep missing values to-measure', () => {
  const breach = budgetVerdict({ classificationSeconds: 15, verdictSeconds: 12, schedulingSeconds: 383 });
  assert.equal(breach.budgets.classificationSeconds.status, 'pass');
  assert.equal(breach.budgets.verdictSeconds.status, 'breach');
  assert.equal(breach.budgets.schedulingSeconds.status, 'breach');
  assert.equal(breach.ok, false);
  assert.equal(breach.pending, false);
  const pending = budgetVerdict({});
  assert.equal(pending.pending, true);
  assert.equal(pending.ok, false);
  assert.equal(budgetVerdict({ classificationSeconds: 8, verdictSeconds: 5, schedulingSeconds: 60 }).ok, true);
});

test('endpoint readiness distinguishes measured, partial, missing, and to-measure', () => {
  const records = [
    job({ name: 'publish-api-image' }),
    job({ jobId: 99, name: 'deploy-preprod', completedAt: null }),
  ];
  const readiness = endpointReadiness(records, {
    images: ['publish-api-image'],
    preproduction: ['deploy-preprod'],
    packages: ['publish-cluster-mesh'],
    qualification: [],
  });
  assert.equal(readiness.images.status, 'measured');
  assert.equal(readiness.preproduction.status, 'partial');
  assert.equal(readiness.packages.status, 'missing');
  assert.equal(readiness.qualification.status, 'to-measure');
});

test('cancellation ownership separates superseded attempts from current ones', () => {
  const records = [
    job({ runId: 9, attempt: 1, jobId: 1, conclusion: 'cancelled' }),
    job({ runId: 9, attempt: 2, jobId: 2 }),
    job({ runId: 9, attempt: 2, jobId: 3, conclusion: 'cancelled' }),
    job({ runId: 9, attempt: null, jobId: 4, conclusion: 'cancelled' }),
  ];
  const ownership = cancellationOwnership(records);
  assert.equal(ownership.cancelledCount, 3);
  assert.equal(ownership.superseded, 1);
  assert.equal(ownership.unidentified, 1);
  assert.deepEqual(ownership.cancelled.map((row) => row.ownership), ['superseded', 'current', 'unidentified']);
});

test('release continuity requires every release endpoint measured', () => {
  const endpoints = { images: ['publish-api-image'], preproduction: ['deploy-preprod'] };
  const full = [
    job({ name: 'publish-api-image' }),
    job({ jobId: 2, name: 'deploy-preprod' }),
  ];
  assert.equal(releaseContinuity(full, endpoints).continuous, true);
  const stopped = [
    job({ name: 'publish-api-image' }),
    job({ jobId: 2, name: 'deploy-preprod', conclusion: 'cancelled', completedAt: null }),
  ];
  const receipt = releaseContinuity(stopped, endpoints);
  assert.equal(receipt.continuous, false);
  assert.equal(receipt.endpoints.preproduction.status, 'partial');
});

for (const conclusion of ['failure', 'cancelled']) {
  test(`release continuity rejects a completed ${conclusion} release endpoint`, () => {
    const record = job({ runId: 1, attempt: 1, jobId: 2, name: 'deploy-preprod', conclusion,
      startedAt: '2026-10-19T12:00:00Z', completedAt: '2026-10-19T12:01:00Z' });
    const receipt = releaseContinuity([record], { preproduction: ['deploy-preprod'] });
    assert.equal(receipt.endpoints.preproduction.status, 'measured');
    assert.equal(receipt.continuous, false);
  });
}

test('release continuity rejects a completed failed qualification gate', () => {
  const gate = job({ runId: 39248907136, attempt: 1, jobId: 118102013502, name: 'ci-gate',
    conclusion: 'failure', startedAt: '2026-10-19T14:00:03Z', completedAt: '2026-10-19T14:00:18Z' });
  const receipt = releaseContinuity([gate], { qualification: ['ci-gate'] });
  assert.equal(receipt.endpoints.qualification.status, 'measured');
  assert.equal(receipt.continuous, false);
});

test('cancellation ownership marks older PR head runs superseded across run IDs', () => {
  const branch = 'chore/ci-capacity-metrics';
  const previous = { headSha: 'be63fe929df1f105b7de9d0966613f1a829139e8', runId: 39186496525 };
  const successor = { headSha: 'd1c38a512befa26b9f6f61001a4af924a532c5b7', runId: 39186952208 };
  const records = [
    job({ ...previous, headBranch: branch, attempt: 1, jobId: 1, conclusion: 'cancelled' }),
    job({ ...previous, headBranch: branch, attempt: 1, jobId: 2, conclusion: 'cancelled' }),
    job({ ...previous, headBranch: branch, attempt: 1, jobId: 3 }),
    job({ ...successor, headBranch: branch, attempt: 1, jobId: 4, conclusion: 'cancelled' }),
    job({ ...successor, headBranch: branch, attempt: 1, jobId: 5 }),
  ];
  const receipt = cancellationOwnership(records);
  assert.equal(receipt.cancelledCount, 3);
  assert.equal(receipt.superseded, 2);
  const previousOwnership = receipt.cancelled.filter((row) => row.runId === previous.runId);
  assert.equal(previousOwnership.length, 2);
  assert.ok(previousOwnership.every((row) => row.ownership === 'superseded'));
  assert.ok(previousOwnership.every((row) => row.headSha === previous.headSha));
  const successorOwnership = receipt.cancelled.filter((row) => row.runId === successor.runId);
  assert.deepEqual(successorOwnership.map((row) => row.ownership), ['current']);
});

test('capture records retain head ref context for supersession receipts', () => {
  const [record] = captureRecords({ run: { id: 7 }, jobs: [{ run_id: 7, run_attempt: 1,
    id: 11, name: 'changes', conclusion: 'cancelled', head_sha: 'abc123', head_branch: 'chore/x',
    started_at: '2026-10-18T10:00:00Z', completed_at: '2026-10-18T10:01:00Z' }] });
  assert.equal(record.headSha, 'abc123');
  assert.equal(record.headBranch, 'chore/x');
});
