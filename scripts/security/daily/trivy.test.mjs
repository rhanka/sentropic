import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, policy } from './toolchain-contract.mjs';
import { executeImageScan, prepareImageScan, requireIacQualification, validateComparison, validateImageReport, validateTarget } from './trivy.mjs';
import { preflight } from './toolchain-preflight.mjs';

const sourceSha = 'a'.repeat(40);
const now = Date.parse('2026-10-29T12:00:00Z');
const target = () => ({ key: 'api-toolbox', sourceSha, platform: 'linux/amd64',
  ref: `registry.example/sentropic-api-tools@${digest('image')}`, configDigest: digest('config'),
  expectedResults: ['alpine|os-pkgs|alpine'], provenance: { verified: true, sourceSha,
    platform: 'linux/amd64', imageRef: `registry.example/sentropic-api-tools@${digest('image')}`,
    receiptHash: digest('trusted-main-ci') } });

async function snapshot(t, kind) {
  const path = await mkdtemp(join(tmpdir(), 'trivy-plan-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const filename = kind === 'java' ? 'trivy-java.db' : 'trivy.db';
  const metadata = { Version: policy.data[kind].schema, UpdatedAt: '2026-10-29T06:00:00Z',
    NextUpdate: '2026-10-30T06:00:00Z', DownloadedAt: '2026-10-29T11:00:00Z' };
  const manifest = JSON.stringify({ layers: [{ digest: digest('layer') }] });
  const data = { [filename]: 'db', 'metadata.json': JSON.stringify(metadata),
    'manifest.json': manifest, 'layer.tgz': 'layer' };
  const receipt = { schema: 1, kind, repository: policy.data[kind].repository, scannerVersion: policy.version,
    manifestDigest: digest(manifest), layerDigest: digest('layer'), observedAt: metadata.DownloadedAt, metadata,
    files: Object.fromEntries(Object.entries(data).map(([name, bytes]) => [name, digest(bytes)])) };
  for (const [name, bytes] of Object.entries(data)) await writeFile(join(path, name), bytes);
  const bytes = JSON.stringify(receipt);
  await writeFile(join(path, 'receipt.json'), bytes);
  return { path, receiptHash: digest(bytes), manifestDigest: digest(manifest) };
}

test('should reject floating targets and mismatched source/platform/provenance', () => {
  assert.equal(validateTarget(target(), sourceSha, 'api-toolbox').platform, policy.platform);
  for (const delta of [{ ref: 'aquasec/trivy:latest' }, { sourceSha: 'b'.repeat(40) },
    { platform: 'linux/arm64' }, { provenance: {} }, { expectedResults: [] }]) {
    assert.throws(() => validateTarget({ ...target(), ...delta }, sourceSha, 'api-toolbox'), /coverage-blocked/);
  }
});

test('should prepare immutable remote and disconnected archive scans with isolated data', async (t) => {
  const snapshots = { vulnerability: await snapshot(t, 'vulnerability'), java: await snapshot(t, 'java') };
  const options = { target: target(), sourceSha, key: 'api-toolbox', snapshots, now,
    flags: ['--db-repository', 'evil'], env: { TRIVY_DB_REPOSITORY: 'evil', GITHUB_TOKEN: 'canary' } };
  const remote = await prepareImageScan(options);
  assert.ok(remote.args.includes(`${policy.repository}@${policy.manifestDigest}`));
  for (const arg of ['--pull=never', '--read-only', '--cap-drop=ALL', '--skip-db-update', '--skip-java-db-update',
    '--offline-scan', '--skip-version-check', '--disable-telemetry', '--image-src']) assert.ok(remote.args.includes(arg));
  assert.ok(remote.args.includes('bridge'));
  assert.ok(!JSON.stringify(remote.args).match(/docker.sock|evil|canary|GITHUB_TOKEN|--env-file/));
  const path = join(snapshots.java.path, 'image.tar');
  await writeFile(path, 'archive');
  const offline = await prepareImageScan({ ...options, archive: { path, digest: digest('archive') } });
  assert.ok(offline.args.includes('none'));
  assert.ok(offline.args.includes('--input'));
  assert.ok(!offline.args.includes('--image-src'));
  const report = JSON.stringify({ SchemaVersion: 2, ArtifactName: '/target/image.tar', ArtifactType: 'container_image',
    Metadata: { ImageID: target().configDigest }, Results: [{ Target: 'alpine', Class: 'os-pkgs', Type: 'alpine' }] });
  assert.equal(validateImageReport(report, offline.target).Metadata.ImageID, target().configDigest);
  assert.throws(() => validateImageReport(report, remote.target), /target identity/);
  assert.throws(() => validateImageReport(report, { ...offline.target }), /target identity/);
  assert.throws(() => validateImageReport(report.replace('container_image', 'filesystem'), offline.target), /target identity/);
  assert.throws(() => validateImageReport(report.replace(target().configDigest, digest('wrong')), offline.target), /target identity/);
  const ref = `urn:oci-archive:${digest('archive')}`;
  const archivedTarget = { ...target(), ref, provenance: { ...target().provenance, imageRef: ref } };
  const archived = await prepareImageScan({ ...options, target: archivedTarget, archive: { path, digest: digest('archive') } });
  assert.equal(validateImageReport(report, archived.target).Metadata.ImageID, target().configDigest);
  assert.throws(() => validateTarget(archivedTarget, sourceSha, 'api-toolbox'), /immutable image\/archive/);
  await assert.rejects(prepareImageScan({ ...options, target: archivedTarget,
    archive: { path, digest: digest('different') } }), /immutable image\/archive/);
  await assert.rejects(prepareImageScan({ ...options, archive: { path, digest: digest('bad') } }), /archive integrity/);
  await assert.rejects(prepareImageScan({ ...options, snapshots: { vulnerability: snapshots.vulnerability } }), /Java/);
  await assert.rejects(prepareImageScan({ ...options, now: now + 86400000 }), /freshness/);
  const before = { ...remote, status: 0, rawHash: digest('before') };
  const after = { ...remote, status: 0, rawHash: digest('after') };
  assert.equal(await validateComparison(before, after, now), true);
  for (const field of ['parametersHash', 'policyHash', 'scannerIdentity', 'databaseIdentity']) {
    await assert.rejects(validateComparison(before, { ...after, [field]: digest('changed') }, now), /rescan both inputs/);
  }
  await assert.rejects(validateComparison(before, after, now + 86400000), /freshness/);
});

test('should preserve low severity raw findings and refuse incomplete or wrong-target reports', () => {
  const report = { SchemaVersion: 2, ArtifactName: target().ref, Metadata: {
    ImageID: target().configDigest, RepoDigests: [target().ref] }, Results: [{
    Target: 'alpine', Class: 'os-pkgs', Type: 'alpine', Vulnerabilities: [{ VulnerabilityID: 'CVE-2026-1234',
      PkgName: 'demo', InstalledVersion: '1.0', Severity: 'LOW' }],
  }] };
  assert.equal(validateImageReport(JSON.stringify(report), target()).Results[0].Vulnerabilities[0].Severity, 'LOW');
  for (const changed of [{ ...report, Results: [] }, { ...report, Metadata: { ImageID: digest('wrong') } },
    { ...report, Results: [...report.Results, { Target: 'extra' }] }, { ...report, SchemaVersion: 1 }]) {
    assert.throws(() => validateImageReport(JSON.stringify(changed), target()));
  }
  for (const raw of ['', '{}', JSON.stringify(report) + JSON.stringify(report)]) {
    assert.throws(() => validateImageReport(raw, target()));
  }
});

test('should never execute unqualified scanners or silently substitute IaC rules', async () => {
  let executions = 0;
  await assert.rejects(executeImageScan({}, {}, () => { executions++; }), /S2b qualification pending/);
  assert.equal(executions, 0);
  assert.throws(() => requireIacQualification(), /IaC rules snapshot/);
  const report = await preflight('status');
  assert.equal(report.qualified, false);
  assert.equal(report.status, 'coverage-blocked');
  assert.deepEqual(report.snapshots, {});
  await assert.rejects(preflight('--db-repository=evil'), /unknown preparation operation/);
});

test('should retain bounded raw diagnostics when process or report validation fails', () => {
  assert.throws(() => validateImageReport('partial raw report', target(), { status: 1, stderr: 'download blocked' }),
    (error) => error.scanEvidence?.stdout === 'partial raw report' &&
      error.scanEvidence?.stderr === 'download blocked' && error.scanEvidence?.status === 1);
  assert.throws(() => validateImageReport('x'.repeat(16 * 1024 * 1024 + 1), target()),
    (error) => error.scanEvidence?.truncated === true && error.scanEvidence.reportBytes === 16 * 1024 * 1024 + 1 &&
      Buffer.byteLength(error.scanEvidence.stdout) === 16 * 1024 * 1024);
});
