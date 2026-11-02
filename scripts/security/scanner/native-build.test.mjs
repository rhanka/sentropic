// Mandatory native gate; invoked with the retained material directory, never skips.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../daily/toolchain-contract.mjs';
import { buildOnce, runTwoBuilds, stagePatchedSource } from './build-executor.mjs';
import { compareBuilds } from './build-layout.mjs';

const execFileAsync = promisify(execFile);
const FIXTURE = fileURLToPath(new URL('./fixtures/build', import.meta.url));

async function nativeInput(t) {
  assert.ok(process.env.SCANNER_MATERIALS, 'SCANNER_MATERIALS is required; this gate never skips');
  const work = await mkdtemp(join(tmpdir(), 'scanner-build-'));
  t.after(async () => {
    await execFileAsync('chmod', ['-R', 'u+w', work]).catch(() => {});
    await rm(work, { recursive: true, force: true });
  });
  const recipeBytes = await readFile(new URL('./recipe.json', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('./material-manifest.json', import.meta.url)));
  return { recipeBytes, manifest, materialsDir: process.env.SCANNER_MATERIALS, workDir: work,
    build: { mode: 'go', package: '.', outputName: 'fixture', fixtureDir: FIXTURE } };
}

test('should build the small executable fixture twice and reproduce the normalized result', async t => {
  const input = await nativeInput(t);
  const result = await runTwoBuilds(input);
  assert.equal(result.productionAdmitted, false);
  assert.equal(result.candidate, true);
  assert.equal(result.network, 'none');
  assert.deepEqual(result.isolation, { credentials: false, oidc: false, sharedSocket: false, python: false });
  assert.deepEqual(result.reproducibility.allowedDifferences, []);
  assert.deepEqual(result.reproducibility.first, result.reproducibility.second);
  const outputs = result.outputs;
  for (const name of ['fixture', 'layer.tar', 'config.json', 'manifest.json', 'index.json', 'sbom.json']) {
    assert.ok(outputs[name] && /^sha256:[a-f0-9]{64}$/.test(outputs[name].digest), `output ${name}`);
  }
  assert.equal(outputs.fixture.digest, result.reproducibility.first.binaryDigest);
  const index = JSON.parse(outputs['index.json'].bytes.toString('utf8'));
  assert.equal(index.manifests.length, 1);
  assert.deepEqual(index.manifests[0].platform, { architecture: 'amd64', os: 'linux' });
  assert.equal(index.manifests[0].digest, outputs['manifest.json'].digest);
  const sbom = JSON.parse(outputs['sbom.json'].bytes.toString('utf8'));
  assert.equal(sbom.productionAdmitted, false);
  assert.ok(sbom.components.some(c => c.type === 'go-module' && c.name === 'sentropic.example/a03-two-build-fixture'));
  assert.ok(sbom.components.filter(c => c.type === 'os-package').length > 0);
  assert.ok(result.commands.some(c => c.includes('go build -trimpath -buildvcs=false')));
});

test('should refuse a forced reproducibility mismatch between two fixture builds', async t => {
  const input = await nativeInput(t);
  const first = await buildOnce({ ...input, workDir: join(input.workDir, 'first') });
  const mutated = join(input.workDir, 'fixture-mutated');
  await mkdir(mutated, { recursive: true });
  await copyFile(join(FIXTURE, 'go.mod'), join(mutated, 'go.mod'));
  await writeFile(join(mutated, 'main.go'), 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("mutated") }\n');
  const second = await buildOnce({ ...input, workDir: join(input.workDir, 'second'),
    build: { ...input.build, fixtureDir: mutated } });
  assert.notEqual(first.normalized.binaryDigest, second.normalized.binaryDigest);
  assert.throws(() => compareBuilds(first, second), /scanner-contract: reproducibility mismatch/);
  assert.deepEqual(compareBuilds(first, first), { reproducible: true, allowedDifferences: [] });
});

test('should stage the real patched source with the reviewed digest-bound patches', async t => {
  const input = await nativeInput(t);
  const staged = await stagePatchedSource({ recipeBytes: input.recipeBytes, manifest: input.manifest,
    materialsDir: input.materialsDir, runDir: join(input.workDir, 'staged') });
  const recipe = JSON.parse(input.recipeBytes.toString('utf8'));
  const goMod = staged.files['go.mod'].toString('utf8');
  assert.ok(goMod.includes('github.com/go-jose/go-jose/v4 v4.1.6'));
  const lastAfterDigest = {};
  for (const patch of recipe.patches) {
    const envelope = JSON.parse((await readFile(join(input.materialsDir, patch.path))).toString('utf8'));
    for (const file of envelope.files) lastAfterDigest[file.path] = file.afterDigest;
  }
  for (const [path, afterDigest] of Object.entries(lastAfterDigest)) {
    assert.equal(digest(staged.files[path]), afterDigest, path);
  }
  assert.equal(staged.sourceCommit, recipe.sourceCommit);
});
