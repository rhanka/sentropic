import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('should load actual llm-mesh 0.19.2 through packed mesh and facade entries', () => {
  const { tuple } = JSON.parse(readFileSync(resolve('tmp/l8d/tuple.json')));
  const mesh = tuple.find((entry) => entry.name === '@sentropic/cluster-mesh');
  const consumer = mkdtempSync(join(tmpdir(), 'l8d-runtime-0192-'));
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: consumer, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  try {
    writeFileSync(`${consumer}/package.json`, JSON.stringify({ private: true, type: 'module', dependencies: {
      [mesh.name]: `file:${mesh.path}`, '@sentropic/llm-mesh': '0.19.2',
    } }));
    run(process.execPath, ['/workspace/scripts/ci/locked-consumer.mjs', '--strict-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund']);
    run('node', ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { readFileSync, lstatSync } from 'node:fs';
      import { createClusterMeshModules, verifyClusterMeshTopology } from '@sentropic/cluster-mesh';
      import * as mesh from '@sentropic/cluster-mesh/llm-mesh';
      import * as facade from '@sentropic/cluster-mesh/llm-mesh/facade';
      import * as provider from '@sentropic/llm-mesh';
      assert.equal(JSON.parse(readFileSync('node_modules/@sentropic/llm-mesh/package.json')).version, '0.19.2');
      assert.equal(lstatSync('node_modules/@sentropic/llm-mesh').isSymbolicLink(), false);
      assert.equal(mesh.createLlmMesh, provider.createLlmMesh);
      assert.equal(typeof facade.createLlmMeshFacade, 'function');
      const modules = createClusterMeshModules();
      assert.equal((await modules.load('llm-mesh')).createLlmMesh, mesh.createLlmMesh);
      assert.equal((await modules.load('llm-mesh/facade')).createLlmMeshFacade, facade.createLlmMeshFacade);
      assert.equal(verifyClusterMeshTopology({ require: ['llm-mesh'] }).llmMesh.version, '0.19.2');
    `]);
  } finally { rmSync(consumer, { recursive: true, force: true }); }
});
