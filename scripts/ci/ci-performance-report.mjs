#!/usr/bin/env node
// BR-84: observed executions only. Unknown profiles and missing receipts never
// become zero-duration samples or successful acceptance evidence.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureRecords, criticalPathScheduling, dedupeJobs, deliveryElapsed,
  durationSeconds, executionSeconds, queueSeconds, runnerMinutes, stepSpans,
  concurrencyPeak } from './ci-run-metrics.mjs';
import { reconcileRun } from './ci-expected-results.mjs';

export const profiles = ['warm', 'source-miss', 'lock-miss', 'full-cold', 'concurrent-traffic'];
export const cases = ['api', 'ui', 'mixed', 'shared-asset', 'tooling-lock', 'fresh-release'];

export function distribution(values) {
  const sorted = values.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const quantile = q => sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null;
  return { n: sorted.length, median: quantile(0.5), p90: quantile(0.9), p95: quantile(0.95), maximum: quantile(1) };
}

export function measureRun(capture) {
  const run = capture.run;
  const records = dedupeJobs(captureRecords(capture)).jobs;
  const manifest = capture.manifest;
  const verdict = manifest ? reconcileRun(manifest, { run,
    executed: records.map(row => ({ job: row.name, conclusion: row.conclusion })) }) : null;
  const selected = manifest?.expected?.filter(row => row.required !== false && row.selected !== false) ?? [];
  const endpoints = {
    qualification: ['ci-gate'],
    images: selected.filter(row => /^publish-(api|ui)-image$/.test(row.job)).map(row => row.job),
    preproduction: selected.filter(row => row.job === 'deploy-preprod').map(row => row.job),
    packages: selected.filter(row => /^publish-/.test(row.job) && !row.job.endsWith('-image')).map(row => row.job),
  };
  const elapsed = deliveryElapsed(records, run.created_at, endpoints);
  for (const [name, members] of Object.entries(endpoints)) {
    if (!manifest) elapsed[name] = { status: 'to-measure', elapsedSeconds: null };
    else if (!members.length) elapsed[name] = { status: 'unselected', elapsedSeconds: null };
    else if (records.some(row => members.includes(row.name) && row.conclusion !== 'success')) {
      elapsed[name] = { ...elapsed[name], status: 'failed', elapsedSeconds: null };
    }
  }
  const fresh = run.run_attempt === 1 && records.every(row => row.conclusion === 'skipped'
    || row.attempt === 1 && row.dispatched === true && durationSeconds(run.created_at, row.startedAt) !== null);
  const complete = run.status === 'completed' && records.length > 0 && records.every(row => row.conclusion
    && (row.conclusion === 'skipped' || executionSeconds(row) !== null));
  const wallSeconds = complete ? durationSeconds(run.created_at, run.updated_at) : null;
  const allSelectedMeasured = selected.length > 0 && selected.every(item => records.some(row => row.name === item.job
    && row.conclusion === 'success' && row.dispatched === true && executionSeconds(row) !== null));
  const qualified = complete && fresh && run.conclusion === 'success' && verdict?.ok === true && allSelectedMeasured;
  const fullProduct = ['build-api-image', 'build-ui', 'test-e2e', 'test-api-unit-integration']
    .every(name => selected.some(row => row.job === name || row.job.startsWith(`${name} (`)));
  const measurements = records.map(row => ({ runId: row.runId, attempt: row.attempt,
    jobId: row.jobId, name: row.name, conclusion: row.conclusion, labels: row.labels,
    seconds: row.conclusion === 'skipped' ? null : executionSeconds(row), queueSeconds: queueSeconds(row),
    steps: stepSpans(row), url: `https://github.com/rhanka/sentropic/actions/runs/${run.id}/job/${row.jobId}` }));
  return { runId: run.id, attempt: run.run_attempt, event: run.event, headBranch: run.head_branch,
    phase: capture.phase ?? 'before', evidenceGaps: capture.evidenceGaps ?? ['product/cache/test receipts'],
    sourceSha: run.head_sha, workflowSha: capture.workflowSha ?? null,
    policyDigest: manifest?.policyDigest ?? null, status: run.status, conclusion: run.conclusion,
    profile: capture.profile ?? null, case: capture.case ?? null,
    url: `https://github.com/rhanka/sentropic/actions/runs/${run.id}/attempts/${run.run_attempt}`,
    wallSeconds, qualificationSeconds: elapsed.qualification.elapsedSeconds,
    gapSeconds: wallSeconds === null ? null : Math.max(0, wallSeconds - 600),
    complete, fresh, qualified, fullProduct, endpoints: elapsed,
    expectedResults: selected.length, passedResults: verdict?.passed.length ?? null,
    membershipFailures: verdict?.failures ?? [{ job: 'manifest', reason: 'missing' }],
    criticalPaths: criticalPathScheduling(records, manifest?.dependencies, endpoints, run.created_at),
    runnerMinutes: runnerMinutes(records).totalMinutes, providerCost: capture.providerCost ?? null,
    peakJobs: concurrencyPeak(records), jobs: measurements,
    slowestJobs: measurements.filter(row => row.seconds !== null).sort((a, b) => b.seconds - a.seconds).slice(0, 10),
  };
}

export function campaign(captures) {
  const keys = captures.map(capture => `${capture.run.id}/${capture.run.run_attempt}`);
  if (new Set(keys).size !== keys.length) throw Error('Duplicate run/attempt in campaign');
  const runs = captures.map(measureRun);
  const successes = runs.filter(run => run.qualified);
  const after = runs.filter(run => run.phase === 'after');
  const candidates = after.filter(run => run.qualified);
  const products = candidates.filter(run => run.fullProduct);
  const breaches = after.filter(run => run.wallSeconds > 600);
  const profileCounts = Object.fromEntries(profiles.map(profile => [profile, products.filter(run => run.profile === profile).length]));
  const caseCounts = Object.fromEntries(cases.map(name => [name, products.filter(run => run.case === name).length]));
  const selectedEndpointsComplete = run => Object.values(run.endpoints).every(endpoint =>
    endpoint.status === 'unselected' || endpoint.elapsedSeconds !== null && endpoint.elapsedSeconds <= 600);
  const missing = [
    ...(products.length < 30 ? [`full-product samples ${products.length}/30`] : []),
    ...profiles.filter(profile => !profileCounts[profile]).map(profile => `profile ${profile}`),
    ...cases.filter(name => !caseCounts[name]).map(name => `case ${name}`),
    ...(!candidates.some(run => run.event === 'pull_request') ? ['successful after PR'] : []),
    ...(!candidates.some(run => run.event === 'push' && run.headBranch === 'main') ? ['successful after main'] : []),
    ...(after.some(run => !run.complete || !run.qualified) ? ['incomplete or unsuccessful after executions retained'] : []),
    ...(candidates.some(run => !run.workflowSha) ? ['workflow SHA receipts'] : []),
    ...new Set(candidates.flatMap(run => run.evidenceGaps)),
  ];
  return { budgetSeconds: 600, accepted: missing.length === 0 && breaches.length === 0
      && products.every(selectedEndpointsComplete),
    count: runs.length, successful: successes.length, fullProduct: products.length,
    before: distribution(successes.filter(run => run.phase === 'before').map(run => run.wallSeconds)),
    after: distribution(candidates.map(run => run.wallSeconds)),
    distribution: distribution(successes.map(run => run.wallSeconds)),
    pr: distribution(successes.filter(run => run.event === 'pull_request').map(run => run.wallSeconds)),
    main: distribution(successes.filter(run => run.event === 'push' && run.headBranch === 'main').map(run => run.wallSeconds)),
    profileCounts, caseCounts, missing, breachRunIds: breaches.map(run => run.runId),
    runnerMinutes: runs.reduce((sum, run) => sum + run.runnerMinutes, 0), runs };
}

// Retain sanitized API facts, not logs, credentials or machine-specific paths.
export function collect(directory) {
  const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return fs.readdirSync(directory).filter(name => /^\d+-\d+$/.test(name)).sort().map(name => {
    const dir = path.join(directory, name);
    const capture = read(path.join(dir, 'capture.json'));
    if (!capture) throw Error(`Missing capture: ${name}`);
    const fields = ['id', 'run_attempt', 'event', 'head_branch', 'head_sha', 'status', 'conclusion',
      'created_at', 'run_started_at', 'updated_at'];
    const manifest = read(path.join(dir, 'expected.json'));
    const capacity = read(path.join(dir, 'capacity/capture.json'));
    return { run: Object.fromEntries(fields.map(key => [key, capture.run[key] ?? null])),
      records: captureRecords(capture), manifest,
      workflowSha: capacity?.workflowSha ?? null, profile: null, case: null,
      phase: capture.run.head_branch === 'test/ci-ten-minute-proof' ? 'after' : 'before',
      evidenceGaps: ['cache profile', 'change case', 'executed test identities', 'provider cost',
        ...(capacity?.workflowSha ? [] : ['workflow SHA'])] };
  });
}

const formatSeconds = seconds => seconds === null ? 'to measure' : `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
export function markdown(report) {
  const lines = ['# BR-84 CI performance evidence', '',
    `Acceptance: **${report.accepted ? 'PASS' : 'OPEN'}**. Budget: 600 seconds including queue and cleanup.`, '',
    `${report.count} attempts; ${report.successful} complete successful attempts; ${report.fullProduct} full-product samples.`, '',
    '| Event | n | Median | p90 | p95 | Maximum |', '| --- | ---: | --- | --- | --- | --- |'];
  for (const [name, values] of [['PR', report.pr], ['main', report.main]]) {
    lines.push(`| ${name} | ${values.n} | ${formatSeconds(values.median)} | ${formatSeconds(values.p90)} | ${formatSeconds(values.p95)} | ${formatSeconds(values.maximum)} |`);
  }
  lines.push('', '| Run / attempt | Event | Result | Wall | Qualification | Gap to 600s |', '| --- | --- | --- | --- | --- | --- |');
  for (const run of report.runs) lines.push(`| [${run.runId}/${run.attempt}](${run.url}) | ${run.event} | ${run.conclusion ?? run.status} | ${formatSeconds(run.wallSeconds)} | ${formatSeconds(run.qualificationSeconds)} | ${formatSeconds(run.gapSeconds)} |`);
  lines.push('', '## Missing acceptance evidence', '', ...report.missing.map(item => `- ${item}`), '',
    `Runner minutes: ${report.runnerMinutes.toFixed(2)}. Provider cost: to measure.`, '',
    'Failed, cancelled and incomplete runs remain listed. A failed gate is never a successful latency sample. Workflow age is never substituted for a missing job queue timestamp.');
  for (const run of report.runs) {
    lines.push('', `## Run ${run.runId}/${run.attempt}`, '',
      `Source: \`${run.sourceSha}\`; workflow: \`${run.workflowSha ?? 'to measure'}\`.`, '',
      '| Job | Execution (s) | Ready queue (s) |', '| --- | ---: | ---: |',
      ...run.slowestJobs.map(job => `| [${job.name}](${job.url}) | ${job.seconds} | ${job.queueSeconds ?? 'to measure'} |`));
    for (const [endpoint, receipt] of Object.entries(run.criticalPaths)) {
      if (!receipt.jobs.length) continue;
      lines.push('', `${endpoint} critical path; cumulative scheduling: ${receipt.seconds ?? 'to measure'}s.`, '',
        ...receipt.jobs.map(job => `- ${job.name}: run ${job.runId}, attempt ${job.attempt}, job ${job.jobId}; queue ${job.queueSeconds ?? 'to measure'}s; admission ${job.admissionSeconds ?? 'to measure'}s; total scheduling ${job.schedulingSeconds ?? 'to measure'}s.`));
    }
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = flag => args[args.indexOf(flag) + 1];
  if (args.includes('--collect')) {
    const runs = collect(value('--collect'));
    // One record per line keeps generated API evidence diffable per attempt.
    console.log(`{\n"schemaVersion":1,\n"runs":[\n${runs.map(run => JSON.stringify(run)).join(',\n')}\n]\n}`);
  } else {
    if (!args.includes('--input')) throw Error('Required: --input <runs.json> or --collect <capture-directory>');
    const report = campaign(JSON.parse(fs.readFileSync(value('--input'), 'utf8')).runs);
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : markdown(report));
    if (args.includes('--require-proof') && !report.accepted) process.exitCode = 1;
  }
}
