import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { json, sha256 } from './bindings.mjs';
const root = process.argv[2];
const r = json(readFileSync(`${root}/receipt.json`));
const lines = readFileSync(`${root}/type-files.txt`, 'utf8').split('\n').filter(Boolean);
assert(lines.every((line) => line.startsWith('/evidence/consumer/')), 'type closure escaped consumer');
r.typeClosure = lines.filter((line) => line.includes('/node_modules/') && line.endsWith('.d.ts'))
  .map((line) => line.slice('/evidence/consumer/'.length)).sort();
r.consumer.npmVersion = readFileSync(`${root}/npm-version.txt`, 'utf8').trim();
assert.equal(r.consumer.lockSha256, sha256(readFileSync(`${root}/consumer-lock.json`)));
// The producer manifest function is internal. Expose it only in this in-memory
// inspection module, leaving every installed/archive byte unchanged.
const source = readFileSync(`${root}/consumer/node_modules/@sentropic/engram/dist/memory-substrate.js`, 'utf8');
const inspection = Buffer.from(source + '\nexport { memoryContractManifest };\n').toString('base64');
const substrate = await import(`data:text/javascript;base64,${inspection}`);
const canonicalize = (v) => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
assert.equal(canonicalize(substrate.memoryContractManifest()), readFileSync(`${root}/neutral-contract-1.0.0.jcs.json`, 'utf8'));
writeFileSync(`${root}/receipt.json`, JSON.stringify(r, null, 2) + '\n');
