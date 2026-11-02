// S1 inventory tests (make test-publishable-manifests SCOPE=... ENV=test-sec-lot1).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  declareApplicability,
  expectedInventories,
  expectedLockComponents,
  failClosedReport,
  findDerivedPinConsumers,
  inventoryImages,
  inventoryLocks,
  inventoryRepository,
  inventorySastRoots,
  validateCompleteness,
} from './inventory.mjs';
import { joinRegister, loadContract } from './schema.mjs';

const contract = loadContract();

test('inventory covers three images with toolbox Dockerfile', () => {
  const seen = inventoryImages(contract, '.');
  assert.equal(seen.length, 3);
  assert.ok(seen.every((image) => image.present));
  assert.equal(seen.filter((image) => image.dockerfile === 'api/Dockerfile').length, 2);
  const missingStage = structuredClone(contract);
  missingStage.inventory.images.find((image) => image.key === 'api-toolbox').stage = 'missing-stage';
  assert.equal(inventoryImages(missingStage, '.').find((image) => image.key === 'api-toolbox').present, false);
});

test('inventory covers root, UI and kit locks', () => {
  const locks = inventoryLocks('.');
  for (const path of ['package-lock.json', 'ui/package-lock.json', 'docs/governance/kit/package-lock.json']) {
    assert.equal(locks.find((lock) => lock.path === path)?.present, true, path);
  }
});

test('SAST contract is qualified by ACT-L04 while live execution stays fenced on L02', () => {
  const sast = inventorySastRoots({ inventory: { sastRoots: ['api/src', 'ui/src'], sastBlockedUntil: 'S2c native Rust ast-grep qualification' } });
  assert.deepEqual(sast.roots, ['api/src', 'ui/src']);
  assert.equal(sast.qualified, true);
  assert.equal(sast.contractError, null);
  assert.equal(sast.executionBlocked, 'coverage-blocked: sast');
  assert.match(sast.executionNote, /L02/);
  assert.match(sast.blockedUntil, /S2c/);
});

test('register join refuses rows without affected identity and keeps unmatched findings queued', () => {
  const rows = [
    { id: 'kept-1', review_due: '2026-11-20' },
    { id: 'old-1', review_due: '2026-10-11' },
  ];
  const kept = joinRegister({ id: 'kept-1' }, rows);
  assert.equal(kept.register, 'none'); // Missing affected identity cannot annotate a raw finding.
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
  const repo = inventoryRepository('.', contract);
  assert.ok(repo.images.every((image) => image.present));
  assert.equal(repo.coverage.undeclaredConsumerIsBlocker, true);
});

test('should reject unrelated or errored reports instead of declaring zero findings', () => {
  for (const raw of ['{}', '[]', 'true', '{"error":{"code":"EAI_AGAIN"}}', '{"SchemaVersion":2,"Results":null}',
    '{"SchemaVersion":2,"ArtifactName":"x","Results":[null]}',
    '{"SchemaVersion":2,"ArtifactName":"x","Results":[{}]}',
    '{"SchemaVersion":2,"ArtifactName":"x","Results":[{"Target":"x","Vulnerabilities":[{}]}]}']) {
    assert.throws(() => failClosedReport(raw), /report/);
  }
  assert.equal(failClosedReport({ SchemaVersion: 2, ArtifactName: 'x', Results: [{ Target: 'package-lock.json', Vulnerabilities: [] }] }).Results.length, 1);
});

test('should refuse npm reports with malformed entries or inconsistent severity counters', () => {
  const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
  } };
  assert.deepEqual(failClosedReport(clean), clean);
  const full = structuredClone(clean);
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    full.vulnerabilities[severity] = { name: severity, severity, range: '<1.2.3',
      via: [{ name: severity, severity, range: '<1.2.3' }, 'transitive-package'] };
    full.metadata.vulnerabilities[severity] = 1;
  }
  full.metadata.vulnerabilities.total = 5;
  assert.deepEqual(failClosedReport(full), full);
  const contradictory = structuredClone(clean);
  contradictory.metadata.vulnerabilities.critical = contradictory.metadata.vulnerabilities.total = 2;
  assert.throws(() => failClosedReport(contradictory), /report/);
  for (const entry of [null, {}, { ...full.vulnerabilities.high, name: 'other' },
    { ...full.vulnerabilities.high, severity: 'unknown' }, { ...full.vulnerabilities.high, range: null },
    { ...full.vulnerabilities.high, via: null }, { ...full.vulnerabilities.high, via: [] },
    { ...full.vulnerabilities.high, via: [null] }, { ...full.vulnerabilities.high, via: [{}] }]) {
    assert.throws(() => failClosedReport({ ...full, vulnerabilities: { ...full.vulnerabilities, high: entry } }), /report/);
  }
  for (const key of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
    const mismatch = structuredClone(full);
    mismatch.metadata.vulnerabilities[key] += 1;
    assert.throws(() => failClosedReport(mismatch), /report/, key);
  }
  const swapped = structuredClone(full);
  swapped.metadata.vulnerabilities.high = 0;
  swapped.metadata.vulnerabilities.critical = 2;
  assert.throws(() => failClosedReport(swapped), /report/);
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
  assert.equal(joinRegister({ ...finding, id: 'GHSA-cg2g-xh64-v4q7', aliases: [finding.id] }, [row]).register, 'registered-exception');
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

test('L4-D: independent expected inventories enumerate locks, tool catalog, embedded binaries and consumers', () => {
  const expected = expectedInventories('.', contract);
  assert.ok(expected.identities.includes('lockfile:package-lock.json'));
  assert.ok(expected.identities.some((id) => id.startsWith('lock:package-lock.json#node_modules/')));
  assert.ok(expected.identities.includes('tool:semver@7.7.2'));
  assert.ok(expected.identities.includes('tool:yaml@2.8.1'));
  assert.ok(expected.identities.includes('binary:api/Dockerfile#ast-grep@0.51.0'));
  assert.ok(expected.identities.some((id) => id.includes('esbuild@0.19.12')));
  assert.ok(expected.identities.some((id) => id.startsWith('consumer:tools/memory-mcp-l5/')));
  assert.ok(expected.lockComponents.some((component) => component.dev || component.optional || component.peer || true));
  assert.ok(!expected.blockers.some((blocker) => blocker.startsWith('unsupported lock layout')));
});

test('L4-D: two mutually agreeing scanner outputs still fail when both omit one expected component', () => {
  const expected = { identities: ['lock:package-lock.json#node_modules/demo', 'tool:semver@7.7.2',
    'binary:api/Dockerfile#ast-grep@0.51.0'] };
  const agreeing = ['lock:package-lock.json#node_modules/demo', 'tool:semver@7.7.2'];
  assert.throws(() => validateCompleteness([agreeing, [...agreeing]], expected),
    /incomplete inventory, omitted components: binary:api\/Dockerfile#ast-grep@0\.51\.0/);
  assert.deepEqual(validateCompleteness([[...agreeing, 'binary:api/Dockerfile#ast-grep@0.51.0']], expected),
    { covered: 3, expected: 3 });
  assert.throws(() => validateCompleteness([], expected), /no scanner output/);
  assert.throws(() => validateCompleteness([agreeing], null), /expected inventory required/);
});

test('L4-E: unsupported lock layouts and applicability N/A without positive proof emit exact blockers', () => {
  const root = mkdtempSync(join(tmpdir(), 'security-l4e-'));
  try {
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 1, dependencies: {} }));
    const locks = expectedLockComponents(root);
    assert.ok(locks.blockers.includes('unsupported lock layout: package-lock.json'));
    assert.equal(locks.components.length, 0);
    assert.throws(() => declareApplicability('sast', undefined), /applicability N\/A without positive inventory proof: sast/);
    assert.throws(() => declareApplicability('sast', { enumerated: true, count: -1 }), /positive inventory proof/);
    assert.throws(() => declareApplicability('', { enumerated: true, count: 0 }), /applicability surface required/);
    assert.deepEqual(declareApplicability('sast', { enumerated: true, count: 0 }),
      { surface: 'sast', na: true, proof: { enumerated: true, count: 0 } });
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
  assert.equal(report.staleContainerCandidates, 7);
  assert.equal(report.verificationPending.length, 66);
  assert.equal(summarizeBacklog([], rows, { complete: true }).status, 'complete-with-findings');
  assert.equal(summarizeBacklog([], [], { complete: false }).status, 'incomplete-scan');
  assert.equal(summarizeBacklog([], [], { complete: true, coverageBlocked: ['sast'] }).status, 'incomplete-scan');
  assert.equal(summarizeBacklog([], [], { complete: true }).status, 'complete-clean');
});

test('should inventory the current register separately from its historical 67-row baseline', async () => {
  const { normalizeRegister, summarizeBacklog } = await import('./inventory.mjs');
  const requireTool = createRequire(join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'));
  const document = requireTool('yaml').parse(readFileSync('.security/vulnerability-register.yaml', 'utf8'));
  const rows = normalizeRegister(document, 'rhanka/sentropic');
  const pending = Object.entries(document.vulnerability_register.vulnerabilities).filter(([, row]) => row.status !== 'resolved');
  const report = summarizeBacklog([], rows, { today: '2026-10-26', complete: true });
  assert.equal(report.unresolvedRegister, pending.length);
  const staleContainers = pending.filter(([, row]) => row.review_due < '2026-10-26' &&
    (row.image_digest || row.embedded_path || /^(?:usr|lib|bin|sbin|etc|workspace)\//.test(row.file || '') ||
      /image|toolbox|production|api-tool/.test(row.component || '')));
  assert.equal(report.staleContainerCandidates, staleContainers.length);
  assert.deepEqual(report.verificationPending.map((row) => row.registerKey), pending.map(([key]) => key));
  assert.equal(report.status, pending.length ? 'complete-with-findings' : 'complete-clean');
  // Legitimate removal-only reconciliation must never require editing this test or a frozen count.
  if (pending.length) {
    const reconciled = structuredClone(document);
    delete reconciled.vulnerability_register.vulnerabilities[pending[0][0]];
    const after = summarizeBacklog([], normalizeRegister(reconciled, 'rhanka/sentropic'), { today: '2026-10-26', complete: true });
    assert.equal(after.unresolvedRegister, report.unresolvedRegister - 1);
    assert.equal(after.verificationPending.length, report.verificationPending.length - 1);
  }
  assert.ok(rows.every((row) => row.registerKey));
  assert.throws(() => normalizeRegister({}), /register/);
});
