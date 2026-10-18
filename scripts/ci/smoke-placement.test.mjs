// Smoke placement tests (make test-ci-optimization).
// Smoke overlaps lint: it waits for images and security only, while both stay
// mandatory gate dependencies so either failure still prevents green.
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
const needsOf = (job) => [jobs[job].needs ?? []].flat();
const transitive = (job, seen = new Set()) => {
  for (const dep of needsOf(job)) if (!seen.has(dep) && jobs[dep]) { seen.add(dep); transitive(dep, seen); }
  return seen;
};

test('smoke waits for images and security only, never for lint', () => {
  assert.deepEqual([...needsOf('smoke-idp-screens')].sort(), ['build-api-image', 'build-api-tool-image', 'changes', 'security-sast-sca'].sort());
  assert.ok(!transitive('smoke-idp-screens').has('typecheck-lint-api'), 'smoke can overlap lint');
});

test('smoke consumes no lint outputs or artifacts', () => {
  const steps = jobs['smoke-idp-screens'].steps
    .map((s) => `${s.name ?? ''}\n${s.run ?? ''}\n${s.uses ?? ''}\n${Object.values(s.with ?? {}).join(' ')}`)
    .join('\n');
  assert.ok(!/lint/i.test(steps), 'no lint reference in smoke steps');
  assert.ok(steps.includes('api-image') && steps.includes('api-tool-image'), 'image prerequisites stay');
});

test('required image and security dependencies stay on the smoke path', () => {
  for (const dep of ['build-api-image', 'build-api-tool-image', 'security-sast-sca']) {
    assert.ok(needsOf('smoke-idp-screens').includes(dep), `${dep} stays`);
  }
  assert.ok(needsOf('ci-gate').includes('smoke-idp-screens'), 'smoke stays a mandatory gate dependency');
  assert.ok(needsOf('ci-gate').includes('typecheck-lint-api'), 'lint stays a mandatory gate dependency');
});

test('affected AI suites block green: no continue-on-error on AI results', () => {
  const job = jobs['test-api-unit-integration'];
  assert.equal(job['continue-on-error'], undefined, 'AI shard failure fails the job');
  assert.equal(job.strategy['fail-fast'], false, 'every shard still reports');
  assert.ok((job.strategy.matrix.include ?? []).filter((m) => m.suite === 'ai').length >= 1, 'AI shards stay scheduled');
});

test('DAG stays acyclic, lint/smoke failure or missing/cancelled blocks green, and side-effect ordering stays intact', () => {
  const visiting = new Set(), done = new Set();
  const visit = (n, stack = []) => {
    if (done.has(n)) return;
    assert.ok(!visiting.has(n), `cycle: ${[...stack, n].join(' -> ')}`);
    visiting.add(n);
    for (const d of needsOf(n)) if (jobs[d]) visit(d, [...stack, n]);
    visiting.delete(n);
    done.add(n);
  };
  for (const n of Object.keys(jobs)) visit(n);
  for (const e2e of ['test-e2e', 'e2e-vscode']) assert.ok(needsOf(e2e).includes('typecheck-lint-api'), `${e2e} keeps lint barrier`);
  for (const pub of Object.keys(jobs).filter((n) => n.startsWith('publish-') || n.startsWith('deploy-'))) {
    assert.match(String(jobs[pub].if ?? ''), /github\.ref == 'refs\/heads\/main'/, `${pub} stays main-only`);
  }
  const gateRun = jobs['ci-gate'].steps.map((s) => s.run ?? '').join('\n');
  assert.ok(gateRun.includes('smoke-idp-screens') && gateRun.includes('typecheck-lint-api'), 'both required when selected');
  assert.match(gateRun, /if \[ "\$result" != "success" \]/, 'failure, missing, skipped, neutral or cancelled blocks green');
});
