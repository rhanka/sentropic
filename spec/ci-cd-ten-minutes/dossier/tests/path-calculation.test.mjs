import assert from 'node:assert/strict';
import test from 'node:test';
import { caseOptions, eventOptions, groups, heat, selectRuns, sceneFor, steps } from '../scripts/contract-diagrams.mjs';
const job = (name, seconds) => ({ name, seconds, conclusion: 'success' });
const run = { phase: 'before', event: 'pull_request', case: null, jobs: [job('build-api-image', 120), job('test-api (a)', 100), job('test-api (b)', 180), job('ci-gate', null)],
  dependencies: { 'test-api': ['build-api-image'], 'ci-gate': ['test-api'] },
  criticalPaths: { qualification: { jobs: [{ name: 'build-api-image' }, { name: 'test-api (b)' }, { name: 'ci-gate' }] } } };
test('should keep absent cases/events/after phases unmeasured for every control combination', () => {
  for (const phase of ['before', 'after']) for (const changeCase of caseOptions) for (const event of eventOptions) {
    const selected = selectRuns({ runs: [run] }, phase, changeCase, event);
    assert.equal(selected.length, phase === 'before' && changeCase === 'unknown' && event === 'pull_request' ? 1 : 0);
    for (const group of groups) for (let step = 1; step <= steps.length; step++) {
      const scene = sceneFor(selected[0], group, step);
      if (!selected.length) assert.deepEqual(scene.nodes, []);
      assert.ok(scene.edges.every(edge => scene.nodes.some(node => node.id === edge.source) && scene.nodes.some(node => node.id === edge.target)));
    }
  }
});
test('should render matrix maximum, exact dependency edges and unknown durations without adding isolated gains', () => {
  const scene = sceneFor(run);
  const matrix = scene.nodes.find(node => node.id === 'test-api');
  assert.equal(matrix.data.seconds, 180);
  assert.equal(matrix.data.members.length, 2);
  assert.equal(scene.nodes.find(node => node.id === 'ci-gate').data.seconds, null);
  assert.deepEqual(scene.edges.map(edge => edge.id), ['build-api-image:test-api', 'test-api:ci-gate']);
  assert.deepEqual([null, 15, 60, 180, 181].map(heat), ['missing', 'short', 'medium', 'long', 'slow']);
});
