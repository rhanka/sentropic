#!/usr/bin/env node
// Expected CI results. Contract: plan/62-BRANCH_chore-ci-capacity-metrics.md (BR-76).
// A required, selected job blocks promotion unless its executed conclusion is
// success. Failed, missing, cancelled, and unexpectedly skipped required
// members are rejected. A legitimately unselected job (selected: false, or
// absent from the expected set with a skipped conclusion) never blocks.
// Runs only behind root Make targets.
import fs from 'node:fs';

const BLOCKING = new Set(['failed', 'cancelled', 'timed_out', 'stale']);

export function normalizeConclusion(conclusion) {
  return String(conclusion ?? '').trim().toLowerCase();
}

// Interpret only the job-selection grammar used by this workflow. Unsupported
// syntax fails closed; workflow text and context values are never executable code.
export function evaluateSelection(expression, lookup) {
  const source = String(expression).replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const tokens = source.match(/'(?:[^']|'')*'|[A-Za-z_][\w.-]*|==|!=|&&|\|\||[!()]/g) ?? [];
  if (tokens.join('') !== source.replace(/\s+(?=(?:[^']*'[^']*')*[^']*$)/g, '')) {
    throw new Error(`Unsupported selection syntax: ${source}`);
  }
  let index = 0;
  const take = (token) => {
    if (tokens[index++] !== token) throw new Error(`Expected ${token}: ${source}`);
  };
  const atom = () => {
    const token = tokens[index++];
    if (token === '!') return !atom();
    if (token === '(') { const value = or(); take(')'); return value; }
    if (token?.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token === 'true' || token === 'false') return token === 'true';
    if (tokens[index] === '(') {
      take('('); take(')');
      if (token === 'always') return true;
      if (token === 'cancelled') return false;
      throw new Error(`Unsupported selection function: ${token}`);
    }
    if (!token) throw new Error(`Unexpected end: ${source}`);
    return lookup(token);
  };
  const compare = () => {
    const left = atom();
    const op = tokens[index];
    if (op !== '==' && op !== '!=') return left;
    index += 1;
    const right = atom();
    return op === '==' ? left === right : left !== right;
  };
  const and = () => {
    let value = compare();
    while (tokens[index] === '&&') { index += 1; const right = compare(); value = value && right; }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[index] === '||') { index += 1; const right = and(); value = value || right; }
    return value;
  };
  const value = or();
  if (index !== tokens.length) throw new Error(`Unexpected selection token: ${tokens[index]}`);
  return Boolean(value);
}

// expected: [{ job, required?, selected?, matrix? | members? }]
// (defaults: required true, selected true). A `matrix` array of member
// suffixes expands to GitHub matrix names `${job} (${suffix})` (observed:
// `test-e2e (group-a, 00 02 06 10)`); `members` lists explicit full names.
// executed: [{ job, conclusion }], one row per executed member.
// Unexpanded base names never match an executed member: every selected
// matrix member is enforced individually.
export function expandExpected(expected = []) {
  const out = [];
  for (const item of expected ?? []) {
    const flags = { required: item?.required !== false, selected: item?.selected !== false };
    if (Array.isArray(item?.members) && item.members.length > 0) {
      for (const member of item.members) out.push({ job: String(member), ...flags });
    } else if (Array.isArray(item?.matrix) && item.matrix.length > 0) {
      for (const suffix of item.matrix) out.push({ job: `${String(item?.job ?? '')} (${String(suffix)})`, ...flags });
    } else if (item?.job !== undefined) {
      out.push({ job: String(item.job), ...flags });
    }
  }
  return out;
}

// Compute the intended successful DAG from the actual workflow and classifier
// outputs, before dependent jobs dispatch. Upstream failures never shrink it.
export function workflowExpected(workflow, context = {}) {
  const jobs = workflow.jobs;
  if (!jobs?.changes || !jobs['ci-gate']) throw new Error('Missing workflow jobs');
  const selected = new Map();
  const visiting = new Set();
  const selection = (name) => {
    if (selected.has(name)) return selected.get(name);
    if (!jobs[name] || visiting.has(name)) throw new Error(`Invalid workflow dependency: ${name}`);
    visiting.add(name);
    const value = jobs[name].if === undefined ? true : evaluateSelection(jobs[name].if, (key) => {
      if (key.startsWith('needs.changes.outputs.')) return context.changes?.[key.slice(22)] ?? '';
      if (key === 'github.ref') return context.ref ?? '';
      if (key === 'github.event_name') return context.event ?? '';
      if (key.startsWith('inputs.')) return context.inputs?.[key.slice(7)] ?? 'none';
      const dependency = key.match(/^needs\.([\w-]+)\.result$/)?.[1];
      if (dependency) return selection(dependency) ? 'success' : 'skipped';
      throw new Error(`Unsupported selection context: ${key}`);
    });
    visiting.delete(name);
    selected.set(name, value);
    return value;
  };
  return Object.entries(jobs).filter(([name]) => !['ci-gate', 'ci-capacity-receipts'].includes(name))
    .flatMap(([name, job]) => {
      const matrix = job.strategy?.matrix;
      if (matrix && (Object.keys(matrix).some((key) => key !== 'include') || !Array.isArray(matrix.include))) {
        throw new Error(`Unsupported workflow matrix: ${name}`);
      }
      if (job.name !== undefined) throw new Error(`Unsupported workflow job name: ${name}`);
      const members = matrix?.include.map((member) => `${name} (${Object.values(member).join(', ')})`);
      return expandExpected([{ job: name, members, selected: selection(name) }]);
    });
}

export function evaluateExpected({ expected = [], executed = [] } = {}) {
  const executedByJob = new Map();
  for (const row of executed) {
    if (row?.job === undefined) continue;
    executedByJob.set(String(row.job), row);
  }
  const failures = [];
  const passed = [];
  const unselected = [];
  for (const item of expandExpected(expected)) {
    const name = String(item?.job ?? '');
    const required = item?.required !== false;
    const selected = item?.selected !== false;
    if (!required || !selected) {
      unselected.push(name);
      continue;
    }
    const row = executedByJob.get(name);
    if (!row) {
      failures.push({ job: name, reason: 'missing' });
      continue;
    }
    const conclusion = normalizeConclusion(row.conclusion);
    if (conclusion === 'success' || conclusion === 'neutral') {
      passed.push(name);
    } else if (conclusion === 'skipped') {
      failures.push({ job: name, reason: 'unexpectedly-skipped', conclusion });
    } else if (BLOCKING.has(conclusion)) {
      failures.push({ job: name, reason: conclusion === 'failed' ? 'failed' : conclusion, conclusion });
    } else if (conclusion === '') {
      failures.push({ job: name, reason: 'missing-conclusion', conclusion });
    } else {
      failures.push({ job: name, reason: `rejected-conclusion:${conclusion}`, conclusion });
    }
  }
  return { ok: failures.length === 0, failures, passed, unselected };
}

const usage = `usage: ci-expected-results.mjs --expected-file <json> --executed-file <json>
Expected shape: { "expected": [{ "job": <name>, "required": true, "selected": true }] }.
Matrix members: { "job": <base>, "matrix": [<suffix>, ...] } expands to "<base> (<suffix>)";
{ "members": [<full name>, ...] } lists explicit member names.
Executed shape: { "executed": [{ "job": <name>, "conclusion": <ci conclusion> }] }.`;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || !args.includes('--expected-file') || !args.includes('--executed-file')) {
    console.log(usage);
    process.exit(args.includes('--help') ? 0 : 2);
  }
  const expected = JSON.parse(fs.readFileSync(args[args.indexOf('--expected-file') + 1], 'utf8'));
  const executed = JSON.parse(fs.readFileSync(args[args.indexOf('--executed-file') + 1], 'utf8'));
  const verdict = evaluateExpected({ expected: expected.expected, executed: executed.executed });
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.ok ? 0 : 1);
}
