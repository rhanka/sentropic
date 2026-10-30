import assert from 'node:assert/strict';

export function bindRecordedSnapshot(snapshot, restored) {
  assert.deepEqual(snapshot.receipt, restored, 'embedded snapshot must match the verified on-disk receipt');
  return { ...snapshot, receipt: restored };
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
