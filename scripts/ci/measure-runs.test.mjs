// CI optimization Lot 1 measurement unit tests (make test-ci-optimization).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareWindows,
  dedupeRuns,
  gateDelayMinutes,
  redactRun,
  summarizeWindow,
} from './measure-runs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'ci', 'fixtures', 'optimization-baseline.json'), 'utf8'),
);

test('baseline fixture carries the study anchors and the acceptance protocol', () => {
  assert.equal(baseline.schema, 'ci-optimization-baseline/1');
  assert.equal(baseline.studyBaseline, 'fb5e92a6ae4928066e181716fdffbfb490b0b4f3');
  assert.ok(baseline.mainSha.length >= 40, 'records the implementation base SHA');
  assert.ok(baseline.acceptance.minRuns >= 20, 'at least 20 comparable runs per window');
  assert.ok(baseline.acceptance.minDays >= 7, 'at least seven days per window');
  assert.equal(baseline.acceptance.gateTargetMinutes, 5);
  assert.ok(baseline.cohorts.pricedSuccesses >= 266, 'historical partial valuation basis');
});

test('redaction keeps measurement fields and strips credentials and payloads', () => {
  const redacted = redactRun({
    id: 42,
    attempt: 2,
    event: 'pull_request',
    secrets: { token: 'sekret' },
    payload: { diff: 'huge' },
    jobs: [{ id: 7, name: 'ci-gate', conclusion: 'success', env: { KEY: 'sekret' }, logs: 'long' }],
  });
  assert.equal(redacted.runId, 42);
  assert.equal(redacted.jobs[0].conclusion, 'success');
  assert.ok(!('secrets' in redacted), 'no credentials survive');
  assert.ok(!('payload' in redacted), 'no payload content survives');
  assert.ok(!('env' in redacted.jobs[0]) && !('logs' in redacted.jobs[0]), 'no job payload survives');
});

test('deduplication folds retries by run ID, attempt and job ID', () => {
  const runs = dedupeRuns([
    { id: 1, attempt: 1, jobs: [{ id: 9, name: 'gate', conclusion: 'cancelled' }] },
    { id: 1, attempt: 1, jobs: [{ id: 9, name: 'gate', conclusion: 'cancelled' }] },
    { id: 1, attempt: 2, jobs: [{ id: 9, name: 'gate', conclusion: 'success' }] },
  ]);
  assert.equal(runs.length, 2);
  assert.equal(runs.find((r) => r.attempt === 1).jobs.length, 1);
});

test('failures, cancellations and retries stay in work accounting', () => {
  const summary = summarizeWindow({
    runs: [
      { conclusion: 'failure', jobs: [{ runnerSeconds: 60 }] },
      { conclusion: 'cancelled', jobs: [{ runnerSeconds: 30 }] },
      { conclusion: 'success', jobs: [{ runnerSeconds: 90 }] },
    ],
  });
  assert.equal(summary.failures, 1);
  assert.equal(summary.cancellations, 1);
  assert.equal(summary.runnerMinutes, 3);
});

test('gate delay uses creation to final-head gate timestamps only', () => {
  assert.equal(gateDelayMinutes({ createdAt: '2026-10-01T00:00:00Z', gateAt: '2026-10-01T00:04:00Z' }), 4);
  assert.equal(gateDelayMinutes({ createdAt: null, gateAt: '2026-10-01T00:04:00Z' }), null);
});

test('compare reports p50/p95 and fails a p95 regression above 10 percent', () => {
  const mk = (delay) => ({ createdAt: '2026-10-01T00:00:00Z', gateAt: new Date(Date.parse('2026-10-01T00:00:00Z') + delay * 60000).toISOString(), conclusion: 'success', jobs: [{ conclusion: 'success' }] });
  const before = { runs: Array.from({ length: 20 }, () => mk(10)) };
  const regressed = { runs: Array.from({ length: 20 }, () => mk(12)) };
  const result = compareWindows(before, regressed, { minRuns: 20 });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.findings.some((f) => f.includes('p95 regression')));
  assert.equal(result.after.gateP50, 12);
});

test('compare stays pending until both windows hold the minimum sample', () => {
  const result = compareWindows({ runs: [] }, { runs: [] }, { minRuns: 20 });
  assert.equal(result.verdict, 'pending');
});

test('compare fails missing required results and new failures', () => {
  const ok = { createdAt: '2026-10-01T00:00:00Z', gateAt: '2026-10-01T00:04:00Z', conclusion: 'success', jobs: [{ conclusion: 'success' }] };
  const missing = { ...ok, jobs: [{ conclusion: null }] };
  const failed = { ...ok, conclusion: 'failure', jobs: [{ conclusion: 'failure' }] };
  const before = { runs: Array.from({ length: 20 }, () => ok) };
  assert.equal(compareWindows(before, { runs: Array.from({ length: 20 }, () => missing) }, { minRuns: 20 }).verdict, 'fail');
  assert.equal(compareWindows(before, { runs: Array.from({ length: 20 }, () => failed) }, { minRuns: 20 }).verdict, 'fail');
});
