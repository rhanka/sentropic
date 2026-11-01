import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, browserFiles, baselineDurations, reconcileReports, validateMatrix } from './browser-shards.mjs';

test('should assign every browser file exactly once with measured durations retained', () => {
  const manifest = buildManifest();
  const files = manifest.shards.flatMap(row => row.files);
  assert.deepEqual([...files].sort(), browserFiles());
  assert.equal(new Set(files).size, files.length);
  assert.equal(manifest.shards.length, 6);
  assert.ok(Object.keys(baselineDurations).length > 40);
  assert.deepEqual(buildManifest(), manifest);
});

test('should balance long measured files while exposing unmeasured additions', () => {
  const manifest = buildManifest(['a', 'b', 'c', 'd', 'new'], { a: 10, b: 9, c: 3, d: 2 }, 2);
  assert.equal(manifest.shards.flatMap(row => row.unmeasured).length, 1);
  assert.ok(Math.abs(manifest.shards[0].balancingWeight - manifest.shards[1].balancingWeight) <= 2);
  assert.throws(() => buildManifest(['a', 'a']), /inventory/);
});

const report = (results = [{ status: 'passed' }]) => ({ suites: [{ specs: [{ file: 'tests/a.spec.ts',
  line: 1, column: 1, title: 'journey', tests: [{ projectName: 'chromium', expectedStatus: 'passed', results }] }] }] });
test('should reject missing, duplicated, failed, cancelled and retried journeys', () => {
  assert.deepEqual(reconcileReports(report([]), report()), { expected: 1, executed: 1, declaredSkipped: 0, retries: 0 });
  for (const actual of [{ suites: [] }, report([]), report([{ status: 'failed' }]),
    report([{ status: 'interrupted' }]), report([{ status: 'failed' }, { status: 'passed' }])]) {
    assert.throws(() => reconcileReports(report([]), actual));
  }
  const duplicate = report(); duplicate.suites.push(duplicate.suites[0]);
  assert.throws(() => reconcileReports(report([]), duplicate), /duplicate/);
});

test('should fail when the workflow omits or duplicates a generated shard', () => {
  const workflow = `  test-e2e:\n    matrix:\n${Array.from({ length: 6 }, (_, i) => `      shard: ${i + 1}`).join('\n')}\n  next:\n`;
  assert.equal(validateMatrix(workflow), browserFiles().length);
  assert.throws(() => validateMatrix(workflow.replace('shard: 6', 'shard: 1')), /matrix/);
});
