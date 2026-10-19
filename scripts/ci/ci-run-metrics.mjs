#!/usr/bin/env node
// CI run metrics. Contract: plan/62-BRANCH_chore-ci-capacity-metrics.md (BR-76).
// Measurement only: a duration is completion minus start on one identified
// run/attempt/job row. Missing timestamps stay null ("to measure"), never zero,
// and no sub-spans are invented. Runs only behind root Make targets.
import fs from 'node:fs';

// Parse an ISO-8601 string or epoch millis into millis since epoch, else null.
export function toMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? null : ms;
}

// Duration in seconds between two timestamps, or null when unmeasurable.
// A negative interval is a timestamp gap, not a negative duration: null.
export function durationSeconds(startedAt, completedAt) {
  const start = toMs(startedAt);
  const end = toMs(completedAt);
  if (start === null || end === null) return null;
  if (end < start) return null;
  return (end - start) / 1000;
}

// True when a record cannot yield a duration: exactly one timestamp missing,
// both missing with a non-skipped conclusion, or completion before start.
export function isTimestampGap(record) {
  const start = toMs(record?.startedAt);
  const end = toMs(record?.completedAt);
  if (start === null && end === null) return record?.conclusion !== 'skipped';
  if ((start === null) !== (end === null)) return true;
  return end < start;
}

export const jobKey = (record) =>
  `${record?.runId ?? 'unknown'}/attempt-${record?.attempt ?? '?'}/${record?.jobId ?? record?.name ?? 'unknown'}`;

// Deduplicate job rows across attempts of one run. GitHub reruns copy
// carried-forward jobs into the new attempt; those copies are not independent
// executions. Keep the highest attempt per (runId, jobId); count the rest as
// dropped carried-forward copies. Exact duplicates collapse to one row.
export function dedupeJobs(records) {
  const seen = new Map();
  let dropped = 0;
  for (const record of records ?? []) {
    const key = `${record?.runId ?? 'unknown'}/${record?.jobId ?? record?.name ?? 'unknown'}`;
    const attempt = Number.isFinite(record?.attempt) ? record.attempt : 0;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, { record, attempt });
      continue;
    }
    if (attempt === prior.attempt && JSON.stringify(record) === JSON.stringify(prior.record)) {
      dropped += 1;
      continue;
    }
    if (attempt >= prior.attempt) {
      dropped += 1;
      seen.set(key, { record, attempt });
    } else {
      dropped += 1;
    }
  }
  return { jobs: [...seen.values()].map((entry) => entry.record), dropped };
}

// Overlap in seconds between two runs' measurable windows, or null when
// either window is unmeasurable. Used for concurrent PR/main traffic.
export function overlappingSeconds(aRecords, bRecords) {
  const window = (records) => {
    const starts = [];
    const ends = [];
    for (const record of records ?? []) {
      const start = toMs(record?.startedAt);
      const end = toMs(record?.completedAt);
      if (start !== null) starts.push(start);
      if (end !== null) ends.push(end);
    }
    if (starts.length === 0 || ends.length === 0) return null;
    return { start: Math.min(...starts), end: Math.max(...ends) };
  };
  const a = window(aRecords);
  const b = window(bRecords);
  if (!a || !b || a.end < a.start || b.end < b.start) return null;
  return Math.max(0, (Math.min(a.end, b.end) - Math.max(a.start, b.start)) / 1000);
}

// Peak count of concurrently executing measurable jobs in one record set.
export function concurrencyPeak(records) {
  const events = [];
  for (const record of records ?? []) {
    const start = toMs(record?.startedAt);
    const end = toMs(record?.completedAt);
    if (start === null || end === null || end < start) continue;
    events.push([start, 1]);
    events.push([end, -1]);
  }
  events.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of events) {
    current += delta;
    if (current > peak) peak = current;
  }
  return peak;
}

// Summarize one captured run file. Buckets are disjoint: skipped rows are
// reported separately and never counted as measured; rows with timestamp gaps
// are unmeasured, never zero-filled. Partial means the capture holds fewer
// distinct jobs than expectedJobCount (null expectation means unknown).
export function summarizeRun(records, { expectedJobCount = null } = {}) {
  const { jobs, dropped } = dedupeJobs(records);
  let measured = 0;
  let unmeasured = 0;
  let skipped = 0;
  let gaps = 0;
  const spans = [];
  for (const job of jobs) {
    if (job?.conclusion === 'skipped') {
      skipped += 1;
      continue;
    }
    const span = durationSeconds(job?.startedAt, job?.completedAt);
    if (span === null) {
      unmeasured += 1;
      if (isTimestampGap(job)) gaps += 1;
    } else {
      measured += 1;
      spans.push(span);
    }
  }
  const partial = expectedJobCount === null ? null : jobs.length < expectedJobCount;
  return {
    jobs: jobs.length,
    measured,
    unmeasured,
    skipped,
    timestampGaps: gaps,
    carriedForwardCopiesDropped: dropped,
    partial,
    maxJobSeconds: spans.length > 0 ? Math.max(...spans) : null,
    concurrencyPeak: concurrencyPeak(jobs),
  };
}

// Presence of the four delivery endpoints in a record set. The caller maps
// each endpoint to job-name substrings; matching is case-insensitive.
// Status is measured (every mapped job present with a duration), partial
// (present without full durations), missing (no mapped job), or to-measure
// (the endpoint has no mapping yet).
export function endpointReadiness(records, endpoints = {}) {
  const result = {};
  for (const [endpoint, patterns] of Object.entries(endpoints)) {
    if (!Array.isArray(patterns) || patterns.length === 0) {
      result[endpoint] = { status: 'to-measure', jobs: [] };
      continue;
    }
    const matched = (records ?? []).filter((record) =>
      patterns.some((pattern) => String(record?.name ?? '').toLowerCase().includes(String(pattern).toLowerCase())),
    );
    if (matched.length === 0) {
      result[endpoint] = { status: 'missing', jobs: [] };
      continue;
    }
    const withDuration = matched.filter(
      (record) => durationSeconds(record?.startedAt, record?.completedAt) !== null,
    );
    result[endpoint] = {
      status: withDuration.length === matched.length ? 'measured' : 'partial',
      jobs: matched.map((record) => record?.name ?? String(record?.jobId ?? 'unknown')),
    };
  }
  return result;
}

const usage = `usage: ci-run-metrics.mjs --run-file <captured-run.json> [--expected-jobs <n>]
Captured file shape: { "records": [{ runId, attempt, jobId, name, conclusion,
startedAt, completedAt }] } plus optional "endpoints": { <name>: [<pattern>] }.`;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || !args.includes('--run-file')) {
    console.log(usage);
    process.exit(args.includes('--help') ? 0 : 2);
  }
  const file = args[args.indexOf('--run-file') + 1];
  const expectedIndex = args.indexOf('--expected-jobs');
  const expectedJobCount = expectedIndex === -1 ? null : Number(args[expectedIndex + 1]);
  const captured = JSON.parse(fs.readFileSync(file, 'utf8'));
  const summary = summarizeRun(captured.records, { expectedJobCount });
  const readiness = endpointReadiness(captured.records, captured.endpoints ?? {});
  console.log(JSON.stringify({ file, summary, readiness }, null, 2));
}
