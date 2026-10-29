import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDisabledTrace } from './disabled-trace.mjs';
import { assertNoCandidateNativeBuilds, candidateNativeBuilds } from './native-build.mjs';
import { readCandidateInput, verifyCandidateArchive, writeImmutable } from './candidate.mjs';
import { sha256 } from './precandidate.mjs';

export function qualifyDisabledInstall(root, manifestPath, output) {
  const manifestBytes = readCandidateInput(root, manifestPath), manifest = JSON.parse(manifestBytes);
  const l4 = manifest.artifacts.find(a => a.role === 'l4');
  verifyCandidateArchive(root, l4);
  writeImmutable(root, `${output}/binding.json`, { artifactManifestSha256: sha256(manifestBytes), candidateSha256: l4.sha256 });
  const work = mkdtempSync(join(tmpdir(), 'l5-disabled-')), consumer = join(work, 'consumer');
  const result = { artifactManifestSha256: sha256(manifestBytes), candidateSha256: l4.sha256,
    observerSha256: sha256(readCandidateInput(root, 'tools/memory-mcp-l5/disabled-trace.mjs')),
    predicateSha256: sha256(readCandidateInput(root, 'tools/memory-mcp-l5/native-build.mjs')),
    scriptsEnabled: true, optionalDependenciesEnabled: true, passed: false };
  const trace = createDisabledTrace(work);
  let installLog = '', runtimeLog = '', installRows = [], runtimeRows = [];
  try {
    const control = join(work, 'control'), native = join(control, 'node_modules/fs-ext');
    mkdirSync(native, { recursive: true }); writeFileSync(join(native, 'binding.gyp'), '{"targets":[]}');
    const gyp = resolve(dirname(process.execPath), '../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js');
    const code = `require('node:child_process').spawnSync(process.execPath, ${JSON.stringify([gyp, 'rebuild'])}, {cwd:${JSON.stringify(native)},stdio:'ignore'});`;
    const canary = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, ...trace.env }, encoding: 'utf8' });
    assert.equal(canary.status, 0, canary.stderr);
    result.positiveControlBuilds = candidateNativeBuilds(trace.read(), control).length;
    assert.ok(result.positiveControlBuilds > 0, 'native observer positive control did not fire');
    trace.reset(); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
    const install = spawnSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--foreground-scripts', '--include=optional',
      resolve(root, l4.archive)], { cwd: consumer, env: { ...process.env, ...trace.env,
      npm_config_ignore_scripts: 'false', npm_config_omit: '', npm_config_cache: join(work, 'npm-cache') },
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    installLog = (install.stdout || '') + (install.stderr || ''); installRows = trace.read();
    result.installExit = install.status;
    result.nativeBuilds = candidateNativeBuilds(installRows, consumer);
    assert.equal(install.status, 0, installLog.slice(-2000));
    assertNoCandidateNativeBuilds(installLog, installRows, consumer);
    trace.reset();
    const probe = "await import('@sentropic/engram/registry/manifest'); await import('@sentropic/engram/registry/definitions'); await import('@sentropic/engram');";
    const runtime = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: consumer, env: { ...process.env, ...trace.env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    runtimeLog = (runtime.stdout || '') + (runtime.stderr || ''); runtimeRows = trace.read();
    assert.equal(runtime.status, 0, runtimeLog.slice(-2000));
    result.runtimeCounts = Object.fromEntries(['provider-load', 'store-open', 'identity-bootstrap', 'native-build']
      .map(kind => [kind, runtimeRows.filter(row => row.kind === kind).length]));
    assert.ok(Object.values(result.runtimeCounts).every(n => n === 0), 'disabled runtime activated memory');
    result.passed = true;
  } catch (error) { result.failure = error.message; }
  finally {
    mkdirSync(resolve(root, output), { recursive: true });
    for (const [name, bytes] of [['install.log', installLog], ['runtime.log', runtimeLog],
      ['install-trace.json', JSON.stringify(installRows)], ['runtime-trace.json', JSON.stringify(runtimeRows)]]) {
      const path = `${output}/${name}.gz`, compressed = gzipSync(Buffer.from(bytes));
      writeFileSync(resolve(root, path), compressed, { flag: 'wx' });
      (result.evidence ||= []).push({ path, sha256: sha256(compressed), uncompressedSha256: sha256(Buffer.from(bytes)) });
    }
    writeImmutable(root, `${output}/result.json`, result);
    rmSync(work, { recursive: true, force: true });
  }
  if (!result.passed) throw Error(result.failure);
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(qualifyDisabledInstall(process.cwd(), process.env.ARTIFACT_MANIFEST,
    process.env.NATIVE_OUTPUT || 'tmp/memory-l5-native'))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
