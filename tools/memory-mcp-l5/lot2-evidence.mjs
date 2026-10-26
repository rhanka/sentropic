import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { sha256Hex, PINNED_IMAGE_DIGEST } from './schema-validator.mjs';
const base = 'spec/evidence/memory-mcp-l5/lot2', reports = [];
for (const kind of ['reference', 'tooling']) {
  const bytes = readFileSync(`tmp/memory-l5-lot2/${kind}-results.json`), doc = JSON.parse(bytes);
  if (doc.success !== true || !doc.numPassedTests || doc.numFailedTests || doc.numPendingTests || doc.numTodoTests ||
      doc.testResults.some(file => !file.assertionResults.length || file.assertionResults.some(a => a.status !== 'passed'))) throw Error(`${kind}: incomplete tests`);
  const compressed = gzipSync(bytes), sha256 = sha256Hex(compressed), path = `${base}/reports/${sha256}.json.gz`;
  mkdirSync(`${base}/reports`, { recursive: true }); writeFileSync(path, compressed);
  reports.push({ kind, path, sha256, tests: doc.numPassedTests,
    files: doc.testResults.map(file => ({ path: file.name.replace(/^\/workspace\//, ''), assertions: file.assertionResults.length, status: file.status })) });
}
const sources = [];
const collect = path => {
  for (const file of readdirSync(path, { withFileTypes: true })) {
    const next = join(path, file.name);
    if (file.isDirectory()) collect(next);
    else sources.push({ path: next, sha256: sha256Hex(readFileSync(next)) });
  }
};
collect('packages/mcp-broker/src/memory-reference');
for (const path of ['tools/memory-mcp-l5/verifier.mjs', 'tools/memory-mcp-l5/lot2-manifest.mjs']) sources.push({ path, sha256: sha256Hex(readFileSync(path)) });
const python = spawnSync('sh', ['-c', 'command -v python; command -v python3'], { encoding: 'utf8' });
if (python.stdout.trim()) throw Error('runtime contains Python');
const directory = mkdtempSync(join(tmpdir(), 'l5-probe-'));
let runtime;
try {
  const db = new DatabaseSync(join(directory, 'runtime.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    runtime = { imageDigest: PINNED_IMAGE_DIGEST, nodeVersion: process.versions.node,
      sqliteVersion: db.prepare('SELECT sqlite_version() AS v').get().v,
      journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode, synchronous: db.prepare('PRAGMA synchronous').get().synchronous,
      temporaryFilesystemType: statfsSync(directory).type, pythonExecutablePresent: false,
      nativeAddonCompilation: 'not used by the built-in SQLite workflow reference' };
  } finally { db.close(); }
} finally { rmSync(directory, { recursive: true, force: true }); }
const result = { status: 'unverified', qualificationAccepted: false, scope: 'source reference and receiving harness only',
  sourceHead: process.argv[2], reports, runtime, sources,
  waitingFor: ['real P3/E2/PG lot2-manifest and sidecar', 'installed closure and G1-G4/C9 dispositions',
    'canonical effect/original replay and all required E2 crash points', 'production enrollment/assurance mapping',
    'final E4 rerun and checkpoint acceptance'] };
// Compact report rows retain every file; the complete assertion reports are retained by hash.
const output = JSON.stringify(result, null, 2).replace(/\{\n\s+"path": [^{}]+\}/g, match => JSON.stringify(JSON.parse(match)));
writeFileSync(`${base}/reference-evidence.json`, output + '\n');
console.log(JSON.stringify({ tests: reports.map(r => [r.kind, r.tests]), qualificationAccepted: false, runtime }));
