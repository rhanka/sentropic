// S1 inventory tests (make test-publishable-manifests SCOPE=... ENV=test-sec-s1).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  failClosedReport,
  findDerivedPinConsumers,
  inventoryImages,
  inventoryLocks,
  inventoryRepository,
  inventorySastRoots,
} from './inventory.mjs';
import { joinRegister } from './schema.mjs';

test('inventory covers three images with toolbox Dockerfile', () => {
  const seen = inventoryImages({ inventory: { images: [
    { key: 'api-production', dockerfile: 'api/Dockerfile' },
    { key: 'api-toolbox', dockerfile: 'api/Dockerfile' },
    { key: 'ui-production', dockerfile: 'ui/Dockerfile' },
  ] } });
  assert.ok(seen.every((image) => image.present));
  assert.ok(seen.filter((image) => image.dockerfile === 'api/Dockerfile').length >= 2);
});

test('inventory covers root, UI and kit locks', () => {
  const locks = inventoryLocks('.');
  assert.ok(locks.find((lock) => lock.path === 'package-lock.json'));
  assert.ok(locks.find((lock) => lock.path === 'ui/package-lock.json'));
  assert.ok(locks.find((lock) => lock.path === 'docs/governance/kit/package-lock.json'));
});

test('SAST roots stay explicitly blocked until S2c', () => {
  const sast = inventorySastRoots({ inventory: { sastRoots: ['api/src', 'ui/src'], sastBlockedUntil: 'S2c native Rust ast-grep qualification' } });
  assert.deepEqual(sast.roots, ['api/src', 'ui/src']);
  assert.equal(sast.qualified, false);
  assert.match(sast.blockedUntil, /S2c/);
});

test('register join keeps 67 rows with expiry state, seven stale-container candidates separate', () => {
  const rows = [
    { id: 'kept-1', review_due: '2026-11-20' },
    { id: 'old-1', review_due: '2026-10-11' },
  ];
  const kept = joinRegister({ id: 'kept-1' }, rows);
  assert.equal(kept.register, 'registered-exception');
  assert.equal(joinRegister({ id: 'missing' }, rows).register, 'none');
  assert.equal(joinRegister({ id: 'other' }, []).queue, 'queued');
});

test('fail-closed parser rejects empty, malformed and incomplete reports', () => {
  assert.throws(() => failClosedReport(''), /empty/);
  assert.throws(() => failClosedReport('{not-json'), /malformed/);
  assert.throws(() => failClosedReport('{"Results":[]}'), /incomplete/);
  assert.throws(() => failClosedReport(null), /missing/);
  const clean = failClosedReport('{"SchemaVersion":2,"ArtifactName":"x","Results":[]}');
  assert.deepEqual(clean.Results, []);
});

test('repository inventory finds derived-pin consumers including L5 manifest', () => {
  const consumers = findDerivedPinConsumers('.');
  assert.ok(consumers.length > 0);
  assert.ok(consumers.some((path) => path.includes('pre-candidate-manifest.json')));
  const repo = inventoryRepository('.', {
    inventory: { images: [
      { key: 'api-production', dockerfile: 'api/Dockerfile' },
      { key: 'api-toolbox', dockerfile: 'api/Dockerfile' },
      { key: 'ui-production', dockerfile: 'ui/Dockerfile' },
    ], sastRoots: ['api/src'], sastBlockedUntil: 'S2c' },
    derivedPins: { undeclaredConsumerIsBlocker: true },
  });
  assert.equal(repo.coverage.undeclaredConsumerIsBlocker, true);
});

test('should reject unrelated or errored reports instead of declaring zero findings', () => {
  for (const raw of ['{}', '[]', 'true', '{"error":{"code":"EAI_AGAIN"}}', '{"SchemaVersion":2,"Results":null}']) {
    assert.throws(() => failClosedReport(raw), /report/);
  }
});

test('should join register metadata only on the exact affected identity', () => {
  const finding = { id: 'CVE-2026-111943', repository: 'r', scanner: 'trivy',
    component: 'api-toolbox', path: '/bin/esbuild', version: '1.26.9',
    platform: 'linux/amd64', imageDigest: 'sha256:abc', severity: 'HIGH' };
  const row = { ...finding, status: 'accepted_temporary', review_due: '2026-11-20' };
  assert.equal(joinRegister(finding, [row], '2026-11-20').expired, false);
  assert.equal(joinRegister(finding, [row], '2026-11-21').expired, true);
  for (const field of ['component', 'path', 'version', 'platform', 'imageDigest', 'scanner']) {
    assert.equal(joinRegister(finding, [{ ...row, [field]: 'other' }]).register, 'none', field);
  }
  assert.equal(joinRegister(finding, [{ ...row, status: 'resolved' }]).register, 'none');
  assert.equal(joinRegister(finding, [{ ...row, review_due: 'bad-date' }]).register, 'none');
});

test('should discover independent locks and refuse clean coverage before SAST qualification', () => {
  const root = mkdtempSync(join(tmpdir(), 'security-inventory-'));
  try {
    for (const path of ['package-lock.json', 'api/package-lock.json', 'ui/package-lock.json',
      'docs/governance/kit/package-lock.json', 'apps/auth-idp/web/package-lock.json',
      'e2e/package-lock.json', 'new-package/package-lock.json']) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), '{}');
    }
    writeFileSync(join(root, 'unknown-lock.sha256'), 'package-lock.json sha256');
    assert.ok(inventoryLocks(root).some((lock) => lock.path === 'new-package/package-lock.json'));
    const repo = inventoryRepository(root, { inventory: { images: [], sastRoots: ['api/src'] } });
    assert.equal(repo.coverage.complete, false);
    assert.ok(repo.coverage.blockers.includes('coverage-blocked: sast'));
    assert.ok(repo.coverage.blockers.some((blocker) => blocker.includes('unknown-lock.sha256')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('should keep the 67-row baseline pending and every reported severity in the public backlog', async () => {
  const { summarizeBacklog } = await import('./inventory.mjs');
  const rows = Array.from({ length: 67 }, (_, i) => ({ id: `finding-${i}`,
    component: 'api-toolbox', path: `/bin/${i}`, scanner: 'trivy', version: '1.0.0',
    status: 'accepted_temporary', review_due: i < 60 ? '2026-11-20' : '2026-10-11' }));
  const findings = [{ ...rows[0], repository: 'r', severity: 'HIGH' },
    { id: 'low', repository: 'r', component: 'p', path: 'package-lock.json', scanner: 'npm', version: '1.0.0', severity: 'LOW' }];
  const report = summarizeBacklog(findings, rows, { today: '2026-10-26', complete: true });
  assert.equal(report.status, 'complete-with-findings');
  assert.equal(report.findings.length, 2);
  assert.equal(report.unresolvedRegister, 67);
  assert.equal(report.expired, 7);
  assert.equal(report.unexpired, 60);
  assert.equal(report.verificationPending.length, 66);
  assert.equal(summarizeBacklog([], rows, { complete: true }).status, 'complete-with-findings');
  assert.equal(summarizeBacklog([], [], { complete: false }).status, 'incomplete-scan');
  assert.equal(summarizeBacklog([], [], { complete: true, coverageBlocked: ['sast'] }).status, 'incomplete-scan');
  assert.equal(summarizeBacklog([], [], { complete: true }).status, 'complete-clean');
});
