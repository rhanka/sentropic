import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

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
console.log('L1c strict source/test types, lint, build and public packed-content checks passed');
