import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { sha256 } from './precandidate.mjs';
import { P3_SHA256 } from './lot2-manifest.mjs';
import { PINNED_IMAGE_DIGEST } from './schema-validator.mjs';
import { validateLot3Report } from './lot3-source.mjs';

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
const registry = ['mcp-platform', 'cluster-mesh', 'llm-gateway', 'engram-e2'].map(slug => {
  const path = `tmp/lot3-inputs/${slug}-registry.json`, bytes = readFileSync(path), pkg = JSON.parse(bytes);
  return { name: pkg.name, version: pkg.version, integrity: pkg.dist.integrity, tarball: pkg.dist.tarball,
    observedAt: statSync(path).mtime.toISOString(), metadataSha256: sha256(bytes), sourceHead: pkg.gitHead ?? null };
});
const e4 = '26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10';
const archive = `spec/evidence/memory-mcp-l5/lot2/archives/${e4}.tgz`;
if (sha256(readFileSync(archive)) !== e4) throw Error('Lot 3 retained E4 mismatch');
const result = { status: 'source-only', qualificationAccepted: false, sourceHead: summary.sourceHead,
  preCandidateSha256: P3_SHA256, catalogSha256: summary.catalogSha256, reports, registry,
  candidate: { archive, sha256: e4, status: 'input only; compatible successor required' },
  runtime: { imageDigest: PINNED_IMAGE_DIGEST, nodeVersion: process.versions.node, pythonExecutablePresent: false },
  waitingFor: ['gr-conductor verified lot2-manifest/sidecar and full host closure/G1-G4/C9 dispositions',
    'S1 and a co-accepted successor freeze/compatible E4', 'same-tuple installed P01-P08 and durable E4 reruns',
    'owner UAT and tuple-bound co-acceptances before L5-MEMORY-V1'] };
writeFileSync(`${base}/source-evidence.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ sourceHead: result.sourceHead, reports: reports.map(r => [r.kind, r.passed]), qualificationAccepted: false }));
