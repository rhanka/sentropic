import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { balancedShards, baseline, unitShard } from './unit-shards.mjs';

test('should retain every collected unit file exactly once, including unmeasured additions', () => {
  const files = Object.keys(baseline.durationsMs).concat('tests/unit/new-regression.test.ts');
  const shards = balancedShards(files, 4);
  assert.deepEqual(shards.flatMap(s => s.files).sort(), [...files].sort());
  assert.equal(new Set(shards.flatMap(s => s.files)).size, files.length);
  assert.deepEqual(balancedShards([...files].reverse(), 4), shards);
  assert.equal(baseline.runId, 42300540682);
  assert.equal(baseline.jobId, 128179794335);
  const weights = shards.map(s => s.weightMs);
  assert.ok(Math.max(...weights) - Math.min(...weights) < 1100);
});

test('should balance long measured files instead of grouping them in one shard', () => {
  const shards = balancedShards(['a', 'b', 'c', 'new'], 2, { a: 10000, b: 9000, c: 1000 });
  assert.deepEqual(shards.map(s => s.weightMs), [12000, 12000]);
  for (const [files, count] of [[[], 2], [['a', 'a'], 2], [['a'], 0], [['a'], 1.5]]) {
    assert.throws(() => balancedShards(files, count), /inventory/);
  }
});

test('should return the original Vitest specifications with complete membership', () => {
  const files = readdirSync('api/tests/unit', { recursive: true }).filter(f => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
  assert.ok(files.length >= 186);
  const specs = files.map(file => ({ moduleId: `/workspace/api/tests/unit/${file}`, project: {} }));
  const assigned = Array.from({ length: 4 }, (_, i) => unitShard(specs, { index: i + 1, count: 4 }, '/workspace/api')).flat();
  assert.equal(assigned.length, specs.length);
  assert.equal(new Set(assigned).size, specs.length);
  for (const spec of specs) assert.ok(assigned.includes(spec));
  assert.throws(() => unitShard(specs, { index: 5, count: 4 }, '/workspace/api'), /index/);
});
