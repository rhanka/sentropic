import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materialFixture } from './contract-fixture.mjs';
import { buildOnce, runTwoBuilds } from './build-executor.mjs';
import { CLI } from './build-cli.mjs';

const cli = fileURLToPath(new URL('./build-cli.mjs', import.meta.url));

test('should refuse a build without verified retained materials before any command', async t => {
  const work = await mkdtemp(join(tmpdir(), 'scanner-exec-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const materials = materialFixture();
  const input = { recipeBytes: materials.recipeBytes, manifest: materials.manifest,
    materialsDir: join(work, 'missing'), workDir: join(work, 'run'),
    build: { mode: 'go', package: '.', outputName: 'fixture', fixtureDir: join(work, 'fixture') } };
  await assert.rejects(buildOnce(input), /scanner-contract/);
  await assert.rejects(runTwoBuilds(input), /scanner-contract/);
  await assert.rejects(buildOnce({ ...input, materialsDir: work, build: { mode: 'shell' } }), /scanner-contract/);
  await assert.rejects(buildOnce({ ...input, materialsDir: work, build: { mode: 'go' } }), /scanner-contract/);
});

test('should expose a probe subcommand that reports the clean isolated build environment', async t => {
  const work = await mkdtemp(join(tmpdir(), 'scanner-cli-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const stdout = execFileSync(process.execPath, [cli, 'probe', '--root', work], { encoding: 'utf8' });
  const report = JSON.parse(stdout);
  assert.equal(report.productionAdmitted, false);
  assert.deepEqual(report.isolation, { credentials: false, oidc: false, sharedSocket: false, python: false });
  assert.deepEqual(report.envKeys.sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR']);
  assert.equal(typeof CLI, 'function');
});
