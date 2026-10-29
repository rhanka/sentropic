// Replay the delivered source commit's unchanged predicate on the REAL install log.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = resolve('tmp/memory-l5-r5');
const sourcePath = resolve(directory, 'source-observer/acceptance.mjs');
const source = readFileSync(sourcePath, 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
writeFileSync(resolve(directory, 'source-observer/replay.mjs'), source + '\nexport { assertNoNativeBuildAttempts };\n');
const { assertNoNativeBuildAttempts } = await import(pathToFileURL(resolve(directory, 'source-observer/replay.mjs')));
const log = readFileSync(resolve(directory, 'disabled-install.log'), 'utf8');
let failure = null;
try { assertNoNativeBuildAttempts(log, 'disabled install'); }
catch (error) { failure = error.message; }
assert.ok(failure?.includes('native build attempts observed'), 'historical gate failure must reproduce');
assert.ok(log.includes('tree-sitter-lua'));
assert.ok(!log.includes('> fs-ext@') && !log.includes('> better-sqlite3@'));
const result = {
  sourceCommit: '0db169cba322015e1ee1b1bdcab09fdc02440f37',
  sourceSha256: sha256(source),
  installLogSha256: sha256(log),
  gate: 'disabled-install native-build predicate at delivered source commit',
  status: 'FAIL',
  failure,
  classification: 'environment-triggered false attribution in the producer test predicate; no demonstrated memory-native package compile',
  blocksOriginalGate: true,
  waived: false,
};
writeFileSync(resolve(directory, 'source-gate.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = 1;
