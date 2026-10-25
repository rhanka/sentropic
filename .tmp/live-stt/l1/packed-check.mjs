import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const [packFile, tsc] = process.argv.slice(2);
const [pack] = JSON.parse(readFileSync(packFile, 'utf8'));
const required = ['dist/speech/index.js', 'dist/speech/index.d.ts',
  'dist/speech/contracts.js', 'dist/speech/contracts.d.ts',
  'dist/speech/capabilities.js', 'dist/speech/capabilities.d.ts'];
for (const path of required) assert(pack.files.some((file) => file.path === path), path);
const consumer = mkdtempSync(join(tmpdir(), 'live-stt-l1-consumer-'));
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: consumer, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command}: ${result.stdout}\n${result.stderr}`);
};
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(dirname(packFile), pack.filename)]);
run(process.execPath, ['--input-type=module', '--eval', `
  import assert from 'node:assert/strict';
  import * as speech from '@sentropic/llm-mesh/speech';
  import * as root from '@sentropic/llm-mesh';
  assert.deepEqual(Object.keys(speech).sort(), [
    'isValidSpeechAudioFrame', 'negotiateSpeech', 'speechCapabilityNames', 'speechPlacements',
  ]);
  for (const key of Object.keys(speech)) assert.equal(root[key], speech[key]);
  assert.equal(typeof root.getModelSpeechCapabilities, 'function');
`]);
writeFileSync(join(consumer, 'consumer.ts'), `
  import type { SpeechSessionReceipt, SpeechInputFrame, SpeechTranscriptFinal } from '@sentropic/llm-mesh/speech';
  import { negotiateSpeech, getModelSpeechCapabilities, type SpeechCapabilities } from '@sentropic/llm-mesh';
  declare const receipt: SpeechSessionReceipt;
  declare const frame: SpeechInputFrame;
  declare const final: SpeechTranscriptFinal;
  const revision: string = receipt.configuration.configRevision;
  const binary: Uint8Array = frame.payload;
  const caps: SpeechCapabilities | undefined = getModelSpeechCapabilities('openai', 'gpt-6.1-sol');
  // @ts-expect-error Final projections are immutable.
  final.text = 'correction';
  void [revision, binary, caps, negotiateSpeech];
`);
run(tsc, ['--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
  '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts']);
console.log(`Packed import/types PASS: ${pack.name}@${pack.version}, ${required.length} speech artifacts`);

// Check the root lock without creating dependencies in the mounted checkout.
const workspace = mkdtempSync(join(tmpdir(), 'live-stt-l1-workspace-'));
for (const file of ['package.json', 'package-lock.json']) copyFileSync(join('/workspace', file), join(workspace, file));
const lock = JSON.parse(readFileSync(join(workspace, 'package-lock.json'), 'utf8'));
for (const path of Object.keys(lock.packages)) {
  if (!path || path.includes('node_modules') || !existsSync(join('/workspace', path, 'package.json'))) continue;
  mkdirSync(join(workspace, path), { recursive: true });
  copyFileSync(join('/workspace', path, 'package.json'), join(workspace, path, 'package.json'));
}
if (process.argv.includes('--refresh-lock')) {
  const refresh = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: workspace, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(refresh.status, 0, refresh.stderr);
  const refreshed = JSON.parse(readFileSync(join(workspace, 'package-lock.json'), 'utf8'));
  for (const [path, value] of Object.entries(refreshed.packages)) {
    if (JSON.stringify(lock.packages[path]) !== JSON.stringify(value)) console.log(JSON.stringify({ path, value }, null, 2));
  }
  for (const path of Object.keys(lock.packages)) if (!refreshed.packages[path]) console.log(`Removed: ${path}`);
}
const install = spawnSync('npm', ['ci', '--dry-run', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: workspace, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
assert.equal(install.status, 0, `Workspace lock check: ${install.stdout}\n${install.stderr}`);
console.log('Workspace npm ci dry-run PASS');
