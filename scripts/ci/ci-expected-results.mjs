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

// expected: [{ job, required?, selected? }] (defaults: required true, selected true).
// executed: [{ job, conclusion, selected? }].
export function evaluateExpected({ expected = [], executed = [] } = {}) {
  const executedByJob = new Map();
  for (const row of executed) {
    if (row?.job === undefined) continue;
    executedByJob.set(String(row.job), row);
  }
  const failures = [];
  const passed = [];
  const unselected = [];
  for (const item of expected) {
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
