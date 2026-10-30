import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { digest, policy } from './toolchain-contract.mjs';
import { restoreSnapshot } from './toolchain-cache.mjs';

const ingestion = JSON.parse(await readFile('/evidence/ingestion.json'));
for (const snapshot of Object.values(ingestion.snapshots)) await restoreSnapshot(snapshot);
if (process.argv[2] === 'check') process.exit(0);
const root = '/evidence/hostile-config';
const artifacts = {};
for (const name of ['log4j-core-2.14.1.jar', '.trivyignore', 'trivy.yaml',
  'repository-default.json', 'repository-default.log', 'hardened.json', 'hardened.log']) {
  artifacts[name] = digest(await readFile(`${root}/${name}`));
}
const reports = {};
for (const control of ['repository-default', 'hardened']) {
  const report = JSON.parse(await readFile(`${root}/${control}.json`));
  assert.equal(report.SchemaVersion, 2);
  assert.equal(report.ArtifactName, '/payload');
  assert.equal(report.ArtifactType, 'filesystem');
  reports[control] = (report.Results ?? []).flatMap(result => result.Vulnerabilities ?? [])
    .map(({ VulnerabilityID: id, PkgName: pkg, InstalledVersion: version, Severity: severity }) =>
      ({ id, pkg, version, severity }));
}
assert.ok(!reports['repository-default'].some(f => f.id === 'CVE-2021-44228'));
assert.ok(reports.hardened.some(f => f.id === 'CVE-2021-44228' && f.version === '2.14.1' && f.severity === 'CRITICAL'));
const receipt = { schema: 1, observedAt: new Date().toISOString(), qualified: false,
  scanner: `${policy.repository}@${policy.manifestDigest}`, artifacts,
  isolation: { network: 'none', uid: 65532, readOnlyRoot: true, readOnlyTargetAndDB: true,
    credentials: false, daemonSocket: false, droppedCapabilities: 'ALL', noNewPrivileges: true },
  snapshots: ingestion.snapshots, controls: reports,
  verdict: 'hostile repository config suppresses Log4Shell with defaults; explicit null config and ignorefile preserve detection' };
await writeFile('/evidence/hostile-config/receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
