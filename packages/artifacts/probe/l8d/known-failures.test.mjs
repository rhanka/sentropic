import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('should strictly install the packed mesh with Radar llm-mesh 0.19.2', () => {
  const { tuple } = JSON.parse(readFileSync(resolve('tmp/l8d/tuple.json')));
  const consumer = mkdtempSync(join(tmpdir(), 'l8d-peer-'));
  try {
    const mesh = tuple.find((p) => p.name === '@sentropic/cluster-mesh');
    writeFileSync(`${consumer}/package.json`, JSON.stringify({ private: true, dependencies: {
      [mesh.name]: `file:${mesh.path}`, '@sentropic/llm-mesh': '0.19.2',
    } }));
    const result = spawnSync('npm', ['install', '--package-lock-only', '--strict-peer-deps',
      '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumer, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(consumer, { recursive: true, force: true }); }
});

test('should compile public commit and outcome declarations from the packed archive', () => {
  const consumer = resolve('tmp/l8d/consumer');
  const result = spawnSync('node', ['node_modules/typescript/bin/tsc', '--noEmit', '--strict',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'types.mts'],
  { cwd: consumer, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
