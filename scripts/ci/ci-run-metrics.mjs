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

// Deduplicate job rows to distinct executions of one run. GitHub reruns copy
// carried-forward jobs into the new attempt under NEW job IDs with the
// original interval (reference run 39113919235: `changes` is job 117635669586
// in attempt 1 and 117665333718 in attempt 2, both 09:04:44Z to 09:04:52Z),
// so a (runId, jobId) key keeps both copies. Execution identity is
// (runId, name, startedAt, completedAt): rows sharing it count once with the
// highest attempt winning; a fresh execution with a different interval still
// counts separately, as do distinct matrix members (distinct names). Rows
// without timestamps collapse per name: a non-execution is one placeholder.
export function dedupeJobs(records) {
  const seen = new Map();
  let dropped = 0;
  for (const record of records ?? []) {
    const key = `${record?.runId ?? 'unknown'}/${record?.name ?? record?.jobId ?? 'unknown'}/${record?.startedAt ?? 'none'}/${record?.completedAt ?? 'none'}`;
    const attempt = Number.isFinite(record?.attempt) ? record.attempt : 0;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, { record, attempt });
      continue;
    }
    dropped += 1;
    if (attempt > prior.attempt) seen.set(key, { record, attempt });
  }
  return { jobs: [...seen.values()].map((entry) => entry.record), dropped };
}

// Ready-to-dispatch wait: job creation (queued) to execution start, in
// seconds. Falls back to the workflow creation stamp when the row carries
// no queue stamp. Null when unmeasurable or inverted: missing data stays
// missing, never zero.
export function queueSeconds(record, runCreatedAt = null) {
  const queued = toMs(record?.queuedAt ?? record?.createdAt ?? runCreatedAt);
  const start = toMs(record?.startedAt);
  if (queued === null || start === null || start < queued) return null;
  return (start - queued) / 1000;
}

// Distribution of ready-to-dispatch waits over one record set.
export function queueWaits(records, runCreatedAt = null) {
  const waits = [];
  for (const record of records ?? []) {
    const wait = queueSeconds(record, runCreatedAt);
    if (wait !== null) waits.push(wait);
  }
  waits.sort((a, b) => a - b);
  if (waits.length === 0) return { count: 0, minSeconds: null, p50Seconds: null, maxSeconds: null };
  return {
    count: waits.length,
    minSeconds: waits[0],
    p50Seconds: waits[Math.floor(waits.length / 2)],
    maxSeconds: waits[waits.length - 1],
  };
}

// Per-step spans of one job row carrying API steps[]. Conclusions and
// missing stamps pass through unchanged; unmeasurable steps stay null.
export function stepSpans(record) {
  const steps = Array.isArray(record?.steps) ? record.steps : [];
  return steps.map((step) => ({
    name: step?.name ?? 'unknown',
    conclusion: step?.conclusion ?? null,
    seconds: durationSeconds(step?.startedAt, step?.completedAt),
  }));
}

// Runner-minutes over measurable executed spans, grouped by runner identity
// (runnerName, runner, or labels). Skipped and unmeasured rows cost nothing.
export function runnerMinutes(records) {
  let totalSeconds = 0;
  const byRunner = {};
  for (const record of records ?? []) {
    if (record?.conclusion === 'skipped') continue;
    const span = durationSeconds(record?.startedAt, record?.completedAt);
    if (span === null) continue;
    totalSeconds += span;
    const runner = record?.runnerName ?? record?.runner
      ?? (Array.isArray(record?.labels) ? record.labels.join(',') : null) ?? 'unknown';
    byRunner[runner] = (byRunner[runner] ?? 0) + span / 60;
  }
  return { totalMinutes: totalSeconds / 60, byRunner };
}

// Delivery elapsed: workflow creation to each endpoint's last measured
// completion. Complete only when every pattern of the endpoint matches at
// least one measured row; otherwise null (an incomplete delivery has no
// complete timing). Missing durations never contribute.
export function deliveryElapsed(records, runCreatedAt, endpoints = {}) {
  const base = toMs(runCreatedAt);
  const result = {};
  const matches = (record, pattern) =>
    String(record?.name ?? '').toLowerCase().includes(String(pattern).toLowerCase());
  for (const [endpoint, patterns] of Object.entries(endpoints)) {
    if (base === null || !Array.isArray(patterns) || patterns.length === 0) {
      result[endpoint] = { elapsedSeconds: null };
      continue;
    }
    let latest = null;
    let complete = true;
    for (const pattern of patterns) {
      const ends = (records ?? [])
        .filter((record) => matches(record, pattern))
        .map((record) => (durationSeconds(record?.startedAt, record?.completedAt) === null
          ? null
          : toMs(record?.completedAt)))
        .filter((end) => end !== null);
      if (ends.length === 0) {
        complete = false;
        break;
      }
      const member = Math.max(...ends);
      if (latest === null || member > latest) latest = member;
    }
    result[endpoint] = { elapsedSeconds: !complete || latest === null ? null : (latest - base) / 1000 };
  }
  return result;
}

// Cache identities carried by rows (an API capture may attach `cache`).
// Rows without one are listed unknown: cache state stays explicit.
export function cacheIdentities(records) {
  const known = {};
  const unknown = [];
  for (const record of records ?? []) {
    const name = String(record?.name ?? record?.jobId ?? 'unknown');
    if (record?.cache === undefined || record?.cache === null || String(record.cache).trim() === '') {
      unknown.push(name);
    } else {
      known[name] = String(record.cache);
    }
  }
  return { known, unknown };
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
// Half-open execution intervals [start, end): ends sort before starts at the
// same timestamp, so adjacent executions never stack. Skipped rows are
// nonexecutions and zero-duration intervals occupy no worker: both are
// excluded, otherwise a timestamped skipped row or a shared boundary
// inflates the peak (one 60s job plus a skipped row at its end read 2).
export function concurrencyPeak(records) {
  const events = [];
  for (const record of records ?? []) {
    if (record?.conclusion === 'skipped') continue;
    const start = toMs(record?.startedAt);
    const end = toMs(record?.completedAt);
    if (start === null || end === null || end <= start) continue;
    events.push([start, 1]);
    events.push([end, -1]);
  }
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
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
// each endpoint to job-name substrings; matching is case-insensitive. Every
// pattern is a required member: status is measured (each pattern matches at
// least one row and every matched row has a duration), partial (each pattern
// matches but some matched row lacks a duration), missing (at least one
// pattern matches nothing; the absent patterns are listed), or to-measure
// (the endpoint has no mapping yet). A partially captured endpoint never
// reports measured.
export function endpointReadiness(records, endpoints = {}) {
  const result = {};
  const matches = (record, pattern) =>
    String(record?.name ?? '').toLowerCase().includes(String(pattern).toLowerCase());
  for (const [endpoint, patterns] of Object.entries(endpoints)) {
    if (!Array.isArray(patterns) || patterns.length === 0) {
      result[endpoint] = { status: 'to-measure', jobs: [], missing: [] };
      continue;
    }
    const missing = patterns.filter(
      (pattern) => !(records ?? []).some((record) => matches(record, pattern)),
    );
    const matched = (records ?? []).filter((record) => patterns.some((pattern) => matches(record, pattern)));
    const names = matched.map((record) => record?.name ?? String(record?.jobId ?? 'unknown'));
    if (missing.length > 0) {
      result[endpoint] = { status: 'missing', jobs: names, missing: missing.map(String) };
      continue;
    }
    const withDuration = matched.filter(
      (record) => durationSeconds(record?.startedAt, record?.completedAt) !== null,
    );
    result[endpoint] = {
      status: withDuration.length === matched.length ? 'measured' : 'partial',
      jobs: names,
      missing: [],
    };
  }
  return result;
}

const usage = `usage: ci-run-metrics.mjs --run-file <captured-run.json> [--expected-jobs <n>]
Captured file shape: { "records": [{ runId, attempt, jobId, name, conclusion,
startedAt, completedAt, queuedAt?, steps?[{ name, conclusion, startedAt,
completedAt }], runnerName?/runner?/labels?[], cache? }], "runCreatedAt":
<workflow creation stamp> } plus optional "endpoints": { <name>: [<pattern>] }.`;

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
  const { jobs } = dedupeJobs(captured.records);
  const runCreatedAt = captured.runCreatedAt ?? null;
  const summary = summarizeRun(captured.records, { expectedJobCount });
  const readiness = endpointReadiness(jobs, captured.endpoints ?? {});
  const queue = queueWaits(jobs, runCreatedAt);
  const minutes = runnerMinutes(jobs);
  const delivery = deliveryElapsed(jobs, runCreatedAt, captured.endpoints ?? {});
  const cache = cacheIdentities(jobs);
  console.log(JSON.stringify({ file, summary, readiness, queue, runnerMinutes: minutes, delivery, cache }, null, 2));
}
