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
  outputsForChangeClass,
  redactRun,
  summarizeWindow,
} from './measure-runs.mjs';
import { requiredSuccessJobs } from './filter-consumers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = path.join(root, 'scripts', 'ci', 'measure-runs.mjs');
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'ci', 'fixtures', 'optimization-baseline.json'), 'utf8'),
);

const buildFullJobs = (changeClass, event, createdMs, gateMs, index) => [
  ...requiredSuccessJobs(outputsForChangeClass(changeClass), { eventName: event }).map((name, jIdx) => {
    const isAi = name === 'test-api-unit-integration', isE2e = name === 'test-e2e' || name === 'e2e-vscode';
    return {
      id: (index + 1) * 100 + jIdx, name: isAi ? 'test-api-unit-integration (ai)' : name, conclusion: 'success',
      runnerSeconds: isAi ? 120 : (isE2e ? 60 : 30), llmMinutes: isAi ? 2 : (isE2e ? 0.5 : 0),
      selectedTests: isAi || isE2e ? 10 : null, executedTests: isAi || isE2e ? 10 : null,
    };
  }),
  { id: (index + 1) * 100 + 99, name: 'ci-gate', conclusion: 'success', started_at: new Date(createdMs).toISOString(), completed_at: new Date(gateMs).toISOString(), runnerSeconds: 5 },
];

const mkRun = (delayMin, index = 0, overrides = {}) => {
  const isAfter = overrides.windowTag === 'after', idOffset = isAfter ? 2000 : 1000;
  const createdMs = Date.parse(isAfter ? '2026-10-15T00:00:00Z' : '2026-10-01T00:00:00Z') + index * 12 * 3600000;
  const gateMs = createdMs + delayMin * 60000;
  const event = overrides.event !== undefined ? overrides.event : 'pull_request';
  const changeClass = overrides.changeClass !== undefined ? overrides.changeClass : 'api';
  return {
    workflow: 'CI', id: idOffset + index, event, changeClass,
    testedSha: `headsha${idOffset + index}`, baseSha: baseline.studyBaseline,
    created_at: new Date(createdMs).toISOString(), conclusion: 'success',
    jobs: outputsForChangeClass(changeClass) && (event === 'pull_request' || event === 'push') ? buildFullJobs(changeClass, event, createdMs, gateMs, index) : [],
    ...overrides,
  };
};

const mkWindow = (window, runs, overrides = {}) => ({ window, workflow: 'CI', studyBaseline: baseline.studyBaseline, runs, ...overrides });

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
    id: 42, run_attempt: 2, event: 'pull_request', head_sha: 'abc1234', base_sha: 'def4567',
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
  assert.equal(redacted.testedSha, 'abc1234');
  assert.equal(redacted.baseSha, 'def4567');
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
      { conclusion: 'success', createdAt: '2026-10-01T00:00:00Z', gateAt: '2026-10-01T00:02:00Z', jobs: [{ name: 'ci-gate', runnerSeconds: 90, llmMinutes: 1.25, conclusion: 'success' }] },
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

test('compare rejects gate-only API runs, skipped ci-gate, reused run IDs, missing identities and 19:1 vs 1:19 cohort skew', () => {
  const validBefore = mkWindow('before', Array.from({ length: 20 }, (_, i) => mkRun(10, i)));
  const validAfter = mkWindow('after', Array.from({ length: 20 }, (_, i) => mkRun(4, i, { windowTag: 'after' })));
  assert.equal(compareWindows(validBefore, validAfter, { minRuns: 20, minDays: 7 }).verdict, 'pass');

  // 1. Finding 3 reproduction: 20 API PR runs containing only ci-gate MUST fail.
  const gateOnlyAfter = mkWindow('after', Array.from({ length: 20 }, (_, i) => {
    const r = mkRun(4, i, { windowTag: 'after' });
    return { ...r, jobs: r.jobs.filter((j) => j.name === 'ci-gate') };
  }));
  const gateOnlyRes = compareWindows(validBefore, gateOnlyAfter, { minRuns: 20, minDays: 7 });
  assert.equal(gateOnlyRes.verdict, 'fail');
  assert.ok(gateOnlyRes.findings.some((f) => f.includes('incomplete required job/test inventory')));

  // 2. Finding 3 reproduction: ci-gate with conclusion=skipped MUST fail.
  const skippedGateAfter = mkWindow('after', Array.from({ length: 20 }, (_, i) => {
    const r = mkRun(4, i, { windowTag: 'after' });
    return { ...r, jobs: r.jobs.map((j) => (j.name === 'ci-gate' ? { ...j, conclusion: 'skipped' } : j)) };
  }));
  const skippedGateRes = compareWindows(validBefore, skippedGateAfter, { minRuns: 20, minDays: 7 });
  assert.equal(skippedGateRes.verdict, 'fail');
  assert.ok(skippedGateRes.findings.some((f) => f.includes('missing gate timestamps')));

  // 3. Finding 3 reproduction: reusing the exact same 20 run IDs/timestamps across before and after MUST fail.
  const relabeledSameRuns = mkWindow('after', validBefore.runs);
  const reusedRes = compareWindows(validBefore, relabeledSameRuns, { minRuns: 20, minDays: 7 });
  assert.equal(reusedRes.verdict, 'fail');
  assert.ok(reusedRes.findings.some((f) => f.includes('reused or overlapping runs')));

  // 4. Finding 3 reproduction: missing window, workflow, event, testedSha, baseSha, or changeClass MUST fail.
  assert.equal(compareWindows({ ...validBefore, window: undefined }, { ...validAfter, window: undefined }, { minRuns: 20, minDays: 7 }).verdict, 'fail');
  assert.equal(compareWindows({ ...validBefore, workflow: undefined }, { ...validAfter, workflow: undefined }, { minRuns: 20, minDays: 7 }).verdict, 'fail');
  for (const field of ['workflow', 'event', 'testedSha', 'baseSha', 'changeClass']) {
    const missingFieldAfter = mkWindow('after', validAfter.runs.map((r) => ({ ...r, [field]: null, head_sha: null, base_sha: null, name: null })));
    const res = compareWindows(validBefore, missingFieldAfter, { minRuns: 20, minDays: 7 });
    assert.equal(res.verdict, 'fail', `missing ${field} must fail`);
    assert.ok(res.findings.some((f) => f.includes('missing required run identity') || f.includes('non-CI workflow')));
  }

  // 5. Finding 3 reproduction: opposite 19:1 API-PR vs docs-push mixes MUST fail.
  const mix19Api1Docs = mkWindow('before', Array.from({ length: 20 }, (_, i) =>
    mkRun(10, i, i === 19 ? { event: 'push', changeClass: 'docs' } : { event: 'pull_request', changeClass: 'api' })));
  const mix1Api19Docs = mkWindow('after', Array.from({ length: 20 }, (_, i) =>
    mkRun(4, i, { windowTag: 'after', ...(i === 0 ? { event: 'pull_request', changeClass: 'api' } : { event: 'push', changeClass: 'docs' }) })));
  const skewRes = compareWindows(mix19Api1Docs, mix1Api19Docs, { minRuns: 20, minDays: 7 });
  assert.equal(skewRes.verdict, 'fail');
  assert.ok(skewRes.findings.some((f) => f.includes('incomparable event populations')));
  assert.ok(skewRes.findings.some((f) => f.includes('incomparable changeClass populations')));

  // 6. Masked AI failure, short window duration, and p95 regression checks remain enforced.
  const maskedAi = mkWindow('after', validAfter.runs.map((r) => ({
    ...r,
    jobs: r.jobs.map((j) => (j.name.includes('(ai)') ? { ...j, conclusion: 'failure' } : j)),
  })));
  assert.equal(compareWindows(validBefore, maskedAi, { minRuns: 20, minDays: 7 }).verdict, 'fail');

  const sameHourRuns = mkWindow('after', Array.from({ length: 20 }, (_, i) => mkRun(4, 0, { windowTag: 'after', id: 2000 + i })));
  const shortWindow = compareWindows(validBefore, sameHourRuns, { minRuns: 20, minDays: 7 });
  assert.equal(shortWindow.verdict, 'pending');
  assert.ok(shortWindow.findings.some((f) => f.includes('insufficient window duration')));

  const regressed = mkWindow('after', Array.from({ length: 20 }, (_, i) => mkRun(12, i, { windowTag: 'after' })));
  assert.equal(compareWindows(validBefore, regressed, { minRuns: 20, minDays: 7 }).verdict, 'fail');
});

test('collect requires --runs, rejects incomplete/reused windows in compare, and passes on complete distinct windows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-measure-'));
  try {
    assert.notEqual(spawnSync(process.execPath, [scriptPath, 'collect', '--window', 'before', '--out', path.join(dir, 'nope.json')], { encoding: 'utf8' }).status, 0);
    const [rawBefore, rawAfter, rawGateOnly, winBefore, winAfter, winGateOnly, compOut] = ['rb.json', 'ra.json', 'rg.json', 'b.json', 'a.json', 'g.json', 'c.json'].map((f) => path.join(dir, f));
    fs.writeFileSync(rawBefore, JSON.stringify(Array.from({ length: 20 }, (_, i) => mkRun(10, i))));
    fs.writeFileSync(rawAfter, JSON.stringify(Array.from({ length: 20 }, (_, i) => mkRun(4, i, { windowTag: 'after' }))));
    fs.writeFileSync(rawGateOnly, JSON.stringify(Array.from({ length: 20 }, (_, i) => {
      const r = mkRun(4, i, { windowTag: 'after' });
      return { ...r, jobs: r.jobs.filter((j) => j.name === 'ci-gate') };
    })));
    assert.equal(spawnSync(process.execPath, [scriptPath, 'collect', '--runs', rawBefore, '--window', 'before', '--out', winBefore], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync(process.execPath, [scriptPath, 'collect', '--runs', rawAfter, '--window', 'after', '--out', winAfter], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync(process.execPath, [scriptPath, 'collect', '--runs', rawGateOnly, '--window', 'after', '--out', winGateOnly], { encoding: 'utf8' }).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(winGateOnly, 'utf8')).complete, false, 'gate-only API runs mark window incomplete');
    assert.notEqual(spawnSync(process.execPath, [scriptPath, 'compare', '--before', winBefore, '--after', winGateOnly, '--out', compOut], { encoding: 'utf8' }).status, 0);

    const cmp = spawnSync(process.execPath, [scriptPath, 'compare', '--before', winBefore, '--after', winAfter, '--out', compOut], { encoding: 'utf8' });
    assert.equal(cmp.status, 0, `round-trip compare passes: ${cmp.stdout}${cmp.stderr}`);
    const parsed = JSON.parse(fs.readFileSync(compOut, 'utf8'));
    assert.equal(parsed.verdict, 'pass');
    assert.equal(parsed.after.gateP50, 4);
    assert.equal(parsed.after.llmMinutes, 60);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
