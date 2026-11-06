import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('should run the configured sequencer through the Vitest CLI with every fixture executed once', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'unit-shards-cli-'));
  try {
    const api = join(workspace, 'api');
    mkdirSync(join(api, 'tests/unit'), { recursive: true });
    writeFileSync(join(workspace, 'package.json'), '{"private":true,"type":"module"}');
    cpSync('api/vitest.config.ts', join(api, 'vitest.config.ts'));
    cpSync('api/ci', join(api, 'ci'), { recursive: true });
    symlinkSync(join(process.env.UNIT_VITEST_TOOL_DIR, 'node_modules'), join(workspace, 'node_modules'));
    const fixtureCount = 16;
    for (let i = 0; i < fixtureCount; i++) {
      writeFileSync(join(api, `tests/unit/file-${i}.test.ts`),
        `import {it,expect} from 'vitest'; it('fixture ${i}', () => expect(${i}).toBe(${i}));\n`);
    }
    const files = [];
    let tests = 0;
    for (let shard = 1; shard <= 4; shard++) {
      const report = join(workspace, `result-${shard}.json`);
      const run = spawnSync(join(process.env.UNIT_VITEST_TOOL_DIR, 'node_modules/.bin/vitest'),
        ['run', 'tests/unit', `--shard=${shard}/4`, '--maxWorkers=1', '--reporter=json', `--outputFile=${report}`],
        { cwd: api, encoding: 'utf8', env: process.env });
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
      const result = JSON.parse(readFileSync(report, 'utf8'));
      assert.equal(result.success, true);
      assert.equal(result.numPendingTests, 0);
      tests += result.numPassedTests;
      files.push(...result.testResults.map(file => file.name));
    }
    assert.equal(files.length, fixtureCount);
    assert.equal(new Set(files).size, fixtureCount);
    assert.equal(tests, fixtureCount);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
