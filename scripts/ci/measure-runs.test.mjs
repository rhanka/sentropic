// CI optimization Lot 1 measurement unit tests (make test-ci-optimization).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
const scriptPath = path.join(root, 'scripts', 'ci', 'measure-runs.mjs');
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'ci', 'fixtures', 'optimization-baseline.json'), 'utf8'),
);

const mkRun = (delayMin, index = 0, overrides = {}) => {
  const createdMs = Date.parse('2026-10-01T00:00:00Z') + index * 12 * 3600000;
  const gateMs = createdMs + delayMin * 60000;
  return {
    id: 1000 + index, created_at: new Date(createdMs).toISOString(), conclusion: 'success',
    jobs: [
      { id: 5000 + index, name: 'ci-gate', conclusion: 'success', started_at: new Date(createdMs).toISOString(), completed_at: new Date(gateMs).toISOString() },
      { id: 6000 + index, name: 'test-api-unit-integration (ai)', conclusion: 'success', runnerSeconds: 120, llmMinutes: 2 },
    ],
    ...overrides,
  };
};

test('baseline fixture carries the study anchors and the acceptance protocol', () => {
  assert.equal(baseline.schema, 'ci-optimization-baseline/1');
  assert.equal(baseline.studyBaseline, 'fb5e92a6ae4928066e181716fdffbfb490b0b4f3');
  assert.ok(baseline.mainSha.length >= 40, 'records the implementation base SHA');
  assert.ok(baseline.acceptance.minRuns >= 20, 'at least 20 comparable runs per window');
  assert.ok(baseline.acceptance.minDays >= 7, 'at least seven days per window');
  assert.equal(baseline.acceptance.gateTargetMinutes, 5);
  assert.ok(baseline.cohorts.pricedSuccesses >= 266, 'historical partial valuation basis');
});

test('redaction normalizes GitHub snake_case fields, preserves llmMinutes and strips secrets', () => {
  const redacted = redactRun({
    id: 42, run_attempt: 2, event: 'pull_request', head_sha: 'abc123', base_sha: 'def456',
    created_at: '2026-10-01T00:00:00Z', pull_requests: [{ number: 696 }],
    secrets: { token: 'sekret' }, payload: { diff: 'huge' },
    jobs: [{
      id: 7, name: 'ci-gate', run_attempt: 2, conclusion: 'success',
      started_at: '2026-10-01T00:01:00Z', completed_at: '2026-10-01T00:04:00Z',
      llmMinutes: 1.5, env: { KEY: 'sekret' }, logs: 'long',
    }],
  });
  assert.equal(redacted.runId, 42);
  assert.equal(redacted.attempt, 2);
  assert.equal(redacted.pr, 696);
  assert.equal(redacted.testedSha, 'abc123');
  assert.equal(redacted.baseSha, 'def456');
  assert.equal(redacted.createdAt, '2026-10-01T00:00:00Z');
  assert.equal(redacted.gateAt, '2026-10-01T00:04:00Z');
  assert.equal(redacted.jobs[0].runnerSeconds, 180);
  assert.equal(redacted.jobs[0].llmMinutes, 1.5);
  assert.ok(!('secrets' in redacted) && !('payload' in redacted), 'no credentials or payloads survive');
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

test('failures, cancellations, retries and LLM minutes stay in work accounting', () => {
  const summary = summarizeWindow({
    runs: [
      { conclusion: 'failure', jobs: [{ runnerSeconds: 60, llmMinutes: 0.5 }] },
      { conclusion: 'cancelled', jobs: [{ runnerSeconds: 30, llmMinutes: 0.25 }] },
      { conclusion: 'success', createdAt: '2026-10-01T00:00:00Z', gateAt: '2026-10-01T00:02:00Z', jobs: [{ runnerSeconds: 90, llmMinutes: 1.25, conclusion: 'success' }] },
    ],
  });
  assert.equal(summary.failures, 1);
  assert.equal(summary.cancellations, 1);
  assert.equal(summary.runnerMinutes, 3);
  assert.equal(summary.llmMinutes, 2);
});

test('gate delay uses creation to final-head gate timestamps only', () => {
  assert.equal(gateDelayMinutes({ createdAt: '2026-10-01T00:00:00Z', gateAt: '2026-10-01T00:04:00Z' }), 4);
  assert.equal(gateDelayMinutes({ createdAt: null, gateAt: '2026-10-01T00:04:00Z' }), null);
});

test('compare rejects empty job inventories, missing gate timestamps, short windows and masked shard failures', () => {
  const emptyTwenty = { runs: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, conclusion: 'success', jobs: [] })) };
  const emptyVerdict = compareWindows(emptyTwenty, emptyTwenty, { minRuns: 20, minDays: 7 });
  assert.equal(emptyVerdict.verdict, 'fail');
  assert.ok(emptyVerdict.findings.some((f) => f.includes('empty job inventory')));
  assert.ok(emptyVerdict.findings.some((f) => f.includes('missing gate timestamps')));

  const validBefore = { runs: Array.from({ length: 20 }, (_, i) => mkRun(10, i)) };
  const noGateAfter = { runs: Array.from({ length: 20 }, (_, i) => ({ ...mkRun(4, i), created_at: null, createdAt: null, gateAt: null })) };
  assert.equal(compareWindows(validBefore, noGateAfter, { minRuns: 20, minDays: 7 }).verdict, 'fail');

  const maskedAi = { runs: Array.from({ length: 20 }, (_, i) => mkRun(4, i, { jobs: [
    { id: 1, name: 'ci-gate', conclusion: 'success', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:04:00Z' },
    { id: 2, name: 'test-api-unit-integration (ai)', conclusion: 'failure', runnerSeconds: 60 },
  ] })) };
  const maskedResult = compareWindows(validBefore, maskedAi, { minRuns: 20, minDays: 7 });
  assert.equal(maskedResult.verdict, 'fail');
  assert.ok(maskedResult.findings.some((f) => f.includes('failed or cancelled job behind successful run')));

  const sameHourRuns = { runs: Array.from({ length: 20 }, (_, i) => mkRun(4, 0, { id: 2000 + i })) };
  const shortWindow = compareWindows(validBefore, sameHourRuns, { minRuns: 20, minDays: 7 });
  assert.equal(shortWindow.verdict, 'pending');
  assert.ok(shortWindow.findings.some((f) => f.includes('insufficient window duration')));

  const regressed = { runs: Array.from({ length: 20 }, (_, i) => mkRun(12, i)) };
  const regResult = compareWindows(validBefore, regressed, { minRuns: 20, minDays: 7 });
  assert.equal(regResult.verdict, 'fail');
  assert.ok(regResult.findings.some((f) => f.includes('p95 regression')));
});

test('collect requires --runs and round-trips through compare to pass on complete windows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-measure-'));
  try {
    assert.notEqual(spawnSync(process.execPath, [scriptPath, 'collect', '--window', 'before', '--out', path.join(dir, 'nope.json')], { encoding: 'utf8' }).status, 0);
    const [rawBefore, rawAfter, winBefore, winAfter, compOut] = ['rb.json', 'ra.json', 'b.json', 'a.json', 'c.json'].map((f) => path.join(dir, f));
    fs.writeFileSync(rawBefore, JSON.stringify(Array.from({ length: 20 }, (_, i) => mkRun(10, i))));
    fs.writeFileSync(rawAfter, JSON.stringify(Array.from({ length: 20 }, (_, i) => mkRun(4, i))));
    assert.equal(spawnSync(process.execPath, [scriptPath, 'collect', '--runs', rawBefore, '--window', 'before', '--out', winBefore], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync(process.execPath, [scriptPath, 'collect', '--runs', rawAfter, '--window', 'after', '--out', winAfter], { encoding: 'utf8' }).status, 0);
    const cmp = spawnSync(process.execPath, [scriptPath, 'compare', '--before', winBefore, '--after', winAfter, '--out', compOut], { encoding: 'utf8' });
    assert.equal(cmp.status, 0, `round-trip compare passes: ${cmp.stdout}${cmp.stderr}`);
    const parsed = JSON.parse(fs.readFileSync(compOut, 'utf8'));
    assert.equal(parsed.verdict, 'pass');
    assert.equal(parsed.after.gateP50, 4);
    assert.equal(parsed.after.llmMinutes, 40);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
