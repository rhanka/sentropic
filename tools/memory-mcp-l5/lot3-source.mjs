import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256 } from './precandidate.mjs';
import { P3_SHA256 } from './lot2-manifest.mjs';
import { verifyRetainedP3 } from './lot2-retained.mjs';
import { catalogDispositions, WAITING_FOR } from './lot3-dispositions.mjs';

/** Source/regression inventory only. It never emits an installed-consumer proof or checkpoint. */
export function selectLot3Files(catalog) {
  const rows = catalog.proofs.filter(p => p.id === 'P09');
  const predecessors = rows[0]?.files;
  if (rows.length !== 1 || !Array.isArray(predecessors) || predecessors.length !== 18 ||
    new Set(predecessors).size !== 18 || !predecessors.includes('packages/mcp-platform/tests/wire-parity.test.ts')) {
    throw Error('Lot 3 requires the unchanged 18-file P09 inventory');
  }
  const extra = catalogDispositions(catalog, () => true).filter(row => row.status === 'run-here').map(row => row.file);
  const files = [...new Set([...predecessors, ...extra])];
  const select = pkg => files.filter(f => f.startsWith(`packages/${pkg}/`)).map(f => f.slice(`packages/${pkg}/`.length));
  return { predecessors, platform: select('mcp-platform'), mesh: select('cluster-mesh'), broker: select('mcp-broker') };
}

export function validateLot3Report(report, files, packageRoot) {
  if (report.success !== true || !Array.isArray(report.testResults) || !report.numPassedTests ||
    report.numFailedTests || report.numPendingTests || report.numTodoTests) throw Error('Lot 3 requires zero failed/skipped/todo tests');
  for (const file of files) {
    const row = report.testResults.find(r => resolve(r.name) === resolve(packageRoot, file));
    if (!row || row.status !== 'passed' || !row.assertionResults?.length ||
      row.assertionResults.some(t => t.status !== 'passed')) throw Error(`Lot 3 missing complete file report: ${file}`);
  }
}

export function runLot3Source(root, reports, retainedRoot) {
  const p3 = readFileSync(join(root, 'tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json'));
  if (sha256(p3) !== P3_SHA256) throw Error('Lot 3 frozen P3 mismatch');
  const catalogBytes = readFileSync(join(root, 'tools/memory-mcp-l5/proof-catalog-v1.json'));
  if (JSON.parse(p3).contractInventory.find(row => row.path === 'tools/memory-mcp-l5/proof-catalog-v1.json')?.sha256 !== sha256(catalogBytes)) {
    throw Error('Lot 3 frozen proof catalog mismatch');
  }
  const catalog = JSON.parse(catalogBytes), selected = selectLot3Files(catalog);
  const platformArchiveSha256 = sha256(readFileSync(process.env.MEMORY_L5_PLATFORM_ARCHIVE));
  if (platformArchiveSha256 !== '67c9ab88ae51087a21a596facfc8330dea4c43128878c261a4136b6d458885e5') {
    throw Error('Lot 3 requires the published platform 0.4.0 archive');
  }
  verifyRetainedP3(root, 'tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json');
  const inventory = JSON.parse(p3).contractInventory;
  const platform = JSON.parse(readFileSync(join(root, 'packages/mcp-platform/package.json')));
  if (platform.version !== JSON.parse(p3).artifacts.find(a => a.role === 'platform').version) {
    throw Error('Lot 3 packages/mcp-platform/package.json version differs from frozen P3');
  }
  const dispositions = catalogDispositions(catalog, file => existsSync(resolve(root, file)));
  console.log(JSON.stringify({ dispositions, waitingFor: WAITING_FOR }));
  const immutable = {
    'packages/mcp-platform/tests/wire-parity.test.ts': '7845d6ecf60abd2886bd5efe7cb51fb6eb8d94e16692c953150a6bcdf125f0a1',
    'packages/mcp-platform/src/mock/fake-connector.ts': 'e39bf13a45a762fed758e385a908702af6c317e402a215c1e809a0bfe24ab9c5',
  };
  for (const [file, digest] of Object.entries(immutable)) {
    if (sha256(readFileSync(join(root, file))) !== digest) throw Error(`Lot 3 immutable fixture changed: ${file}`);
  }
  for (const file of [...selected.predecessors, ...selected.platform.map(f => `packages/mcp-platform/${f}`),
    ...selected.mesh.map(f => `packages/cluster-mesh/${f}`)]) {
    if (relative(root, resolve(root, file)).startsWith('..') || !existsSync(resolve(root, file))) throw Error(`Lot 3 required file absent: ${file}`);
  }
  mkdirSync(reports, { recursive: true });
  const summary = { sourceOnly: true, qualificationAccepted: false, preCandidateSha256: P3_SHA256,
    runtimePlatform: { version: '0.4.0', publishedBytes: true,
      archiveSha256: platformArchiveSha256 },
    sourceHead: process.env.MEMORY_L5_SOURCE_HEAD ?? null, node: process.version,
    catalogSha256: sha256(catalogBytes), predecessorFiles: selected.predecessors, packages: {},
    inventory: { authority: 'frozen P3 archive closure and ancillary files', rows: inventory, drift: [] },
    dispositions, waitingFor: WAITING_FOR };
  for (const [pkg, files] of [['mcp-platform', selected.platform], ['cluster-mesh', selected.mesh], ['mcp-broker', selected.broker]]) {
    const packageRoot = join(root, 'packages', pkg), reportPath = join(reports, `${pkg}.json`);
    const run = spawnSync(process.execPath, [join(process.env.NODE_PATH, 'vitest/vitest.mjs'), 'run', ...files,
      '--environment', 'node', '--maxWorkers=1', '--reporter=json', `--outputFile=${reportPath}`], { cwd: packageRoot, stdio: 'inherit' });
    if (run.error || run.status !== 0) throw Error(`Lot 3 ${pkg} failed: ${run.error?.message ?? run.status}`);
    const bytes = readFileSync(reportPath), report = JSON.parse(bytes);
    validateLot3Report(report, files, packageRoot);
    summary.packages[pkg] = { files, passed: report.numPassedTests, reportSha256: sha256(bytes) };
  }
  summary.immutableFixtures = Object.fromEntries(catalog.immutableFixtures.map(file => [file, sha256(readFileSync(join(root, file)))]));
  summary.retainedRoot = retainedRoot;
  writeFileSync(join(reports, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLot3Source(resolve(process.argv[2]), resolve(process.argv[3]), resolve(process.argv[4]));
}
