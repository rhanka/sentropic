// CI optimization Lot 1 measurement: read-only run/job records plus emitted artifacts.
// Deduplicates by run ID, attempt and job ID; strips credentials and payload content;
// fails closed on incomplete job/test inventories, non-success ci-gate, missing identities, reused runs or skewed cohorts.
import fs from 'node:fs';
import path from 'node:path';
import { JOB_FILTERS, SELECTION_KEYS, VALIDATE_OUTPUTS, requiredSuccessJobs } from './filter-consumers.mjs';

const WINDOW_SCHEMA = 'ci-optimization-window/1';
const ALL_FALSE_OUTPUTS = Object.freeze(Object.fromEntries(SELECTION_KEYS.map((k) => [k, 'false'])));
const OPTIONAL_PR_JOBS = new Set([...Object.keys(JOB_FILTERS), ...Object.keys(VALIDATE_OUTPUTS), 'enforce-package-bump']);

export const API_MATRIX_VARIANTS = [
  { id: 'smoke', isAi: false, re: /^test-api-unit-integration\s*\(smoke\)$/ },
  { id: 'unit', isAi: false, re: /^test-api-unit-integration\s*\(unit\)$/ },
  { id: 'queue', isAi: false, re: /^test-api-unit-integration\s*\(queue\)$/ },
  { id: 'ai-1', isAi: true, re: /^test-api-unit-integration\s*(?:\(ai(?:,\s*chat-sync,executive-summary-auto,comment-assistant|[,\s#-]+1)\)|#3)$/ },
  { id: 'ai-2', isAi: true, re: /^test-api-unit-integration\s*(?:\(ai(?:,\s*initiative-generation-async,executive-summary-sync|[,\s#-]+2)\)|#4)$/ },
  { id: 'ai-3', isAi: true, re: /^test-api-unit-integration\s*(?:\(ai(?:,\s*chat-tools,company-enrichment-sync,documents-tool,initiative-generation-sync|[,\s#-]+3)\)|#5)$/ },
  { id: 'security', isAi: false, re: /^test-api-unit-integration\s*\(security\)$/ },
  { id: 'limit', isAi: false, re: /^test-api-unit-integration\s*\(limit\)$/ },
  { id: 'artifact-store', isAi: false, re: /^test-api-unit-integration\s*\(artifact-store\)$/ },
  { id: 'object-registry', isAi: false, re: /^test-api-unit-integration\s*\(object-registry\)$/ },
  { id: 'outbox', isAi: false, re: /^test-api-unit-integration\s*\(outbox\)$/ },
  { id: 'endpoints-1', isAi: false, re: /^test-api-unit-integration\s*\(endpoints(?:[,\s-]+(?:shard\s*)?1)\)$/ },
  { id: 'endpoints-2', isAi: false, re: /^test-api-unit-integration\s*\(endpoints(?:[,\s-]+(?:shard\s*)?2)\)$/ },
  { id: 'endpoints-3', isAi: false, re: /^test-api-unit-integration\s*\(endpoints(?:[,\s-]+(?:shard\s*)?3)\)$/ },
  { id: 'endpoints-4', isAi: false, re: /^test-api-unit-integration\s*\(endpoints(?:[,\s-]+(?:shard\s*)?4)\)$/ },
];

export const E2E_MATRIX_VARIANTS = [
  { id: 'group-a', re: /^test-e2e\s*\(group-a(?:,\s*00 02 06 10)?\)$/ },
  { id: 'group-b', re: /^test-e2e\s*\(group-b(?:,\s*01 04)?\)$/ },
  { id: 'group-c', re: /^test-e2e\s*\(group-c(?:,\s*03)?\)$/ },
  { id: 'group-d', re: /^test-e2e\s*\(group-d(?:,\s*08 09)?\)$/ },
  { id: 'group-e', re: /^test-e2e\s*\(group-e(?:,\s*05 07)?\)$/ },
];

export const outputsForChangeClass = (changeClass) => {
  if (typeof changeClass !== 'string' || changeClass.trim() === '') return null;
  const tokens = changeClass.split(/[+,]/).map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const outputs = { ...ALL_FALSE_OUTPUTS };
  for (const token of tokens) {
    if (token === 'docs') continue;
    if (!SELECTION_KEYS.includes(token)) return null;
    outputs[token] = 'true';
  }
  return outputs;
};

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
  const validGateAt = gateJob?.conclusion === 'success' ? (run.gateAt ?? run.gate_at ?? gateJob.completedAt ?? null) : (run.gateAt ?? run.gate_at ?? null);
  return {
    workflow: run.workflow ?? run.name ?? null,
    workflowId: run.workflowId ?? run.workflow_id ?? null,
    runId: run.runId ?? run.id ?? null,
    attempt: run.attempt ?? run.run_attempt ?? 1,
    event: run.event ?? null,
    pr: run.pr ?? run.pull_requests?.[0]?.number ?? null,
    testedSha: run.testedSha ?? run.head ?? run.head_sha ?? null,
    baseSha: run.baseSha ?? run.base ?? run.base_sha ?? null,
    changeClass: run.changeClass ?? run.class ?? null,
    conclusion: run.conclusion ?? null,
    createdAt: run.createdAt ?? run.created_at ?? run.run_started_at ?? null,
    gateAt: validGateAt,
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
      const gateJob = target.jobs.find((j) => j.name === 'ci-gate' && j.conclusion === 'success');
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

const hasPositiveCounts = (j, needLlm = false) =>
  Number.isInteger(j.selectedTests) && j.selectedTests > 0 &&
  Number.isInteger(j.executedTests) && j.executedTests >= j.selectedTests &&
  (!needLlm || (typeof j.llmMinutes === 'number' && j.llmMinutes > 0));

const jobBaseName = (name) => (typeof name === 'string' ? name.replace(/\s*\(.*\)$|#\d+$/, '') : '');

const isJustifiedSkip = (job, run, outputs, requiredSet) => {
  const base = jobBaseName(job.name);
  if (!base || base === 'ci-gate' || requiredSet.has(base)) return false;
  if (OPTIONAL_PR_JOBS.has(base)) return true;
  if (base === 'bootstrap-publish') return run.event === 'pull_request' || run.event === 'push';
  if (run.event === 'pull_request') {
    return base.startsWith('publish-') || base === 'deploy-preprod' || base === 'verify-train-lock-integrity';
  }
  if (run.event === 'push' && outputs) {
    const api = outputs.api === 'true' || outputs.global === 'true';
    const ui = outputs.ui === 'true' || outputs.global === 'true';
    if (base === 'publish-api-image' || base === 'publish-api-main-image') return !api;
    if (base === 'publish-ui-image') return !ui;
    if (base === 'deploy-preprod') return !api && !ui;
    if (base.startsWith('publish-') || base === 'verify-train-lock-integrity') return true;
  }
  return false;
};

const hasCompleteRunInventory = (run) => {
  const outputs = outputsForChangeClass(run.changeClass);
  if (!outputs || (run.event !== 'pull_request' && run.event !== 'push')) return false;
  const required = [...requiredSuccessJobs(outputs, { eventName: run.event }), 'ci-gate'];
  for (const reqJob of required) {
    if (reqJob === 'test-api-unit-integration') {
      for (const v of API_MATRIX_VARIANTS) {
        const m = run.jobs.filter((j) => typeof j.name === 'string' && v.re.test(j.name));
        if (m.length === 0 || m.some((j) => j.conclusion !== 'success' || !hasPositiveCounts(j, v.isAi))) return false;
      }
    } else if (reqJob === 'test-e2e') {
      for (const v of E2E_MATRIX_VARIANTS) {
        const m = run.jobs.filter((j) => typeof j.name === 'string' && v.re.test(j.name));
        if (m.length === 0 || m.some((j) => j.conclusion !== 'success' || !hasPositiveCounts(j, true))) return false;
      }
    } else {
      const m = run.jobs.filter((j) => j.name === reqJob);
      if (m.length === 0 || m.some((j) => j.conclusion !== 'success')) return false;
      if (reqJob === 'e2e-vscode' && m.some((j) => !hasPositiveCounts(j, true))) return false;
    }
  }
  return true;
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
  let emptyJobRuns = 0, missingGateRuns = 0, missingJobResultRuns = 0, maskedFailureRuns = 0, nonCiWorkflowRuns = 0;
  let missingIdentityRuns = 0, incompleteInventoryRuns = 0;
  const events = new Set(), classes = new Set(), eventCounts = {}, classCounts = {}, runIds = [];
  for (const run of runs) {
    if (run.runId !== null && run.runId !== undefined) runIds.push(String(run.runId));
    if (run.workflow !== 'CI') nonCiWorkflowRuns += 1;
    const outputs = outputsForChangeClass(run.changeClass);
    const validIdentity =
      run.runId !== null && run.runId !== undefined && run.workflow === 'CI' &&
      (run.event === 'pull_request' || run.event === 'push') &&
      typeof run.testedSha === 'string' && run.testedSha.length >= 7 &&
      typeof run.baseSha === 'string' && run.baseSha.length >= 7 &&
      outputs !== null &&
      typeof run.createdAt === 'string' && Number.isFinite(Date.parse(run.createdAt));
    if (!validIdentity) missingIdentityRuns += 1;
    if (run.event) { events.add(run.event); eventCounts[run.event] = (eventCounts[run.event] ?? 0) + 1; }
    if (run.changeClass) { classes.add(run.changeClass); classCounts[run.changeClass] = (classCounts[run.changeClass] ?? 0) + 1; }
    if (run.conclusion === 'failure') failures += 1;
    if (run.conclusion === 'cancelled') cancellations += 1;
    if (run.jobs.length === 0) emptyJobRuns += 1;
    const gateJob = run.jobs.find((j) => j.name === 'ci-gate');
    if (run.conclusion === 'success' && (gateDelayMinutes(run) === null || !gateJob || gateJob.conclusion !== 'success')) {
      missingGateRuns += 1;
    }
    if (run.jobs.some((j) => j.conclusion === null)) missingJobResultRuns += 1;
    const requiredSet = new Set(
      outputs && (run.event === 'pull_request' || run.event === 'push')
        ? [...requiredSuccessJobs(outputs, { eventName: run.event }), 'ci-gate']
        : ['ci-gate'],
    );
    if (run.conclusion === 'success' && run.jobs.some((j) => j.conclusion !== 'success' && !(j.conclusion === 'skipped' && isJustifiedSkip(j, run, outputs, requiredSet)))) {
      maskedFailureRuns += 1;
    }
    if (run.conclusion === 'success' && !hasCompleteRunInventory(run)) {
      incompleteInventoryRuns += 1;
    }
    for (const job of run.jobs) {
      if (typeof job.runnerSeconds === 'number') runnerSeconds += job.runnerSeconds;
      if (typeof job.llmMinutes === 'number') llmMinutes += job.llmMinutes;
    }
  }
  return {
    runs: runs.length, spanDays, gateDelays: delays, gateP50: percentile(delays, 50), gateP95: percentile(delays, 95),
    runnerMinutes: runnerSeconds / 60, llmMinutes, failures, cancellations,
    emptyJobRuns, missingGateRuns, missingJobResultRuns, maskedFailureRuns, nonCiWorkflowRuns,
    missingIdentityRuns, incompleteInventoryRuns, runIds,
    minCreatedMs: createdTimes[0] ?? null, maxCreatedMs: createdTimes[createdTimes.length - 1] ?? null,
    events: [...events].sort(), classes: [...classes].sort(), eventCounts, classCounts,
  };
};

const hasComparableMix = (bCounts, bTotal, aCounts, aTotal, keys) =>
  bTotal > 0 && aTotal > 0 && keys.length > 0 &&
  keys.every((k) => Math.abs(((bCounts[k] ?? 0) / bTotal) - ((aCounts[k] ?? 0) / aTotal)) <= 0.2);

export const compareWindows = (before, after, limits = {}) => {
  const b = summarizeWindow(before), a = summarizeWindow(after);
  const errors = [], pending = [];
  const minRuns = limits.minRuns ?? before.minRuns ?? after.minRuns ?? 20;
  const minDays = limits.minDays ?? before.minDays ?? after.minDays ?? 7;
  if (before.window !== 'before' || after.window !== 'after') {
    errors.push(`invalid pinned window identity: before=${before.window} after=${after.window}`);
  }
  if (before.workflow !== 'CI' || after.workflow !== 'CI' || b.nonCiWorkflowRuns > 0 || a.nonCiWorkflowRuns > 0) {
    errors.push(`non-CI workflow in sample: before=${b.nonCiWorkflowRuns} after=${a.nonCiWorkflowRuns}`);
  }
  if (b.missingIdentityRuns > 0 || a.missingIdentityRuns > 0) {
    errors.push(`missing required run identity fields: before=${b.missingIdentityRuns} after=${a.missingIdentityRuns}`);
  }
  const sharedRunIds = b.runIds.filter((id) => a.runIds.includes(id));
  if (sharedRunIds.length > 0 || (b.minCreatedMs !== null && a.minCreatedMs !== null && a.minCreatedMs <= b.minCreatedMs)) {
    errors.push(`reused or overlapping runs between before and after windows: shared=${sharedRunIds.length}`);
  }
  const allEvents = [...new Set([...b.events, ...a.events])].sort();
  if (b.events.join(',') !== a.events.join(',') || !hasComparableMix(b.eventCounts, b.runs, a.eventCounts, a.runs, allEvents)) {
    errors.push(`incomparable event populations: before=${JSON.stringify(b.eventCounts)} after=${JSON.stringify(a.eventCounts)}`);
  }
  const allClasses = [...new Set([...b.classes, ...a.classes])].sort();
  if (b.classes.join(',') !== a.classes.join(',') || !hasComparableMix(b.classCounts, b.runs, a.classCounts, a.runs, allClasses)) {
    errors.push(`incomparable changeClass populations: before=${JSON.stringify(b.classCounts)} after=${JSON.stringify(a.classCounts)}`);
  }
  if (b.emptyJobRuns > 0 || a.emptyJobRuns > 0) errors.push(`empty job inventory: before=${b.emptyJobRuns} after=${a.emptyJobRuns}`);
  if (b.missingGateRuns > 0 || a.missingGateRuns > 0) errors.push(`missing gate timestamps on successful runs: before=${b.missingGateRuns} after=${a.missingGateRuns}`);
  if (b.missingJobResultRuns > 0 || a.missingJobResultRuns > 0) errors.push(`missing required results: before=${b.missingJobResultRuns} after=${a.missingJobResultRuns}`);
  if (b.maskedFailureRuns > 0 || a.maskedFailureRuns > 0) errors.push(`failed or cancelled job behind successful run: before=${b.maskedFailureRuns} after=${a.maskedFailureRuns}`);
  if (b.incompleteInventoryRuns > 0 || a.incompleteInventoryRuns > 0) {
    errors.push(`incomplete required job/test inventory: before=${b.incompleteInventoryRuns} after=${a.incompleteInventoryRuns}`);
  }
  if (!before.studyBaseline || !after.studyBaseline || before.studyBaseline !== after.studyBaseline) {
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
    const windowName = args.window ?? 'before';
    if (windowName !== 'before' && windowName !== 'after') {
      console.error(`error: invalid --window ${windowName} (expected before or after)`);
      process.exit(1);
    }
    const input = readJson(args.runs);
    const runs = dedupeRuns(Array.isArray(input) ? input : (input.runs ?? []));
    if (runs.length === 0) {
      console.error('error: --runs input contains zero runs');
      process.exit(1);
    }
    const minRuns = Number(args['min-runs'] ?? 20);
    const minDays = Number(args['min-days'] ?? 7);
    const summary = summarizeWindow({ runs });
    const window = {
      schema: WINDOW_SCHEMA, window: windowName, workflow: 'CI', collectedAt: new Date().toISOString(),
      studyBaseline: input.studyBaseline ?? 'fb5e92a6ae4928066e181716fdffbfb490b0b4f3',
      minRuns, minDays, spanDays: summary.spanDays,
      complete:
        runs.length >= minRuns && summary.spanDays >= minDays && summary.emptyJobRuns === 0 &&
        summary.missingGateRuns === 0 && summary.missingIdentityRuns === 0 && summary.incompleteInventoryRuns === 0,
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
