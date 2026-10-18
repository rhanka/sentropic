// CI optimization Lot 1 measurement: read-only run/job records plus emitted artifacts.
// Deduplicates by run ID, attempt and job ID; strips credentials and payload content;
// fails closed on missing job inventories, missing gate timestamps or masked shard failures.
import fs from 'node:fs';
import path from 'node:path';

const WINDOW_SCHEMA = 'ci-optimization-window/1';

export const redactJob = (job) => {
  const startedAt = job.startedAt ?? job.started_at ?? null;
  const completedAt = job.completedAt ?? job.completed_at ?? null;
  const durationSec =
    startedAt && completedAt && Date.parse(completedAt) >= Date.parse(startedAt)
      ? (Date.parse(completedAt) - Date.parse(startedAt)) / 1000
      : null;
  const runnerSeconds = typeof job.runnerSeconds === 'number' ? job.runnerSeconds : durationSec;
  const name = job.name ?? null;
  const derivedLlm =
    typeof runnerSeconds === 'number' && typeof name === 'string' && /\b(ai|test-e2e|e2e-vscode)\b/i.test(name)
      ? runnerSeconds / 60
      : 0;
  const llmMinutes =
    typeof job.llmMinutes === 'number'
      ? job.llmMinutes
      : typeof job.llm_minutes === 'number'
        ? job.llm_minutes
        : derivedLlm;
  return {
    jobId: job.jobId ?? job.id ?? null,
    name,
    attempt: job.attempt ?? job.run_attempt ?? 1,
    conclusion: job.conclusion ?? job.result ?? null,
    startedAt,
    completedAt,
    runnerSeconds,
    llmMinutes,
    selectedTests: job.selectedTests ?? job.selected_tests ?? null,
    executedTests: job.executedTests ?? job.executed_tests ?? null,
  };
};

export const redactRun = (run) => {
  const jobs = Array.isArray(run.jobs) ? run.jobs.map(redactJob) : [];
  const gateJob = jobs.find((j) => j.name === 'ci-gate');
  return {
    runId: run.runId ?? run.id ?? null,
    attempt: run.attempt ?? run.run_attempt ?? 1,
    event: run.event ?? null,
    pr: run.pr ?? run.pull_requests?.[0]?.number ?? null,
    testedSha: run.testedSha ?? run.head ?? run.head_sha ?? null,
    baseSha: run.baseSha ?? run.base ?? run.base_sha ?? null,
    changeClass: run.changeClass ?? run.class ?? null,
    conclusion: run.conclusion ?? null,
    createdAt: run.createdAt ?? run.created_at ?? run.run_started_at ?? null,
    gateAt: run.gateAt ?? run.gate_at ?? gateJob?.completedAt ?? null,
    jobs,
  };
};

export const dedupeRuns = (runs) => {
  const merged = new Map();
  for (const run of runs.map(redactRun)) {
    const key = `${run.runId}/${run.attempt}`;
    if (!merged.has(key)) merged.set(key, { ...run, jobs: [] });
    const target = merged.get(key);
    for (const job of run.jobs) {
      const id = `${key}/${job.jobId ?? job.name}`;
      if (!target.jobs.some((j) => `${key}/${j.jobId ?? j.name}` === id)) target.jobs.push(job);
    }
    if (!target.gateAt) {
      const gateJob = target.jobs.find((j) => j.name === 'ci-gate');
      if (gateJob?.completedAt) target.gateAt = gateJob.completedAt;
    }
  }
  return [...merged.values()];
};

export const gateDelayMinutes = (run) => {
  if (!run.createdAt || !run.gateAt) return null;
  const ms = Date.parse(run.gateAt) - Date.parse(run.createdAt);
  return Number.isFinite(ms) && ms >= 0 ? ms / 60000 : null;
};

const percentile = (sorted, p) => {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))];
};

export const summarizeWindow = (window) => {
  const runs = (window.runs ?? []).map(redactRun);
  const delays = runs.map(gateDelayMinutes).filter((v) => v !== null).sort((a, b) => a - b);
  const createdTimes = runs.map((r) => Date.parse(r.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const spanDays =
    typeof window.spanDays === 'number'
      ? window.spanDays
      : createdTimes.length >= 2
        ? (createdTimes[createdTimes.length - 1] - createdTimes[0]) / 86400000
        : 0;
  let runnerSeconds = 0, llmMinutes = 0, failures = 0, cancellations = 0;
  let emptyJobRuns = 0, missingGateRuns = 0, missingJobResultRuns = 0, maskedFailureRuns = 0;
  for (const run of runs) {
    if (run.conclusion === 'failure') failures += 1;
    if (run.conclusion === 'cancelled') cancellations += 1;
    if (run.jobs.length === 0) emptyJobRuns += 1;
    if (run.conclusion === 'success' && gateDelayMinutes(run) === null) missingGateRuns += 1;
    if (run.jobs.some((j) => j.conclusion === null)) missingJobResultRuns += 1;
    if (run.conclusion === 'success' && run.jobs.some((j) => j.conclusion === 'failure' || j.conclusion === 'cancelled')) {
      maskedFailureRuns += 1;
    }
    for (const job of run.jobs) {
      if (typeof job.runnerSeconds === 'number') runnerSeconds += job.runnerSeconds;
      if (typeof job.llmMinutes === 'number') llmMinutes += job.llmMinutes;
    }
  }
  return {
    runs: runs.length, spanDays, gateDelays: delays, gateP50: percentile(delays, 50), gateP95: percentile(delays, 95),
    runnerMinutes: runnerSeconds / 60, llmMinutes, failures, cancellations,
    emptyJobRuns, missingGateRuns, missingJobResultRuns, maskedFailureRuns,
  };
};

export const compareWindows = (before, after, limits = {}) => {
  const b = summarizeWindow(before), a = summarizeWindow(after);
  const errors = [], pending = [];
  const minRuns = limits.minRuns ?? before.minRuns ?? after.minRuns ?? 20;
  const minDays = limits.minDays ?? before.minDays ?? after.minDays ?? 7;
  if (b.emptyJobRuns > 0 || a.emptyJobRuns > 0) errors.push(`empty job inventory: before=${b.emptyJobRuns} after=${a.emptyJobRuns}`);
  if (b.missingGateRuns > 0 || a.missingGateRuns > 0) errors.push(`missing gate timestamps on successful runs: before=${b.missingGateRuns} after=${a.missingGateRuns}`);
  if (b.missingJobResultRuns > 0 || a.missingJobResultRuns > 0) errors.push(`missing required results: before=${b.missingJobResultRuns} after=${a.missingJobResultRuns}`);
  if (b.maskedFailureRuns > 0 || a.maskedFailureRuns > 0) errors.push(`failed or cancelled job behind successful run: before=${b.maskedFailureRuns} after=${a.maskedFailureRuns}`);
  if (before.studyBaseline && after.studyBaseline && before.studyBaseline !== after.studyBaseline) {
    errors.push(`mismatched studyBaseline: before=${before.studyBaseline} after=${after.studyBaseline}`);
  }
  if (a.failures > 0 && b.failures === 0) errors.push(`after window introduces failures: ${a.failures}`);
  if (b.runs >= minRuns && a.runs >= minRuns) {
    if (b.gateP50 === null || a.gateP50 === null || b.gateP95 === null || a.gateP95 === null) errors.push('missing gate percentiles on full sample');
    if (b.runnerMinutes <= 0 || a.runnerMinutes <= 0) errors.push(`non-positive runner minutes: before=${b.runnerMinutes} after=${a.runnerMinutes}`);
  }
  if (b.gateP95 !== null && a.gateP95 !== null && b.gateP95 > 0 && (a.gateP95 - b.gateP95) / b.gateP95 > 0.1) {
    errors.push(`gate p95 regression ${(((a.gateP95 - b.gateP95) / b.gateP95) * 100).toFixed(1)}% above 10%`);
  }
  if (b.runs < minRuns || a.runs < minRuns) pending.push(`insufficient sample: before=${b.runs} after=${a.runs} minimum=${minRuns}`);
  if (b.spanDays < minDays || a.spanDays < minDays) pending.push(`insufficient window duration: before=${b.spanDays.toFixed(1)}d after=${a.spanDays.toFixed(1)}d minimum=${minDays}d`);
  const verdict = errors.length > 0 ? 'fail' : (pending.length > 0 ? 'pending' : 'pass');
  return { verdict, findings: [...errors, ...pending], before: b, after: a };
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1] ?? null; i += 1; }
  }
  return out;
};

const main = () => {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === 'collect') {
    if (!args.runs || !fs.existsSync(args.runs)) {
      console.error('error: --runs <file> is required and must exist');
      process.exit(1);
    }
    const input = readJson(args.runs);
    const runs = dedupeRuns(Array.isArray(input) ? input : (input.runs ?? []));
    const minRuns = Number(args['min-runs'] ?? 20);
    const minDays = Number(args['min-days'] ?? 7);
    const summary = summarizeWindow({ runs });
    const window = {
      schema: WINDOW_SCHEMA, window: args.window ?? 'before', collectedAt: new Date().toISOString(),
      studyBaseline: input.studyBaseline ?? 'fb5e92a6ae4928066e181716fdffbfb490b0b4f3',
      minRuns, minDays, spanDays: summary.spanDays,
      complete: runs.length >= minRuns && summary.spanDays >= minDays && summary.emptyJobRuns === 0 && summary.missingGateRuns === 0,
      runs,
    };
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(window, null, 2)}\n`);
    console.log(`collected ${runs.length} runs window=${window.window} complete=${window.complete} -> ${args.out}`);
  } else if (command === 'compare') {
    const result = compareWindows(readJson(args.before), readJson(args.after), { minRuns: 20, minDays: 7 });
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`verdict=${result.verdict} -> ${args.out}`);
    for (const finding of result.findings) console.log(`- ${finding}`);
    process.exit(result.verdict === 'pass' ? 0 : 1);
  } else {
    console.error('usage: measure-runs.mjs collect --runs <json> --window <n> --min-runs <n> --min-days <n> --out <file>');
    console.error('       measure-runs.mjs compare --before <file> --after <file> --out <file>');
    process.exit(2);
  }
};
if (import.meta.url === `file://${process.argv[1]}`) main();
