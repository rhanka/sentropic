// CI optimization Lot 1 measurement: read-only run/job records plus emitted artifacts.
// Deduplicates by run ID, attempt and job ID; strips credentials and payload content.
import fs from 'node:fs';
import path from 'node:path';

const WINDOW_SCHEMA = 'ci-optimization-window/1';
const redactJob = (job) => ({
  jobId: job.jobId ?? job.id ?? null, name: job.name ?? null, attempt: job.attempt ?? 1,
  conclusion: job.conclusion ?? job.result ?? null, startedAt: job.startedAt ?? null,
  completedAt: job.completedAt ?? null, runnerSeconds: job.runnerSeconds ?? null,
  selectedTests: job.selectedTests ?? null, executedTests: job.executedTests ?? null,
});
export const redactRun = (run) => ({
  runId: run.runId ?? run.id, attempt: run.attempt ?? 1, event: run.event ?? null, pr: run.pr ?? null,
  testedSha: run.testedSha ?? run.head ?? null, baseSha: run.baseSha ?? run.base ?? null,
  changeClass: run.changeClass ?? run.class ?? null, conclusion: run.conclusion ?? null,
  createdAt: run.createdAt ?? null, gateAt: run.gateAt ?? null,
  jobs: Array.isArray(run.jobs) ? run.jobs.map(redactJob) : [],
});
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
  const runs = window.runs ?? [];
  const delays = runs.map(gateDelayMinutes).filter((v) => v !== null).sort((a, b) => a - b);
  let runnerSeconds = 0, llmMinutes = 0, failures = 0, cancellations = 0;
  for (const run of runs) {
    if (run.conclusion === 'failure') failures += 1;
    if (run.conclusion === 'cancelled') cancellations += 1;
    for (const job of run.jobs) {
      if (typeof job.runnerSeconds === 'number') runnerSeconds += job.runnerSeconds;
      if (typeof job.llmMinutes === 'number') llmMinutes += job.llmMinutes;
    }
  }
  return {
    runs: runs.length, gateDelays: delays, gateP50: percentile(delays, 50), gateP95: percentile(delays, 95),
    runnerMinutes: runnerSeconds / 60, llmMinutes, failures, cancellations,
  };
};
export const compareWindows = (before, after, limits = {}) => {
  const b = summarizeWindow(before), a = summarizeWindow(after);
  const findings = [];
  const minRuns = limits.minRuns ?? 20;
  if (b.runs < minRuns || a.runs < minRuns) findings.push(`insufficient sample: before=${b.runs} after=${a.runs} minimum=${minRuns}`);
  const missing = (w) => (w.runs ?? []).filter((r) => (r.jobs ?? []).some((j) => j.conclusion === null)).length;
  if (missing(after) > 0) findings.push(`missing required results in after window: ${missing(after)} runs`);
  if (a.failures > 0 && b.failures === 0) findings.push(`after window introduces failures: ${a.failures}`);
  if (b.gateP95 !== null && a.gateP95 !== null && b.gateP95 > 0 && (a.gateP95 - b.gateP95) / b.gateP95 > 0.1) {
    findings.push(`gate p95 regression ${(((a.gateP95 - b.gateP95) / b.gateP95) * 100).toFixed(1)}% above 10%`);
  }
  return { verdict: findings.length === 0 ? 'pass' : (b.runs < minRuns || a.runs < minRuns ? 'pending' : 'fail'), findings, before: b, after: a };
};
const readJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
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
    const input = args.runs ? readJson(args.runs) : [];
    const runs = dedupeRuns(Array.isArray(input) ? input : (input.runs ?? []));
    const minRuns = Number(args['min-runs'] ?? 20);
    const window = {
      schema: WINDOW_SCHEMA, window: args.window ?? 'before', collectedAt: new Date().toISOString(),
      minRuns, minDays: Number(args['min-days'] ?? 7), complete: runs.length >= minRuns, runs,
    };
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(window, null, 2)}\n`);
    console.log(`collected ${runs.length} runs window=${window.window} complete=${window.complete} -> ${args.out}`);
  } else if (command === 'compare') {
    const result = compareWindows(readJson(args.before), readJson(args.after), { minRuns: 20 });
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`verdict=${result.verdict} -> ${args.out}`);
    for (const finding of result.findings) console.log(`- ${finding}`);
    process.exit(result.verdict === 'pass' ? 0 : 1);
  } else {
    console.error('usage: measure-runs.mjs collect [--runs <json>] --window <n> --min-runs <n> --min-days <n> --out <file>');
    console.error('       measure-runs.mjs compare --before <file> --after <file> --out <file>');
    process.exit(2);
  }
};
if (import.meta.url === `file://${process.argv[1]}`) main();
