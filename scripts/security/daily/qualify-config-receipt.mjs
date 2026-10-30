import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { digest, policy } from './toolchain-contract.mjs';
import { restoreSnapshot } from './toolchain-cache.mjs';
import { bindRecordedSnapshot, summarizeControlReport, validateControlIsolation } from './qualify-config-contract.mjs';

const ingestion = JSON.parse(await readFile('/evidence/ingestion.json'));
assert.deepEqual(Object.keys(ingestion.snapshots).sort(), ['java', 'vulnerability']);
const snapshots = {};
for (const kind of ['vulnerability', 'java']) {
  const snapshot = ingestion.snapshots[kind];
  assert.match(snapshot.path, /^\/evidence\/cache\/(vulnerability|java)-[12]-[a-f0-9]{64}-[0-9]+\.[0-9]+\.[0-9]+$/);
  snapshots[kind] = bindRecordedSnapshot(snapshot, await restoreSnapshot(snapshot), kind);
}
if (process.argv[2] === 'check') process.exit(0);
const root = '/evidence/hostile-config';
const artifacts = {};
for (const name of ['log4j-core-2.14.1.jar', '.trivyignore', 'trivy.yaml',
  'repository-default.json', 'repository-default.log', 'hardened.json', 'hardened.log',
  'repository-default-isolation.json', 'hardened-isolation.json']) {
  artifacts[name] = digest(await readFile(`${root}/${name}`));
}
assert.equal(artifacts['log4j-core-2.14.1.jar'], 'sha256:ade7402a70667a727635d5c4c29495f4ff96f061f12539763f6f123973b465b0');
const reports = {};
const execution = {};
for (const control of ['repository-default', 'hardened']) {
  const observed = JSON.parse(await readFile(`${root}/${control}-isolation.json`));
  execution[control] = validateControlIsolation(observed, control, ingestion.snapshots);
  const report = JSON.parse(await readFile(`${root}/${control}.json`));
  reports[control] = summarizeControlReport(report, control, policy.version);
}
const receipt = { schema: 1, observedAt: new Date().toISOString(), qualified: false,
  scanner: `${policy.repository}@${policy.manifestDigest}`, artifacts,
  execution,
  snapshots, controls: reports,
  verdict: 'hostile repository config suppresses Log4Shell with defaults; explicit null config and ignorefile preserve detection' };
await writeFile(process.argv[2] === 'publish' ? '/receipts/sec5a-config-control.json' : `${root}/receipt.json`,
  `${JSON.stringify(receipt, null, process.argv[2] === 'publish' ? 0 : 2)}\n`);
