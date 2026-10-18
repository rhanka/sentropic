// PR concurrency wiring tests (make test-ci-optimization).
// Same PR cancels older attempts; anything else never collides; no registry or
// deployment writer can execute in the cancellable PR lane.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = createRequire(path.join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml');
const ci = YAML.parse(fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
const jobs = ci.jobs;

export const GROUP = "${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}";
export const CANCEL = "${{ github.event_name == 'pull_request' }}";

// Minimal evaluator for the exact group expression above (fixture semantics).
export const groupFor = ({ workflow, event, prNumber, runId }) =>
  event === 'pull_request' ? `${workflow}-pr-${prNumber}` : `${workflow}-run-${runId}`;

// Discover Make targets that write to external registries or clusters.
export const sideEffectMakeTargets = (mkText = makefile) => {
  const targets = new Set();
  const writerRe = /\b(docker\s+push|npm\s+publish|manifest_guard_publish|publish-api-image\.sh|kubectl\b[^\n]*\bapply|k8s-deploy-preprod)\b/;
  for (const [, name, prereqs, body] of mkText.matchAll(/^([a-zA-Z0-9_.-]+):([^\n]*)\n((?:\t[^\n]*\n?)*)/gm)) {
    if (writerRe.test(prereqs) || writerRe.test(body)) targets.add(name);
  }
  return targets;
};

// Scan every job and step in a workflow for direct or Make-callee side effects.
export const findUnguardedSideEffectSteps = (workflowJobs, writerTargets = sideEffectMakeTargets()) => {
  const unguarded = [];
  const directRe = /\b(docker\s+push|npm\s+publish|kubectl\b[^\n]*\bapply)\b/;
  for (const [jobName, job] of Object.entries(workflowJobs)) {
    const jobMainOnly = /github\.ref == 'refs\/heads\/main'/.test(String(job.if ?? ''));
    for (const step of job.steps ?? []) {
      const run = String(step.run ?? '');
      if (!run) continue;
      const makeCalls = [...run.matchAll(/\bmake\s+(?:-[a-zA-Z]+\s+\S+\s+)*([a-zA-Z0-9_.-]+)/g)].map((m) => m[1]);
      const hitsWriter = directRe.test(run) || makeCalls.some((t) => writerTargets.has(t));
      if (!hitsWriter) continue;
      const stepMainOnly = /github\.ref == 'refs\/heads\/main'/.test(String(step.if ?? ''));
      if (!jobMainOnly && !stepMainOnly) {
        unguarded.push({ job: jobName, step: step.name ?? '(unnamed)', run });
      }
    }
  }
  return unguarded;
};

test('workflow concurrency matches the plan expression exactly', () => {
  assert.equal(ci.concurrency.group, GROUP);
  assert.equal(ci.concurrency['cancel-in-progress'], CANCEL);
});

test('same PR shares one group across pushes; different PRs never collide', () => {
  assert.equal(groupFor({ workflow: 'CI', event: 'pull_request', prNumber: 7, runId: 100 }), 'CI-pr-7');
  assert.equal(groupFor({ workflow: 'CI', event: 'pull_request', prNumber: 7, runId: 101 }), 'CI-pr-7');
  assert.notEqual(
    groupFor({ workflow: 'CI', event: 'pull_request', prNumber: 7, runId: 101 }),
    groupFor({ workflow: 'CI', event: 'pull_request', prNumber: 8, runId: 102 }),
  );
});

test('main pushes and dispatches get unique non-cancelling groups', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    const group = groupFor({ workflow: 'CI', event, runId: 200 });
    assert.equal(group, 'CI-run-200');
    assert.notEqual(groupFor({ workflow: 'CI', event, runId: 200 }), groupFor({ workflow: 'CI', event, runId: 201 }));
  }
  assert.equal(CANCEL, "${{ github.event_name == 'pull_request' }}");
});

test('manual rerun of a superseded attempt rejoins the same PR group', () => {
  const first = groupFor({ workflow: 'CI', event: 'pull_request', prNumber: 7, runId: 100 });
  const rerun = groupFor({ workflow: 'CI', event: 'pull_request', prNumber: 7, runId: 103 });
  assert.equal(first, rerun);
});

test('publication locks are preserved with cancellation disabled', () => {
  assert.deepEqual(jobs['publish-api-image'].concurrency, { group: 'api-image-publication', 'cancel-in-progress': false });
  for (const name of ['publish-llm-mesh', 'publish-llm-gateway', 'publish-cluster-mesh']) {
    assert.deepEqual(jobs[name].concurrency, { group: 'npm-publish-train', 'cancel-in-progress': false }, name);
  }
});

test('side-effect jobs and Make-callee steps cannot execute in the cancellable PR lane', () => {
  const writers = sideEffectMakeTargets();
  for (const expected of ['publish-e2e-image', 'publish-ui-image', 'publish-api-image', 'publish-api-main-image', 'publish-llm-mesh']) {
    assert.ok(writers.has(expected), `Makefile writer inventory includes ${expected}`);
  }
  assert.deepEqual(findUnguardedSideEffectSteps(jobs, writers), []);

  // Regression for Finding 4: build-e2e's publish-e2e-image step is main-only and caught if unguarded.
  const e2ePub = jobs['build-e2e'].steps.find((s) => String(s.run ?? '').includes('make publish-e2e-image'));
  assert.ok(e2ePub, 'build-e2e contains make publish-e2e-image step');
  assert.match(String(e2ePub.if ?? ''), /github\.ref == 'refs\/heads\/main'/);
  assert.ok(jobs['build-e2e'].steps.some((s) => s.run === 'make save-e2e'), 'build-e2e saves e2e-image artifact on cache miss');
  for (const consumer of ['test-e2e', 'e2e-vscode']) {
    assert.ok(jobs[consumer].steps.some((s) => s.run === 'make load-e2e'), `${consumer} loads e2e-image artifact on cache miss`);
  }

  const mutated = structuredClone(jobs);
  mutated['build-e2e'].steps.find((s) => String(s.run ?? '').includes('make publish-e2e-image')).if = "steps.check-e2e-image.outcome == 'failure'";
  const caught = findUnguardedSideEffectSteps(mutated, writers);
  assert.equal(caught.length, 1);
  assert.equal(caught[0].job, 'build-e2e');
});
