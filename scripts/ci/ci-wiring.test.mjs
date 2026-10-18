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
import { SELECTION_KEYS, VALIDATE_OUTPUTS, matchGlob, requiredSuccessJobs } from './filter-consumers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const jobs = ci.jobs;
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'ci', 'fixtures', 'consumer-regressions.json'), 'utf8'),
);
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

test('final head alone decides: gate reads only the current run needs and event', () => {
  const steps = jobs['ci-gate'].steps;
  const run = steps.map((s) => s.run ?? '').join('\n');
  const env = steps.map((s) => Object.values(s.env ?? {}).join(' ')).join(' ');
  assert.match(env, /toJSON\(needs\)/, 'gate evaluates the current run only');
  assert.match(env, /github\.event_name/, 'gate receives the current event name');
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
  assert.ok(matchGlob('packages/mcp-auth/**', 'packages/mcp-auth/src/core.ts'), 'addition matches');
  assert.ok(matchGlob('packages/mcp-auth/**', 'packages/mcp-auth/src/removed.ts'), 'deletion matches');
  assert.ok(matchGlob('packages/mcp-auth/**', 'packages/mcp-auth/src/old.ts'), 'rename old side matches');
  assert.ok(filters.global.includes('Makefile'), 'Makefile is global');
  assert.ok(filters.global.includes('.github/workflows/ci.yml'), 'workflow file is global');
  for (const [job, key] of Object.entries(VALIDATE_OUTPUTS)) {
    const cond = String(jobs[job].if ?? '');
    assert.ok(cond.includes(`needs.changes.outputs.${key} == 'true'`), `${job} gates on ${key}`);
    if (key !== 'idp_sync') assert.ok(cond.includes("needs.changes.outputs.global == 'true'"), `${job} fans out on global`);
  }
});

test('gate scenarios on the committed shell with all 39 dependencies: negative and positive cases', () => {
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
    '  if (prog.includes("$deps | split")) {',
    '    process.exit(args.deps.split(" ").every((d) => ok.includes((data[d] || {}).result)) ? 0 : 1);',
    '  }',
    '  if (prog.includes("$keys | split")) {',
    '    process.exit(args.keys.split(" ").every((k) => data[k] === "true" || data[k] === "false") ? 0 : 1);',
    '  }',
    '  if (prog.includes(".changes.outputs")) { console.log(JSON.stringify((data.changes || {}).outputs || {})); return; }',
    '  if (prog.includes(".[$k]")) {',
    '    const fallback = prog.includes(\'"missing"\') ? "missing" : "false";',
    '    console.log(String(data[args.k] !== undefined && data[args.k] !== null ? data[args.k] : fallback));',
    '    return;',
    '  }',
    '  if (prog.includes(".[$j].result")) {',
    '    const r = (data[args.j] || {}).result;',
    '    console.log(String(r !== undefined && r !== null ? r : "missing"));',
    '    return;',
    '  }',
    '  console.error("stub jq: unknown program " + prog); process.exit(2);',
    '});',
  ].join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-'));
  try {
    const script = `${jobs['ci-gate'].steps.map((s) => s.run ?? '').join('\n').trim()}\n`;
    fs.writeFileSync(path.join(dir, 'gate.sh'), script, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'jq'), stub, { mode: 0o755 });
    const realDir = path.join(dir, 'real');
    fs.mkdirSync(realDir);
    if (fs.existsSync('/host-bin/jq') && fs.existsSync('/host-lib/ld-linux-x86-64.so.2')) {
      fs.writeFileSync(path.join(realDir, 'jq'), '#!/bin/sh\nexec /host-lib/ld-linux-x86-64.so.2 --library-path /host-lib /host-bin/jq "$@"\n', { mode: 0o755 });
    }
    const realPath = `${realDir}${path.delimiter}${process.env.PATH}`;
    const hasRealJq = spawnSync('jq', ['--version'], { env: { ...process.env, PATH: realPath } }).status === 0;
    if (process.env.CI_OPTIMIZATION_REQUIRE_REAL_JQ === '1') {
      assert.ok(hasRealJq, 'real jq binary is available for gate scenario verification');
    }

    const allOff = Object.fromEntries(SELECTION_KEYS.map((k) => [k, 'false']));
    const buildNeeds = (outputs, overrides = {}, eventName = 'pull_request') => {
      const req = new Set(outputs ? requiredSuccessJobs({ ...allOff, ...outputs }, { eventName }) : []);
      const base = Object.fromEntries(PR_JOBS.map((j) => [j, { result: req.has(j) ? 'success' : 'skipped' }]));
      base.changes = { result: 'success', ...(outputs ? { outputs } : {}) };
      return { ...base, ...overrides };
    };

    const jqPaths = hasRealJq ? [realPath, `${dir}${path.delimiter}${process.env.PATH}`] : [`${dir}${path.delimiter}${process.env.PATH}`];
    for (const jqPath of jqPaths) {
      const run = (needs, eventName = 'pull_request') =>
        spawnSync('bash', [path.join(dir, 'gate.sh')], {
          encoding: 'utf8',
          env: { ...process.env, PATH: jqPath, CI_NEEDS: JSON.stringify(needs), CI_EVENT_NAME: eventName },
        });

      // 1. Clean API-only PR: all 15 required jobs succeed (including build-ui, test-e2e, e2e-vscode, enforce-package-bump).
      const cleanApi = run(buildNeeds({ ...allOff, api: 'true' }));
      assert.equal(cleanApi.status, 0, `clean API-only PR passes: ${cleanApi.stdout}${cleanApi.stderr}`);

      // 2. Reproduction from Finding 2: API-only PR where build-ui, test-e2e or e2e-vscode is skipped or neutral MUST fail.
      for (const omitted of ['build-ui', 'test-e2e', 'e2e-vscode']) {
        for (const badResult of ['skipped', 'neutral']) {
          const res = run(buildNeeds({ ...allOff, api: 'true' }, { [omitted]: { result: badResult } }));
          assert.notEqual(res.status, 0, `API-only ${omitted}=${badResult} must fail`);
          assert.match(res.stdout, new RegExp(`strict selection requires ${omitted} result=success \\(got ${badResult}\\)`));
        }
      }

      // 3. UI-only PR where build-api-image or security-sast-sca is skipped MUST fail; clean UI-only passes.
      for (const omitted of ['build-api-image', 'security-sast-sca']) {
        const res = run(buildNeeds({ ...allOff, ui: 'true' }, { [omitted]: { result: 'skipped' } }));
        assert.notEqual(res.status, 0, `UI-only ${omitted}=skipped must fail`);
      }
      assert.equal(run(buildNeeds({ ...allOff, ui: 'true' })).status, 0, 'clean UI-only PR passes');

      // 4. enforce-package-bump=skipped on pull_request MUST fail, but on push is allowed.
      assert.notEqual(run(buildNeeds({ ...allOff, api: 'true' }, { 'enforce-package-bump': { result: 'skipped' } }, 'pull_request'), 'pull_request').status, 0);
      assert.equal(run(buildNeeds({ ...allOff, api: 'true' }, { 'enforce-package-bump': { result: 'skipped' } }, 'push'), 'push').status, 0);

      // 5. Missing changes.outputs or missing selection key MUST fail even when all optional jobs are skipped.
      const noOutputs = run(buildNeeds(null));
      assert.notEqual(noOutputs.status, 0, 'missing changes.outputs must fail');
      assert.match(noOutputs.stdout, /missing or invalid changes\.outputs boolean filter keys/);
      const partialOutputs = { ...allOff };
      delete partialOutputs.cluster_mesh;
      const missingKey = run(buildNeeds(partialOutputs));
      assert.notEqual(missingKey.status, 0, 'missing filter key must fail');
      assert.match(missingKey.stdout, /missing or invalid changes\.outputs boolean filter keys/);

      // 6. Missing dependency entry or null result in CI_NEEDS MUST fail.
      const incompleteNeeds = buildNeeds({ ...allOff, api: 'true' });
      delete incompleteNeeds['smoke-idp-screens'];
      const missingDep = run(incompleteNeeds);
      assert.notEqual(missingDep.status, 0, 'missing dependency in CI_NEEDS must fail');
      assert.match(missingDep.stdout, /missing or unacceptable dependency in CI_NEEDS/);

      // 7. Failed AI shard denies green.
      assert.notEqual(run(buildNeeds({ ...allOff, api: 'true' }, { 'test-api-unit-integration': { result: 'failure' } })).status, 0);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('strict gate: a selected job must succeed, never skip or go neutral', () => {
  const run = jobs['ci-gate'].steps.map((s) => s.run ?? '').join('\n');
  assert.match(run, /strict selection requires/, 'strict block present');
  assert.match(run, /result=success \(got \$result\)/, 'non-success is rejected with the offending job');
  for (const job of ['test-api-unit-integration', 'smoke-idp-screens', 'typecheck-lint-api', 'security-iac', 'validate-llm-mesh', 'enforce-package-bump']) {
    assert.ok(run.includes(job), `strict table covers ${job}`);
  }
  assert.match(run, /validate-idp-sync.*global-free/, 'idp-sync exception documented');
  assert.match(run, /requiredSuccessJobs table/, 'shell mirrors the JS strict table');
  const invRuns = jobs['validate-publishable-manifests'].steps.map((s) => s.run ?? '');
  assert.ok(invRuns.includes('make check-ci-optimization test-ci-optimization ENV=test-ci-manifests'), 'CI-only changes run optimization wiring tests');
});
