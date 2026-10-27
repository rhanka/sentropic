import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [dir, receipt] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8'));
const files = new Set(JSON.parse(fs.readFileSync(receipt, 'utf8'))[0].files.map((f) => f.path));
assert.equal(manifest.version, '0.23.0');
for (const name of ['config', 'projection', 'index']) {
  for (const suffix of ['js', 'd.ts']) assert(files.has(`dist/speech/${name}.${suffix}`));
}
assert.equal(manifest.exports['./speech'].import, './dist/speech/index.js');
const root = await import(pathToFileURL(`${dir}/dist/index.js`).href);
const speech = await import(pathToFileURL(`${dir}/dist/speech/index.js`).href);
assert.equal(root.resolveSpeechProfiles, speech.resolveSpeechProfiles);
assert.equal(typeof speech.projectSpeechProfile, 'function');
assert.equal(typeof speech.rebindSpeechProfile, 'function');
assert.equal(root.projectSpeechProfile, undefined);
assert.deepEqual(root.resolveClusterMeshConfig({ capacity: { poolSize: 1 } }), {
  capacity: { poolSize: 1, maxConcurrent: 12 },
});
// Native ESM must refuse old/missing exports before Node links the optional peer.
for (const [version, hasExport, hasMembers, expected] of [
  ['0.19.2', false, false, 'incompatible_version'],
  ['0.22.0', false, false, 'incompatible_version'],
  ['0.27.1', false, false, 'incompatible_version'],
  ['0.28.0', false, false, 'export_unavailable'],
  ['0.28.0', true, false, 'export_unavailable'],
  ['0.28.0', true, true, 'imported'],
]) {
  const temp = fs.mkdtempSync(join(tmpdir(), 'speech-peer-'));
  try {
    const cluster = join(temp, 'node_modules/@sentropic/cluster-mesh');
    const mesh = join(temp, 'node_modules/@sentropic/llm-mesh');
    fs.mkdirSync(cluster, { recursive: true }); fs.mkdirSync(mesh, { recursive: true });
    fs.cpSync(`${dir}/dist`, join(cluster, 'dist'), { recursive: true });
    fs.writeFileSync(join(cluster, 'package.json'), JSON.stringify(manifest));
    fs.writeFileSync(join(mesh, 'package.json'), JSON.stringify({ name: '@sentropic/llm-mesh',
      type: 'module', version, exports: hasExport ? { './speech': './speech.js' } : {} }));
    fs.writeFileSync(join(mesh, 'speech.js'), hasMembers
      ? 'export const getModelSpeechCapabilities = () => []; export const negotiateSpeech = () => ({});'
      : 'export const unrelated = true;');
    const probe = join(temp, 'probe.mjs');
    fs.writeFileSync(probe, `
      try { await import('@sentropic/cluster-mesh/speech'); console.log('imported'); }
      catch (error) {
        if (error.code !== 'cluster_mesh_module_unavailable') throw error;
        console.log(error.reason);
      }`);
    const result = spawnSync(process.execPath, [probe], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected, `${version}/${hasExport}/${hasMembers}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
console.log('L1c strict source/test types, lint, build and public packed-content checks passed');
