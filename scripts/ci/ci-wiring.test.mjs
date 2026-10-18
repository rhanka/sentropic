// CI wiring assertions for Lot 1 (make test-ci-optimization / check-ci-optimization).
// Gate aggregation, DAG shape and final-head behavior on the real ci.yml.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const jobs = ci.jobs;
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'ci', 'fixtures', 'consumer-regressions.json'), 'utf8'),
);
import { VALIDATE_OUTPUTS, matchGlob } from './filter-consumers.mjs';
export const needsOf = (job) => [jobs[job].needs ?? []].flat();

// Every lane job the gate must observe: PR-visible jobs minus main-only publishers.
export const PR_JOBS = Object.keys(jobs).filter(
  (n) => n !== 'ci-gate' && !n.startsWith('publish-') && !['bootstrap-publish', 'verify-train-lock-integrity', 'deploy-preprod'].includes(n),
);

test('ci-gate aggregates every PR job, stays unconditional and is a leaf', () => {
  const gate = jobs['ci-gate'];
  assert.equal(gate.if, 'always()');
  assert.deepEqual([...needsOf('ci-gate')].sort(), [...PR_JOBS].sort());
  for (const name of Object.keys(jobs)) assert.ok(!needsOf(name).includes('ci-gate'), `${name} must not need ci-gate`);
});

test('needs graph is acyclic', () => {
  const visiting = new Set();
  const done = new Set();
  const visit = (name, stack) => {
    if (done.has(name)) return;
    assert.ok(!visiting.has(name), `cycle: ${[...stack, name].join(' -> ')}`);
    visiting.add(name);
    for (const dep of needsOf(name)) if (jobs[dep]) visit(dep, [...stack, name]);
    visiting.delete(name);
    done.add(name);
  };
  for (const name of Object.keys(jobs)) visit(name, []);
});

test('final head alone decides: gate reads only the current run needs', () => {
  const steps = jobs['ci-gate'].steps;
  const run = steps.map((s) => s.run ?? '').join('\n');
  const env = steps.map((s) => Object.values(s.env ?? {}).join(' ')).join(' ');
  assert.match(env, /toJSON\(needs\)/, 'gate evaluates the current run only');
  assert.ok(!run.includes('github.run_id') && !run.includes('github.run_attempt'), 'no reliance on prior attempts');
  assert.ok(String(ci.concurrency.group).includes('pull_request.number'), 'superseded pushes share one group');
});

test('smoke and lint stay mandatory gate dependencies', () => {
  assert.ok(needsOf('ci-gate').includes('smoke-idp-screens'), 'smoke blocks green');
  assert.ok(needsOf('ci-gate').includes('typecheck-lint-api'), 'lint blocks green');
});

test('repaired filter outputs reach the jobs and the gate', () => {
  const filters = YAML.parse(jobs.changes.steps.find((s) => s.id === 'filter').with.filters);
  for (const [name, globs] of Object.entries(fixture.repairMap)) {
    for (const glob of globs) assert.ok(filters[name].includes(glob), `${name} outputs ${glob}`);
  }
  // Change kind never matters: additions, deletions and both rename sides match on path strings.
  assert.ok(matchGlob('packages/mcp-auth/**', 'packages/mcp-auth/src/core.ts'), 'addition matches');
  assert.ok(matchGlob('packages/mcp-auth/**', 'packages/mcp-auth/src/removed.ts'), 'deletion matches');
  assert.ok(matchGlob('packages/mcp-auth/**', 'packages/mcp-auth/src/old.ts'), 'rename old side matches');
  // Global and Make changes fan out to complete suites.
  assert.ok(filters.global.includes('Makefile'), 'Makefile is global');
  assert.ok(filters.global.includes('.github/workflows/ci.yml'), 'workflow file is global');
  // Every validation job gates on its own output; package lanes also fan out on global.
  // validate-idp-sync is intentionally global-free: its filter already enumerates
  // every input it consumes (deploy, auth-hono, drizzle, Makefile, sync workflows).
  for (const [job, key] of Object.entries(VALIDATE_OUTPUTS)) {
    const cond = String(jobs[job].if ?? '');
    assert.ok(cond.includes(`needs.changes.outputs.${key} == 'true'`), `${job} gates on ${key}`);
    if (key !== 'idp_sync') assert.ok(cond.includes("needs.changes.outputs.global == 'true'"), `${job} fans out on global`);
  }
});

test('gate scenarios on the committed shell: failed AI denied, selected-but-skipped denied, clean allowed', () => {
  // Faithful jq stand-in: implements exactly the queries the gate script uses.
  // The shell under test is the real committed script; only jq is stubbed.
  const stub = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'let input = "";',
    'process.stdin.on("data", (c) => { input += c; });',
    'process.stdin.on("end", () => {',
    '  const argv = process.argv.slice(2);',
    '  const prog = argv[argv.length - 1];',
    '  const data = JSON.parse(input || "{}");',
    '  const ok = ["success", "skipped", "neutral"];',
    '  const args = {};',
    '  for (let i = 0; i < argv.length; i += 1) if (argv[i] === "--arg") args[argv[i + 1]] = argv[i + 2];',
    '  if (prog.includes("index($r)")) {',
    '    for (const k of Object.keys(data)) if (!ok.includes(data[k].result)) console.log("::error title=CI gate::" + k + " result=" + data[k].result);',
    '    return;',
    '  }',
    '  if (prog.includes("to_entries")) {',
    '    for (const k of Object.keys(data)) console.log(k + ": " + data[k].result);',
    '    return;',
    '  }',
    '  if (prog.includes("length > 0")) {',
    '    const vals = Object.values(data);',
    '    process.exit(vals.length > 0 && vals.every((v) => ok.includes(v.result)) ? 0 : 1);',
    '  }',
    '  if (prog.includes(".changes.outputs")) { console.log(JSON.stringify((data.changes || {}).outputs || {})); return; }',
    '  if (prog.includes(".[$k]")) { console.log(String(data[args.k] !== undefined ? data[args.k] : "false")); return; }',
    '  if (prog.includes(".[$j].result")) { console.log(String((data[args.j] || {}).result !== undefined ? data[args.j].result : "missing")); return; }',
    '  console.error("stub jq: unknown program " + prog); process.exit(2);',
    '});',
  ].join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-'));
  try {
    const script = `${jobs['ci-gate'].steps.map((s) => s.run ?? '').join('\n').trim()}\n`;
    fs.writeFileSync(path.join(dir, 'gate.sh'), script, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'jq'), stub, { mode: 0o755 });
    const run = (needs) =>
      spawnSync('bash', [path.join(dir, 'gate.sh')], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, CI_NEEDS: JSON.stringify(needs) },
      });
    const apiLane = ['test-api-unit-integration', 'typecheck-lint-api', 'build-api-image', 'build-api-tool-image', 'smoke-idp-screens', 'security-sast-sca', 'test-smoke-restore', 'security-container', 'build-e2e'];
    const laneOk = Object.fromEntries(apiLane.map((j) => [j, { result: 'success' }]));
    const off = { api: 'false', global: 'false', ui: 'false' };
    const base = (outputs, extra = {}) => ({ changes: { result: 'success', outputs }, 'validate-publishable-manifests': { result: 'success' }, ...extra });
    // A failed affected AI shard can never be accepted as complete evidence.
    const failed = run(base({ ...off, api: 'true' }, { ...laneOk, 'test-api-unit-integration': { result: 'failure' } }));
    assert.notEqual(failed.status, 0, `failed AI shard denies green: ${failed.stdout}${failed.stderr}`);
    // A selected-but-skipped required result is a false green: denied by the strict block.
    const skipped = run(base({ ...off, api: 'true' }, { ...laneOk, 'test-api-unit-integration': { result: 'skipped' } }));
    assert.notEqual(skipped.status, 0, `selected-but-skipped denies green: ${skipped.stdout}${skipped.stderr}`);
    assert.match(skipped.stdout, /strict selection requires test-api-unit-integration result=success \(got skipped\)/, `status=${skipped.status} stderr=${skipped.stderr}`);
    // Complete affected evidence with legitimate skips elsewhere is allowed.
    const clean = run(base({ ...off, api: 'true' }, { ...laneOk, 'typecheck-lint-ui': { result: 'skipped' } }));
    assert.equal(clean.status, 0, `clean run allows green: ${clean.stdout}${clean.stderr}`);
    assert.match(clean.stdout, /CI gate passed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('strict gate: a selected job must succeed, never skip or go neutral', () => {
  const run = jobs['ci-gate'].steps.map((s) => s.run ?? '').join('\n');
  assert.match(run, /strict selection requires/, 'strict block present');
  assert.match(run, /result=success \(got \$result\)/, 'non-success is rejected with the offending job');
  for (const job of ['test-api-unit-integration', 'smoke-idp-screens', 'typecheck-lint-api', 'security-iac', 'validate-llm-mesh']) {
    assert.ok(run.includes(job), `strict table covers ${job}`);
  }
  assert.match(run, /validate-idp-sync.*global-free/, 'idp-sync exception documented');
  assert.match(run, /requiredSuccessJobs table/, 'shell mirrors the JS strict table');
  const invRuns = jobs['validate-publishable-manifests'].steps.map((s) => s.run ?? '');
  assert.ok(invRuns.includes('make check-ci-optimization test-ci-optimization ENV=test-ci-manifests'), 'CI-only changes run optimization wiring tests');
});
