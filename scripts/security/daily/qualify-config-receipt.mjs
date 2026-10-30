import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { digest, policy } from './toolchain-contract.mjs';
import { restoreSnapshot } from './toolchain-cache.mjs';

const ingestion = JSON.parse(await readFile('/evidence/ingestion.json'));
for (const snapshot of Object.values(ingestion.snapshots)) {
  assert.match(snapshot.path, /^\/evidence\/cache\/(vulnerability|java)-[12]-[a-f0-9]{64}-[0-9]+\.[0-9]+\.[0-9]+$/);
  await restoreSnapshot(snapshot);
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
  assert.equal(observed.Config.Image, `${policy.repository}@${policy.manifestDigest}`);
  assert.equal(observed.Image, policy.manifestDigest);
  assert.equal(observed.Config.User, '65532:65532');
  assert.equal(observed.HostConfig.NetworkMode, 'none');
  assert.equal(observed.HostConfig.ReadonlyRootfs, true);
  assert.equal(observed.HostConfig.Memory, 4 * 1024 ** 3);
  assert.equal(observed.HostConfig.NanoCpus, 1000000000);
  assert.equal(observed.HostConfig.PidsLimit, 128);
  assert.deepEqual(observed.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual([...observed.Config.environmentNames].sort(), ['HOME', 'PATH']);
  assert.ok(observed.HostConfig.SecurityOpt.includes('no-new-privileges'));
  assert.equal(observed.Mounts.length, 5);
  assert.ok(observed.Mounts.every(mount => mount.Type === 'bind' && mount.RW === false));
  assert.ok(observed.Mounts.some(mount => mount.Destination === '/payload' &&
    mount.Source.endsWith('/tmp/security-qualify/hostile-config')));
  if (control === 'hardened') {
    for (const flag of ['--config', '--ignorefile']) assert.equal(observed.Args[observed.Args.indexOf(flag) + 1], '/dev/null');
  }
  for (const [kind, file, destination] of [['vulnerability', 'trivy.db', '/cache/db'], ['java', 'trivy-java.db', '/cache/java-db']]) {
    for (const name of [file, 'metadata.json']) {
      assert.ok(observed.Mounts.some(mount => mount.Destination === `${destination}/${name}` &&
        mount.Source.endsWith(`${ingestion.snapshots[kind].path.slice('/evidence'.length)}/${name}`)));
    }
  }
  execution[control] = { scanner: observed.Config.Image, imageStoreIdentity: observed.Image, ...observed.HostConfig,
    user: observed.Config.User, environmentNames: observed.Config.environmentNames,
    mounts: observed.Mounts.map(({ Type, Destination, RW }) => ({ Type, Destination, RW })) };
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
  execution,
  snapshots: ingestion.snapshots, controls: reports,
  verdict: 'hostile repository config suppresses Log4Shell with defaults; explicit null config and ignorefile preserve detection' };
await writeFile(process.argv[2] === 'publish' ? '/receipts/sec5a-config-control.json' : `${root}/receipt.json`,
  `${JSON.stringify(receipt, null, process.argv[2] === 'publish' ? 0 : 2)}\n`);
