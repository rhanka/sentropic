import assert from 'node:assert/strict';
import { policy } from './toolchain-contract.mjs';

export function bindRecordedSnapshot(snapshot, restored, kind) {
  assert.equal(restored.kind, kind, 'restored snapshot kind must match the selected mount');
  assert.deepEqual(snapshot.receipt, restored, 'embedded snapshot must match the verified on-disk receipt');
  return { ...snapshot, receipt: restored };
}

export function validateControlIsolation(observed, control, snapshots) {
  assert.equal(observed.Config.Image, `${policy.repository}@${policy.manifestDigest}`);
  assert.equal(observed.Image, policy.manifestDigest);
  assert.equal(observed.Config.User, '65532:65532');
  assert.equal(observed.HostConfig.NetworkMode, 'none');
  assert.equal(observed.HostConfig.ReadonlyRootfs, true);
  assert.equal(observed.HostConfig.Memory, 4 * 1024 ** 3);
  assert.equal(observed.HostConfig.NanoCpus, 1000000000);
  assert.equal(observed.HostConfig.PidsLimit, 128);
  assert.equal(observed.HostConfig.Privileged, false);
  assert.deepEqual(observed.HostConfig.CapAdd, null);
  assert.deepEqual(observed.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual([...observed.Config.environmentNames].sort(), ['HOME', 'PATH']);
  assert.ok(observed.HostConfig.SecurityOpt.includes('no-new-privileges'));
  assert.equal(observed.Mounts.length, 5);
  assert.ok(observed.Mounts.every(mount => mount.Type === 'bind' && mount.RW === false));
  assert.ok(observed.Mounts.some(mount => mount.Destination === '/payload' &&
    mount.Source.endsWith('/tmp/security-qualify/hostile-config')));
  if (control === 'hardened') {
    for (const flag of ['--config', '--ignorefile']) assert.equal(observed.Args[observed.Args.indexOf(flag) + 1], '/dev/null');
  } else assert.equal(control, 'repository-default');
  for (const [kind, file, destination] of [['vulnerability', 'trivy.db', '/cache/db'], ['java', 'trivy-java.db', '/cache/java-db']]) {
    for (const name of [file, 'metadata.json']) {
      assert.ok(observed.Mounts.some(mount => mount.Destination === `${destination}/${name}` &&
        mount.Source.endsWith(`${snapshots[kind].path.slice('/evidence'.length)}/${name}`)));
    }
  }
  return { scanner: observed.Config.Image, imageStoreIdentity: observed.Image, ...observed.HostConfig,
    user: observed.Config.User, environmentNames: observed.Config.environmentNames,
    mounts: observed.Mounts.map(({ Type, Destination, RW }) => ({ Type, Destination, RW })) };
}

export function summarizeControlReport(report, control, version) {
  assert.equal(report.SchemaVersion, 2);
  assert.equal(report.ArtifactName, '/payload');
  assert.equal(report.ArtifactType, 'filesystem');
  assert.equal(report.Trivy?.Version, version);
  const findings = (report.Results ?? []).flatMap(result => result.Vulnerabilities ?? [])
    .map(({ VulnerabilityID: id, PkgName: pkg, InstalledVersion: version, Severity: severity }) =>
      ({ id, pkg, version, severity }));
  if (control === 'repository-default') assert.equal(findings.length, 0);
  else {
    assert.equal(control, 'hardened');
    assert.ok(findings.some(f => f.id === 'CVE-2021-44228' && f.version === '2.14.1' &&
      f.pkg === 'org.apache.logging.log4j:log4j-core' && f.severity === 'CRITICAL'));
  }
  return findings;
}
