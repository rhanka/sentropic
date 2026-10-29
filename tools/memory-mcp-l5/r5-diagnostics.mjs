// Reuse the producer's unchanged probes on the delivered bytes, never repack.
// This diagnostic cannot emit an L5-MEMORY-V1 acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = resolve('tmp/memory-l5-r5');
const work = mkdtempSync('/tmp/memory-l5-r5-');
const hash = (bytes, alg = 'sha256', encoding = 'hex') => createHash(alg).update(bytes).digest(encoding);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const result = { diagnosticOnly: true, gates: {}, node: process.version, work };
result.proofAvailability = json('tools/memory-mcp-l5/proof-catalog-v1.json').proofs.map(p => ({ id: p.id, missing: p.files.filter(path => !existsSync(path)), requiredCases: p.requiredCases }));
const gate = async (name, fn) => {
  try { result.gates[name] = { status: 'PASS', evidence: await fn() }; }
  catch (error) { result.gates[name] = { status: 'FAIL', error: error.message }; }
  writeFileSync(join(out, 'diagnostics.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(name, result.gates[name].status);
};
function run(command, args, cwd, env = {}) {
  const r = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw Error(`${command} exit ${r.status}: ${r.error?.message ?? ''}\n${r.stderr?.slice(-3000)}`);
  return r.stdout;
}
mkdirSync(out, { recursive: true });
const bytes = readFileSync('/candidate.tgz');
assert.equal(hash(bytes), '965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9');
assert.equal('sha512-' + hash(bytes, 'sha512', 'base64'), 'sha512-GTpbiHocqxLiyI1Syn1g26vOrh8+o9zTGFc2yKKrBGqE+strVqOlc9A+DJ1PRJEmPWuULG+vWB9Iebhy1r1Q7A==');
const p3 = json('tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json');
const p3Digest = hash(readFileSync('tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json'));
assert.equal(p3Digest, '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730');
const source = '/producer/scripts/mcp-memory-l4-packed-acceptance.mjs';
assert.equal(hash(readFileSync(source)), '10da701db19f28d68421c5b0dbb818b6a2111ff931018d85cad35c0f88b0067a');
assert.equal(hash(readFileSync('/producer/scripts/mcp-memory-disabled-trace.mjs')), '76f5eac33db868c413e2b298abbfaff87c197ca6749ded6f8316825549bfab28');
cpSync('/producer/scripts/mcp-memory-disabled-trace.mjs', join(work, 'mcp-memory-disabled-trace.mjs'));
writeFileSync(join(work, 'probes.mjs'), readFileSync(source, 'utf8') + '\nexport { REAL_HOST_HARNESS, ENABLED_PROBE, INVOCATION_PROBE, SIX_TOOL_PROBE, DISABLED_PROBE, TRACE_CONTROL_PROBE, FLOOR_PROBE, runProbe };\n');
const probes = await import(pathToFileURL(join(work, 'probes.mjs')));
const { createDisabledTrace } = await import(pathToFileURL(join(work, 'mcp-memory-disabled-trace.mjs')));
const trace = createDisabledTrace(work);
const archives = p3.artifacts.map(a => {
  assert.equal(hash(readFileSync(a.archive)), a.sha256);
  return resolve(a.archive);
});
const install = (name, peers, sdk, traced, omitOptional) => {
  const cwd = join(work, name);
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name, version: '0.0.0', type: 'module' }));
  const args = ['install', '--no-save', '--no-audit', '--no-fund', '--foreground-scripts'];
  if (omitOptional) args.push('--omit=optional');
  args.push('/candidate.tgz', ...peers, ...(sdk ? [`@modelcontextprotocol/sdk@${sdk}`] : []));
  const r = spawnSync('npm', args, { cwd, env: { ...process.env, npm_config_cache: join(work, name + '-cache'), ...(traced ? trace.env : {}) }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(out, name + '-install.log'), (r.stdout ?? '') + (r.stderr ?? ''));
  assert.equal(r.status, 0, `${name} install: ${r.error?.message ?? ''} ${(r.stderr ?? '').slice(-1500)}`);
  return cwd;
};
await gate('delivery-binding', () => {
  const mf = json('/producer/candidate-manifest.json');
  assert.equal(mf.tarball.sha256, hash(bytes));
  assert.equal(mf.tarball.integrity, 'sha512-' + hash(bytes, 'sha512', 'base64'));
  assert.equal(mf.builtAgainstPreCandidateSha256, p3Digest);
  assert.equal(mf.engramSourceCommit, '0db169cba322015e1ee1b1bdcab09fdc02440f37');
  const packed = JSON.parse(run('tar', ['-xOf', '/candidate.tgz', 'package/package.json'], work));
  assert.deepEqual(mf.exports, packed.exports);
  for (const [path, digest] of Object.entries(mf.registryArtifacts)) {
    if (path === 'registryEntryDigest' || path === 'registry/publisher-assets.v1.json') continue;
    assert.equal(hash(Buffer.from(run('tar', ['-xOf', '/candidate.tgz', 'package/' + path], work))), digest, path);
  }
  const publisher = json('/producer/registry/publisher-assets.v1.json');
  assert.equal(hash(readFileSync('/producer/registry/publisher-assets.v1.json')), mf.registryArtifacts['registry/publisher-assets.v1.json']);
  assert.equal(publisher.tarballSha256, hash(bytes));
  result.publisher = publisher;
  return { sha256: hash(bytes), p3Digest, members: run('tar', ['-tzf', '/candidate.tgz'], work).trim().split('\n').length };
});
let enabled;
await gate('enabled-install', () => { enabled = install('enabled', archives, '1.32.2', false, true); const version = json(join(enabled, 'node_modules/@modelcontextprotocol/sdk/package.json')).version; assert.equal(version, '1.32.2'); return version; });
if (enabled) {
  writeFileSync(join(enabled, 'real-host.mjs'), probes.REAL_HOST_HARNESS);
  for (const [name, code] of [['enabled-probe', probes.ENABLED_PROBE], ['invocation-probe', probes.INVOCATION_PROBE], ['six-tool-probe', probes.SIX_TOOL_PROBE]]) {
    await gate(name, () => probes.runProbe(enabled, name, code));
  }
  await gate('trace-positive-controls', () => {
    const canary = join(work, 'canary');
    const native = join(canary, 'node_modules/fs-ext');
    mkdirSync(native, { recursive: true });
    for (const name of ['mcp-memory.cjs', 'mcp-memory.mjs']) writeFileSync(join(canary, name), '');
    const executable = join(canary, 'node-gyp');
    writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    run('node', ['-e', `require(${JSON.stringify(join(canary, 'mcp-memory.cjs'))});import(${JSON.stringify(join(canary, 'mcp-memory.mjs'))});require('node:child_process').spawnSync(${JSON.stringify(executable)},[],{cwd:${JSON.stringify(native)}});`], work, trace.env);
    probes.runProbe(enabled, 'trace-control-probe', probes.TRACE_CONTROL_PROBE, trace.env);
    const counts = Object.fromEntries(['cjs-load', 'cjs-compile', 'esm-load', 'provider-load', 'store-open', 'identity-bootstrap', 'native-build'].map(kind => [kind, trace.read().filter(row => row.kind === kind).length]));
    assert.ok(Object.values(counts).every(count => count > 0));
    return counts;
  });
}
trace.reset();
const disabled = join(work, 'disabled');
await gate('disabled-install', () => { install('disabled', [], null, true, false); return 'ordinary closure; scripts enabled; optional dependencies included'; });
if (disabled) {
  const rows = trace.read();
  writeFileSync(join(out, 'install-trace.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  result.nativeBuilds = rows.filter(row => row.kind === 'native-build');
  const explained = spawnSync('npm', ['explain', 'better-sqlite3', 'fs-ext', '--json'], { cwd: disabled, encoding: 'utf8' });
  result.dependencyPaths = { exit: explained.status, stdout: explained.stdout, stderr: explained.stderr };
  await gate('disabled-no-native-build', () => probes.assertNoNativeBuildAttempts(readFileSync(join(out, 'disabled-install.log'), 'utf8'), 'disabled install', rows, { moduleDirectories: ['better-sqlite3', 'fs-ext'].map(name => join(disabled, 'node_modules', name)) }));
  trace.reset(); // Measure runtime separately; an install failure above remains a failure.
  await gate('disabled-runtime', () => {
    const markers = probes.runProbe(disabled, 'disabled-probe', probes.DISABLED_PROBE, trace.env);
    const counts = Object.fromEntries(['provider-load', 'store-open', 'identity-bootstrap', 'native-build'].map(kind => [kind, trace.read().filter(row => row.kind === kind).length]));
    assert.ok(Object.values(counts).every(count => count === 0));
    return { markers, counts };
  });
}
await gate('sdk-floor', () => {
  const floor = install('floor', archives, '1.31.0', false, false);
  assert.equal(json(join(floor, 'node_modules/@modelcontextprotocol/sdk/package.json')).version, '1.31.0');
  writeFileSync(join(floor, 'real-host.mjs'), probes.REAL_HOST_HARNESS);
  return [...probes.runProbe(floor, 'floor-probe', probes.FLOOR_PROBE), ...probes.runProbe(floor, 'six-tool-probe', probes.SIX_TOOL_PROBE)];
});
process.exitCode = Object.values(result.gates).some(g => g.status === 'FAIL') ? 1 : 0;
