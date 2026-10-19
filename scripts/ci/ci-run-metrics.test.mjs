// ci-run-metrics fixtures (make test-ci-run-metrics).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  concurrencyPeak,
  dedupeJobs,
  durationSeconds,
  endpointReadiness,
  isTimestampGap,
  overlappingSeconds,
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
