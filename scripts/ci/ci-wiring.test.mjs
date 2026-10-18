// CI wiring assertions for Lot 1 (make test-ci-optimization / check-ci-optimization).
// Gate aggregation, DAG shape and final-head behavior on the real ci.yml.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const jobs = ci.jobs;
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
