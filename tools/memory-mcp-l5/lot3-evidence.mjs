import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { sha256 } from './precandidate.mjs';
import { P3_SHA256 } from './lot2-manifest.mjs';
import { PINNED_IMAGE_DIGEST } from './schema-validator.mjs';
import { validateLot3Report } from './lot3-source.mjs';
import { PUBLICATIONS, verifyPublication } from './lot3-publications.mjs';
import { WAITING_FOR } from './lot3-dispositions.mjs';

const base = 'spec/evidence/memory-mcp-l5/lot3', input = 'tmp/memory-l5-lot3-results';
const summary = JSON.parse(readFileSync(`${input}/summary.json`));
if (summary.sourceHead !== process.argv[2] || summary.sourceOnly !== true || summary.qualificationAccepted !== false ||
  summary.preCandidateSha256 !== P3_SHA256) throw Error('Lot 3 requires current-head source reports');
const python = spawnSync('sh', ['-c', 'command -v python; command -v python3'], { encoding: 'utf8' });
if (python.stdout.trim()) throw Error('Lot 3 runtime contains Python');
mkdirSync(`${base}/reports`, { recursive: true });
const retain = (kind, bytes, passed = null) => {
  const compressed = gzipSync(bytes), digest = sha256(compressed), path = `${base}/reports/${digest}.json.gz`;
  writeFileSync(path, compressed);
  return { kind, path, sha256: digest, uncompressedSha256: sha256(bytes), passed };
};
const reports = [];
for (const [pkg, expected] of Object.entries(summary.packages)) {
  const bytes = readFileSync(`${input}/${pkg}.json`), report = JSON.parse(bytes);
  if (sha256(bytes) !== expected.reportSha256) throw Error(`Lot 3 ${pkg} report digest mismatch`);
  const first = expected.files[0], row = report.testResults.find(file => file.name.endsWith('/' + first));
  if (!row) throw Error('Lot 3 report root absent');
  validateLot3Report(report, expected.files, row.name.slice(0, -first.length));
  reports.push(retain(pkg, bytes, report.numPassedTests));
}
reports.push(retain('summary', readFileSync(`${input}/summary.json`)));
const receiptBytes = readFileSync('tmp/lot3-inputs/publication-receipts.json'), observed = JSON.parse(receiptBytes);
const lockBytes = readFileSync('tmp/lot3-inputs/registry-lock/package-lock.json'), lock = JSON.parse(lockBytes);
if (sha256(lockBytes) !== observed.lockSha256 || observed.receipts.length !== 4) throw Error('Publication lock/receipt mismatch');
const registry = Object.entries(PUBLICATIONS).map(([slug, version]) => {
  const name = `@sentropic/${slug}`, receipt = observed.receipts.find(row => row.name === name);
  if (!receipt || receipt.lockSha256 !== observed.lockSha256 ||
      receipt.metadataSha256 !== sha256(readFileSync(`tmp/lot3-inputs/${slug === 'engram' ? 'engram-e2' : slug}-registry.json`))) {
    throw Error(`Publication receipt absent or changed: ${name}`);
  }
  const bytes = readFileSync(`tmp/lot3-inputs/published-${slug}-${version}.tgz`);
  const checked = verifyPublication(receipt.metadata, bytes, lock.packages[`node_modules/${name}`], name, version);
  if (checked.archiveSha256 !== receipt.archiveSha256) throw Error(`Publication archive changed: ${name}`);
  return { ...checked, observedAt: receipt.observedAt };
});
reports.push(retain('publication-observations', receiptBytes));
reports.push(retain('publication-lock', lockBytes));
const e4 = '26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10';
const archive = `spec/evidence/memory-mcp-l5/lot2/archives/${e4}.tgz`;
if (sha256(readFileSync(archive)) !== e4) throw Error('Lot 3 retained E4 mismatch');
const result = { status: 'source-only', qualificationAccepted: false, sourceHead: summary.sourceHead,
  runtimePlatform: summary.runtimePlatform,
  preCandidateSha256: P3_SHA256, catalogSha256: summary.catalogSha256, reports, registry,
  candidate: { archive, sha256: e4, status: 'input only; same frozen tuple installed qualification pending' },
  runtime: { imageDigest: PINNED_IMAGE_DIGEST, nodeVersion: process.versions.node, pythonExecutablePresent: false },
  dispositions: { reportKind: 'summary', total: summary.dispositions.length,
    outOfLot: summary.dispositions.filter(row => row.status === 'out-of-lot').length,
    blocked: summary.dispositions.filter(row => row.status === 'blocked: platform-admitBridgeTools') },
  inventory: { reportKind: 'summary', rows: summary.inventory.rows.length, drift: summary.inventory.drift }, waitingFor: WAITING_FOR };
const output = JSON.stringify(result, null, 2).replace(/\{\n\s+"(?:kind|name|id)": [^{}]+\}/g, row => JSON.stringify(JSON.parse(row)));
writeFileSync(`${base}/source-evidence.json`, output + '\n');
console.log(JSON.stringify({ sourceHead: result.sourceHead, reports: reports.map(r => [r.kind, r.passed]), qualificationAccepted: false }));
