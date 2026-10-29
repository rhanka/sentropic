import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readArchive } from './contract-graph.mjs';
import { sha256Hex, sha512Integrity } from './schema-validator.mjs';
const directory = mkdtempSync(join(tmpdir(), 'l5-reference-pack-'));
try {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
    { cwd: 'packages/mcp-broker', encoding: 'utf8' }));
  const bytes = readFileSync(join(directory, packed.filename)), files = readArchive(bytes);
  const pkg = JSON.parse(files.get('package.json'));
  if (pkg.name !== '@sentropic/mcp-broker' || pkg.version !== '0.2.0' ||
      pkg.exports?.['./memory-reference']?.import !== './dist/memory-reference/index.js' ||
      !files.has('dist/memory-reference/index.d.ts')) throw Error('reference packed export mismatch');
  const root = files.get('dist/index.js').toString();
  if (/\b(?:from|import)\s*(?:\(\s*)?['"][^'"]*(?:memory-reference|node:sqlite)/.test(root)) throw Error('broker root activates the reference');
  const referenceFiles = [...files].filter(([path]) => path.startsWith('dist/memory-reference/'));
  if (!referenceFiles.length || !referenceFiles.some(([, body]) => body.toString().includes("import('node:sqlite')"))) throw Error('explicit built-in SQLite activation missing');
  const base = 'spec/evidence/memory-mcp-l5/lot2', sha256 = sha256Hex(bytes), path = `${base}/archives/${sha256}.tgz`;
  mkdirSync(`${base}/archives`, { recursive: true }); writeFileSync(path, bytes);
  const binding = { status: 'unverified', qualificationAccepted: false, scope: 'reference artifact; outside frozen P3',
    sourceHead: process.argv[2], name: pkg.name, version: pkg.version, path, sha256, integrity: sha512Integrity(bytes),
    referenceExport: '@sentropic/mcp-broker/memory-reference',
    files: referenceFiles.map(([path, bytes]) => ({ path, sha256: sha256Hex(bytes) })) };
  const output = JSON.stringify(binding, null, 2).replace(/\{\n\s+"path": [^{}]+\}/g, m => JSON.stringify(JSON.parse(m)));
  writeFileSync(`${base}/reference-artifact.json`, output + '\n');
  console.log(JSON.stringify({ path, sha256, referenceExport: binding.referenceExport, qualificationAccepted: false }));
} finally { rmSync(directory, { recursive: true, force: true }); }
