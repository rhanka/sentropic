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
  const products = successes.filter(run => run.fullProduct);
  const breaches = runs.filter(run => run.wallSeconds > 600);
  const profileCounts = Object.fromEntries(profiles.map(profile => [profile, products.filter(run => run.profile === profile).length]));
  const caseCounts = Object.fromEntries(cases.map(name => [name, products.filter(run => run.case === name).length]));
  const selectedEndpointsComplete = run => Object.values(run.endpoints).every(endpoint =>
    endpoint.status === 'unselected' || endpoint.elapsedSeconds !== null && endpoint.elapsedSeconds <= 600);
  const missing = [
    ...(products.length < 30 ? [`full-product samples ${products.length}/30`] : []),
    ...profiles.filter(profile => !profileCounts[profile]).map(profile => `profile ${profile}`),
    ...cases.filter(name => !caseCounts[name]).map(name => `case ${name}`),
    ...(!successes.some(run => run.event === 'pull_request') ? ['successful PR'] : []),
    ...(!successes.some(run => run.event === 'push' && run.headBranch === 'main') ? ['successful main'] : []),
    ...(runs.some(run => !run.complete || !run.qualified) ? ['incomplete or unsuccessful executions retained'] : []),
    ...(successes.some(run => !run.workflowSha) ? ['workflow SHA receipts'] : []),
  ];
  return { budgetSeconds: 600, accepted: missing.length === 0 && breaches.length === 0
      && products.every(selectedEndpointsComplete),
    count: runs.length, successful: successes.length, fullProduct: products.length,
    distribution: distribution(successes.map(run => run.wallSeconds)),
    pr: distribution(successes.filter(run => run.event === 'pull_request').map(run => run.wallSeconds)),
    main: distribution(successes.filter(run => run.event === 'push' && run.headBranch === 'main').map(run => run.wallSeconds)),
    profileCounts, caseCounts, missing, breachRunIds: breaches.map(run => run.runId),
    runnerMinutes: runs.reduce((sum, run) => sum + run.runnerMinutes, 0), runs };
}
