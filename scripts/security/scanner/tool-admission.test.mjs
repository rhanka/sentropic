import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { digest } from '../daily/toolchain-contract.mjs';
import { validateToolSelfSca } from './tool-qualification.mjs';
import { admitToolCandidate, validateAdmissionReceipt } from './tool-admission.mjs';
import { toolFixture, fixtureNow } from './tool-fixture.mjs';

const admit = (f, overrides = {}) => admitToolCandidate({ ...f, ...overrides });

test('should produce a candidate-bound tool admission receipt without production admission', () => {
  const f = toolFixture();
  const receipt = admit(f);
  assert.equal(receipt.type, 'ToolAdmissionReceiptV1');
  assert.equal(receipt.candidateBound, true);
  assert.equal(receipt.contractValid, true);
  assert.equal(receipt.productionAdmitted, false);
  assert.equal(receipt.tools.length, 5);
  for (const tool of receipt.tools) {
    assert.match(tool.digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(tool.selfScaDigest, /^sha256:/);
    assert.match(tool.dependenciesDigest, /^sha256:/);
    assert.match(tool.zeroPythonDigest, /^sha256:/);
  }
  assert.equal(receipt.review.disposition, 'approved');
  assert.equal(receipt.inventoryDigest, digest(JSON.stringify(f.inventory)));
  assert.deepEqual(validateAdmissionReceipt(receipt, f), { contractValid: true, productionAdmitted: false });
});

test('should refuse admission while any tool pin is pending, on review gaps and on expired root bootstrap', () => {
  const f = toolFixture();
  const up = f.inventory.roles.find(r => r.role === 'uploader');
  for (const key of ['version', 'releaseTag', 'asset', 'releaseAssetDigest']) delete up[key];
  up.url = null; up.digest = null; up.size = null; up.pendingReason = 'pending the A08 reviewed workflow pin';
  assert.throws(() => admit(f), /scanner-contract: pending tool pins/);
  for (const review of [undefined, { identity: 'r', model: 'm', disposition: 'rejected', digest: digest('x') },
    { identity: 'r', model: 'm', disposition: 'approved', digest: 'sha256:pending' }]) {
    assert.throws(() => admit(toolFixture(), { review }), /scanner-contract/);
  }
  const expired = toolFixture();
  const rb = expired.inventory.roles.find(r => r.role === 'root-bootstrap');
  rb.refreshBy = '2026-11-01T12:00:00Z';
  const custody = JSON.parse(expired.evidenceFiles.trustCustody.toString('utf8'));
  custody.refreshBy = rb.refreshBy;
  expired.evidenceFiles.trustCustody = Buffer.from(JSON.stringify(custody));
  expired.inventory.evidence.trustCustody = digest(expired.evidenceFiles.trustCustody);
  assert.throws(() => admit(expired), /scanner-contract: root bootstrap expired/);
});

test('should refuse wrong-binary, self-scanned, stale, incomplete and tampered self-SCA reports', () => {
  const f = toolFixture();
  const verifier = f.inventory.roles.find(r => r.role === 'verifier');
  const base = f.reports.verifier;
  assert.equal(validateToolSelfSca(verifier, base, { now: fixtureNow }).highCritical, 0);
  const wrongBinary = structuredClone(base); wrongBinary.target.digest = digest('other binary');
  assert.throws(() => validateToolSelfSca(verifier, wrongBinary, { now: fixtureNow }), /scanner-contract: wrong-binary/);
  const selfScan = structuredClone(base); selfScan.scanner.digest = verifier.digest;
  assert.throws(() => validateToolSelfSca(verifier, selfScan, { now: fixtureNow }), /scanner-contract: self-scan/);
  const stale = structuredClone(base); stale.db.NextUpdate = '2026-11-02T11:00:00Z';
  assert.throws(() => validateToolSelfSca(verifier, stale, { now: fixtureNow }), /coverage-blocked/);
  const future = structuredClone(base); future.scannedAt = '2026-11-02T13:00:00Z';
  assert.throws(() => validateToolSelfSca(verifier, future, { now: fixtureNow }), /scanner-contract/);
  const dropped = structuredClone(base); dropped.severityCounts.LOW = 0;
  assert.throws(() => validateToolSelfSca(verifier, dropped, { now: fixtureNow }), /scanner-contract: severity/);
  const miscounted = structuredClone(base); miscounted.severityCounts.MEDIUM = 1;
  assert.throws(() => validateToolSelfSca(verifier, miscounted, { now: fixtureNow }), /scanner-contract: severity/);
  const afterDownload = structuredClone(base); afterDownload.scannedAt = '2026-11-02T10:00:00Z';
  assert.throws(() => validateToolSelfSca(verifier, afterDownload, { now: fixtureNow }), /scanner-contract/);
});

test('should refuse vulnerable tools even with a well-formed fresh independent report', async () => {
  const f = toolFixture();
  const old = JSON.parse(await readFile(new URL('../../../docs/security/sec-s2b-qualify/self-scans.json', import.meta.url), 'utf8'));
  const report = old['verifier-self-report.json'].value;
  const counts = { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const v of report.Results.flatMap(r => r.Vulnerabilities ?? [])) counts[v.Severity] += 1;
  const findings = report.Results.flatMap(r => r.Vulnerabilities ?? []).map(v => ({ id: v.VulnerabilityID, severity: v.Severity }));
  const vulnerable = { ...f.reports.verifier, severityCounts: counts, findings };
  assert.ok(counts.CRITICAL > 0 && counts.HIGH > 0, 'dated Cosign 3.0.2 report is the vulnerable negative');
  assert.equal(validateToolSelfSca(f.inventory.roles[0], vulnerable, { now: fixtureNow }).highCritical, counts.HIGH + counts.CRITICAL);
  assert.throws(() => admit(f, { reports: { ...f.reports, verifier: vulnerable } }), /scanner-contract: vulnerable tool/);
});

test('should refuse omitted, extra or changed embedded dependencies', () => {
  const f = toolFixture();
  const deps = f.dependencies.verifier;
  for (const mutate of [
    d => { d.embedded.pop(); },
    d => { d.inventory.pop(); },
    d => { d.embedded[0].version = 'v9.9.9'; },
    d => { d.inventory.push({ path: 'github.com/example/c', version: 'v3.0.0' }); },
  ]) {
    const g = toolFixture(); mutate(g.dependencies.verifier);
    assert.throws(() => admit(g), /scanner-contract/);
  }
  const miscounted = toolFixture();
  miscounted.inventory.roles.find(r => r.role === 'verifier').dependencyCount = 3;
  assert.throws(() => admit(miscounted), /scanner-contract: declared dependency count/);
  assert.doesNotThrow(() => admit(f));
});

test('should refuse missing, misbound or python-present zero-Python evidence', () => {
  for (const mutate of [
    f => { delete f.zeroPython.verifier; },
    f => { f.zeroPython.verifier.targetDigest = digest('other'); },
    f => { f.zeroPython.verifier.pythonAbsent = false; },
    f => { f.zeroPython.verifier.probeDigest = 'sha256:pending'; },
  ]) {
    const g = toolFixture(); mutate(g);
    assert.throws(() => admit(g), /scanner-contract/);
  }
});

test('should refuse a rehashed or tampered admission receipt', () => {
  const f = toolFixture();
  const receipt = admit(f);
  for (const mutate of [
    r => { r.tools[0].digest = `sha256:${'0'.repeat(64)}`; },
    r => { r.productionAdmitted = true; },
    r => { r.review.disposition = 'approved'; r.review.digest = digest('other'); },
    r => { r.inventoryDigest = `sha256:${'1'.repeat(64)}`; },
  ]) {
    const tampered = structuredClone(receipt); mutate(tampered);
    assert.throws(() => validateAdmissionReceipt(tampered, f), /scanner-contract/);
  }
  const altered = toolFixture(); altered.reports.sbom.findings[0].severity = 'CRITICAL';
  assert.throws(() => validateAdmissionReceipt(receipt, altered), /scanner-contract/);
});
