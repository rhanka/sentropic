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

// Accept the retained Jobs API capture as well as normalized fixture records.
export function captureRecords(captured) {
  if (Array.isArray(captured.records)) return captured.records;
  if (!Array.isArray(captured.jobs) || !captured.run) throw new Error('Missing run/jobs capture');
  return captured.jobs.map((row) => ({
    runId: row.run_id, attempt: row.run_attempt, jobId: row.id, name: row.name,
    conclusion: row.conclusion, queuedAt: row.created_at,
    startedAt: row.started_at, completedAt: row.completed_at, labels: row.labels,
    headSha: row.head_sha ?? captured.run.head_sha ?? null,
    headBranch: row.head_branch ?? captured.run.head_branch ?? null,
    runnerName: row.runner_name || undefined,
    steps: row.steps?.map((step) => ({ name: step.name, number: step.number,
      conclusion: step.conclusion, startedAt: step.started_at, completedAt: step.completed_at })),
  }));
}

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
// seconds. Workflow creation includes upstream execution and is never a
// readiness substitute. Skipped rows have no runner queue measurement.
export function queueSeconds(record) {
  if (record?.conclusion === 'skipped') return null;
  const queued = toMs(record?.queuedAt ?? record?.createdAt);
  const start = toMs(record?.startedAt);
  if (queued === null || start === null || start < queued) return null;
  return (start - queued) / 1000;
}

// Distribution of ready-to-dispatch waits over one record set.
export function queueWaits(records) {
  const waits = [];
  for (const record of records ?? []) {
    const wait = queueSeconds(record);
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

// Follow the last-finishing dependency at each join in the observed DAG.
// The receipt sums readiness waits on that path, retaining every execution ID.
// A maximum single-job wait is not an aggregate scheduling measurement.
export function criticalPathScheduling(records, dependencies = {}, endpoints = {}) {
  const memo = new Map();
  const visiting = new Set();
  const visit = (name) => {
    if (memo.has(name)) return memo.get(name);
    if (!Array.isArray(dependencies[name]) || visiting.has(name)) return null;
    visiting.add(name);
    const parents = dependencies[name].map(visit);
    const rows = records.filter(row => row.name === name || row.name?.startsWith(`${name} (`));
    const executed = rows.filter(row => row.conclusion !== 'skipped');
    let result = null;
    if (rows.length && parents.every(Boolean)) {
      const parent = parents.sort((a, b) => b.end - a.end)[0] ?? { end: 0, jobs: [] };
      if (!executed.length) result = parent;
      else if (executed.every(row => durationSeconds(row.startedAt, row.completedAt) !== null)) {
        const last = executed.sort((a, b) => toMs(b.completedAt) - toMs(a.completedAt))[0];
        result = { end: toMs(last.completedAt), jobs: [...parent.jobs, last] };
      }
    }
    visiting.delete(name);
    memo.set(name, result);
    return result;
  };
  return Object.fromEntries(Object.entries(endpoints).map(([endpoint, names]) => {
    const paths = names.map(visit);
    const executed = names.every(name => records.some(row => (row.name === name || row.name?.startsWith(`${name} (`))
      && row.conclusion !== 'skipped'));
    const path = executed && paths.length && paths.every(Boolean) ? paths.sort((a, b) => b.end - a.end)[0] : null;
    const jobs = path?.jobs.map(row => ({ key: jobKey(row), runId: row.runId,
      attempt: row.attempt, jobId: row.jobId, name: row.name, queueSeconds: queueSeconds(row) })) ?? [];
    const measured = jobs.length > 0 && jobs.every(row => row.queueSeconds !== null);
    return [endpoint, { seconds: measured ? jobs.reduce((sum, row) => sum + row.queueSeconds, 0) : null, jobs }];
  }));
}

// Per-step spans of one job row carrying API steps[]. Conclusions and
// missing stamps pass through unchanged; unmeasurable steps stay null.
export function stepSpans(record) {
  const steps = Array.isArray(record?.steps) ? record.steps : [];
  return steps.map((step) => ({
    name: step?.name ?? 'unknown',
    conclusion: step?.conclusion ?? null,
    number: step?.number ?? null,
    seconds: step?.conclusion === 'skipped' ? null : durationSeconds(step?.startedAt, step?.completedAt),
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
  const readiness = endpointReadiness(records, endpoints);
  const matches = (record, pattern) =>
    String(record?.name ?? '').toLowerCase().includes(String(pattern).toLowerCase());
  for (const [endpoint, patterns] of Object.entries(endpoints)) {
    const status = readiness[endpoint].status;
    if (base === null || status !== 'measured') {
      result[endpoint] = { status, elapsedSeconds: null };
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
    result[endpoint] = { status, elapsedSeconds: !complete || latest === null ? null : (latest - base) / 1000 };
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
// Skipped rows are nonexecutions and timestamp gaps never widen a contention
// window: only measured executed intervals contribute.
export function overlappingSeconds(aRecords, bRecords) {
  const window = (records) => {
    const starts = [];
    const ends = [];
    for (const record of records ?? []) {
      if (record?.conclusion === 'skipped') continue;
      const start = toMs(record?.startedAt);
      const end = toMs(record?.completedAt);
      if (start === null || end === null || end < start) continue;
      starts.push(start);
      ends.push(end);
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

// Measured-slot admission: evaluate observed demand against declared capacity.
// availableSlots comes from the owner-supplied quota inventory (or a measured
// lower bound recorded in capacity.md); reserveSlots holds release lanes.
// Missing inputs stay to-measure, never zero: no admission claim without them.
export function admissionDecision({ peak, availableSlots = null, reserveSlots = 0 } = {}) {
  const slots = Number.isFinite(availableSlots) ? availableSlots : null;
  const reserve = Number.isFinite(reserveSlots) ? reserveSlots : 0;
  const demand = Number.isFinite(peak) ? peak : null;
  if (slots === null || demand === null) {
    return { status: 'to-measure', peak: demand, availableSlots: slots, reserveSlots: reserve, headroom: null };
  }
  const headroom = slots - reserve - demand;
  return { status: headroom >= 0 ? 'admitted' : 'over-capacity',
    peak: demand, availableSlots: slots, reserveSlots: reserve, headroom };
}

// Declared timing budgets in seconds: classification <= 15, verdict <= 5,
// aggregate critical-path scheduling <= 60 under declared concurrent traffic.
// Missing observations stay to-measure; a breach retains its observed value.
export const CAPACITY_BUDGETS = { classificationSeconds: 15, verdictSeconds: 5, schedulingSeconds: 60 };

export function budgetVerdict({ classificationSeconds = null, verdictSeconds = null, schedulingSeconds = null } = {}) {
  const observed = { classificationSeconds, verdictSeconds, schedulingSeconds };
  const budgets = {};
  for (const [key, budget] of Object.entries(CAPACITY_BUDGETS)) {
    const value = observed[key];
    budgets[key] = { budget, observed: Number.isFinite(value) ? value : null,
      status: !Number.isFinite(value) ? 'to-measure' : (value <= budget ? 'pass' : 'breach') };
  }
  const statuses = Object.values(budgets).map((entry) => entry.status);
  return { budgets, ok: statuses.every((status) => status === 'pass'),
    pending: statuses.some((status) => status === 'to-measure') };
}

// Cancellation ownership: every cancelled row retains its run/attempt/job
// identity so a superseded PR attempt stays distinguishable from the current
// release. A cancellation below its run's latest attempt is superseded, and
// so is a cancellation from a run superseded by a newer head on the same
// ref: PR supersession creates a new run per head (same attempt number), so
// attempt comparison alone cannot see it. Rows carry headSha/headBranch from
// the Jobs API; an explicit run context may override them. A cancellation in
// the latest attempt of the latest run is current; a cancelled row without an
// identified attempt is unidentified and blocks ownership.
export function cancellationOwnership(records, context = {}) {
  const runs = new Map();
  const runMeta = (record) => {
    const run = record?.runId ?? 'unknown';
    if (!runs.has(run)) runs.set(run, { attempts: [], headShas: new Set(), headBranches: new Set() });
    return runs.get(run);
  };
  for (const record of records ?? []) {
    const meta = runMeta(record);
    if (Number.isFinite(record?.attempt)) meta.attempts.push(record.attempt);
    if (record?.headSha != null) meta.headShas.add(String(record.headSha));
    if (record?.headBranch != null) meta.headBranches.add(String(record.headBranch));
  }
  for (const [run, override] of Object.entries(context?.runs ?? {})) {
    const meta = runMeta({ runId: Number.isFinite(Number(run)) ? Number(run) : run });
    if (override?.headSha != null) meta.headShas.add(String(override.headSha));
    if (override?.headBranch != null) meta.headBranches.add(String(override.headBranch));
    if (override?.createdAt != null) meta.createdAt = override.createdAt;
  }
  const branchOf = (run) => {
    const branches = [...(runs.get(run)?.headBranches ?? [])];
    return branches.length === 1 ? branches[0] : null;
  };
  const orderOf = (run) => {
    const created = toMs(runs.get(run)?.createdAt);
    return created ?? (Number.isFinite(run) ? run : null);
  };
  const latestAttempt = new Map([...runs].map(([run, meta]) =>
    [run, meta.attempts.length > 0 ? Math.max(...meta.attempts) : null]));
  const latestRunByBranch = new Map();
  for (const run of runs.keys()) {
    const branch = branchOf(run) ?? `run:${String(run)}`;
    const order = orderOf(run);
    const prior = latestRunByBranch.get(branch);
    if (!prior || (order !== null && (prior.order === null || order > prior.order))) {
      latestRunByBranch.set(branch, { run, order });
    }
  }
  const cancelled = [];
  let superseded = 0;
  let unidentified = 0;
  for (const record of records ?? []) {
    if (record?.conclusion !== 'cancelled') continue;
    const attempt = Number.isFinite(record?.attempt) ? record.attempt : null;
    if (attempt === null) {
      unidentified += 1;
      cancelled.push({ key: jobKey(record), ownership: 'unidentified' });
      continue;
    }
    const run = record?.runId ?? 'unknown';
    const rerunSuperseded = latestAttempt.get(run) !== null && attempt < latestAttempt.get(run);
    const branch = branchOf(run) ?? `run:${String(run)}`;
    const crossRunSuperseded = branch !== 'main' && latestRunByBranch.get(branch)?.run !== run;
    const ownership = rerunSuperseded || crossRunSuperseded ? 'superseded' : 'current';
    if (ownership === 'superseded') superseded += 1;
    cancelled.push({ key: jobKey(record), runId: record.runId, attempt,
      headSha: record?.headSha ?? [...(runs.get(run)?.headShas ?? [])][0] ?? null,
      ownership });
  }
  return { cancelled, cancelledCount: cancelled.length, superseded, unidentified };
}

// Release continuity: rollback and cancellation never stop the current
// release. Every release endpoint must be measured (each mapped member with
// a duration) AND successful: readiness measures timestamp coverage, not the
// conclusion, so a completed failure or cancellation reads measured but is
// an interruption. Duration measurements stay in readiness; continuity
// requires successful identified results.
export function releaseContinuity(records, endpoints = {}) {
  const readiness = endpointReadiness(records, endpoints);
  const matches = (record, pattern) =>
    String(record?.name ?? '').toLowerCase().includes(String(pattern).toLowerCase());
  const perEndpoint = {};
  for (const [endpoint, state] of Object.entries(readiness)) {
    const patterns = endpoints[endpoint];
    const matched = Array.isArray(patterns) && patterns.length > 0
      ? (records ?? []).filter((record) => patterns.some((pattern) => matches(record, pattern)))
      : [];
    const successful = matched.length > 0 && matched.every((record) => record?.conclusion === 'success');
    perEndpoint[endpoint] = { status: state.status, continuous: state.status === 'measured' && successful };
  }
  return { continuous: Object.values(perEndpoint).every((entry) => entry.continuous),
    endpoints: perEndpoint };
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
// reports measured. All-skipped endpoints are explicitly unselected;
// mixed executed/skipped endpoints are partial regardless of API timestamps.
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
    if (matched.every((record) => record?.conclusion === 'skipped')) {
      result[endpoint] = { status: 'unselected', jobs: names, missing: [] };
      continue;
    }
    const withDuration = matched.filter(
      (record) => record?.conclusion !== 'skipped'
        && durationSeconds(record?.startedAt, record?.completedAt) !== null,
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
<workflow creation stamp> } plus optional "endpoints": { <name>: [<pattern>] },
"capacity": { availableSlots?, reserveSlots? }, and "timings":
{ classificationSeconds?, verdictSeconds? }.`;

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
  const records = captureRecords(captured);
  const { jobs } = dedupeJobs(records);
  const runCreatedAt = captured.runCreatedAt ?? captured.run?.created_at ?? null;
  const summary = summarizeRun(records, { expectedJobCount });
  const readiness = endpointReadiness(jobs, captured.endpoints ?? {});
  const queue = queueWaits(jobs);
  const minutes = runnerMinutes(jobs);
  const delivery = deliveryElapsed(jobs, runCreatedAt, captured.endpoints ?? {});
  const cache = cacheIdentities(jobs);
  const capacity = captured.capacity ?? {};
  const admission = admissionDecision({ peak: summary.concurrencyPeak,
    availableSlots: capacity.availableSlots ?? null, reserveSlots: capacity.reserveSlots ?? 0 });
  const timings = captured.timings ?? {};
  const scheduling = criticalPathScheduling(jobs, captured.dependencies, captured.endpoints);
  const waits = Object.entries(scheduling).filter(([name]) => captured.endpoints[name].length > 0).map(([, row]) => row.seconds);
  const budgets = budgetVerdict({ classificationSeconds: timings.classificationSeconds ?? null,
    verdictSeconds: timings.verdictSeconds ?? null,
    schedulingSeconds: waits.length && waits.every(value => value !== null) ? Math.max(...waits) : null });
  const cancellation = cancellationOwnership(jobs);
  const continuity = releaseContinuity(jobs, captured.endpoints ?? {});
  const identity = { sourceSha: captured.sourceSha ?? captured.run?.head_sha ?? null,
    workflowSha: captured.workflowSha ?? null };
  const executions = jobs.map((record) => ({
    key: jobKey(record), runId: record.runId, attempt: record.attempt, jobId: record.jobId,
    name: record.name, conclusion: record.conclusion,
    headSha: record.headSha ?? null, headBranch: record.headBranch ?? null,
    startedAt: record.startedAt ?? null, completedAt: record.completedAt ?? null,
    seconds: record.conclusion === 'skipped' ? null : durationSeconds(record.startedAt, record.completedAt),
    queueSeconds: queueSeconds(record), steps: stepSpans(record),
  }));
  console.log(JSON.stringify({ file, identity, summary, readiness, queue, runnerMinutes: minutes, delivery, cache,
    admission, budgets, scheduling, cancellation, continuity, executions }, null, 2));
}
