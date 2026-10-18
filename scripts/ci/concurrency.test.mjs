// PR concurrency wiring tests (make test-ci-optimization).
// Same PR cancels older attempts; anything else never collides.
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

export const GROUP = "${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}";
export const CANCEL = "${{ github.event_name == 'pull_request' }}";

// Minimal evaluator for the exact group expression above (fixture semantics).
export const groupFor = ({ workflow, event, prNumber, runId }) =>
  event === 'pull_request' ? `${workflow}-pr-${prNumber}` : `${workflow}-run-${runId}`;

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

test('side-effect jobs cannot execute in the cancellable PR lane', () => {
  const sideEffects = Object.keys(jobs).filter((n) => n.startsWith('publish-') || n.startsWith('deploy-') || n === 'bootstrap-publish');
  assert.ok(sideEffects.length > 0, 'side-effect jobs exist');
  for (const name of sideEffects) {
    assert.match(String(jobs[name].if ?? ''), /github\.ref == 'refs\/heads\/main'/, `${name} stays main-only`);
  }
});
