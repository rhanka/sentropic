// S1 schema tests (make test-publishable-manifests SCOPE=... ENV=test-sec-s1).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  batchLots,
  canonicalAliases,
  checkReconciliationStreak,
  classifyBumpGate,
  groupFindings,
  isActionable,
  stableFindingKey,
  stableUnitKey,
  validateContract,
} from './schema.mjs';

const contract = JSON.parse(readFileSync(new URL('../../../.security/security-fix.json', import.meta.url), 'utf8'));
const target = { surface: 'api-toolbox', imageLineage: 'ghcr.io/rhanka/sentropic-api-tool', platform: 'linux/amd64', path: '/bin/esbuild' };
const scan = (day) => ({
  kind: 'daily-full', day, scanId: `public-${day}`, sourceSha: 'a'.repeat(40),
  scannedAt: `${day}T05:17:00Z`, dbUpdatedAt: `${day}T04:00:00Z`, dbIdentity: `sha256:${'b'.repeat(64)}`,
  scannerIdentity: 'trivy@sha256:qualified', policyIdentity: 'policy-1', flags: ['all-severities'],
  complete: true, findingsMatched: 0, gaps: 0,
  coverage: [{ ...target, imageDigest: `sha256:${'c'.repeat(64)}` }],
});

test('contract validates: images, locks, toolbox, register, scope, pins, P3-1, P3-4, N=2, limits', () => {
  const result = validateContract(contract);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('expiry split stays 60 unexpired plus 7 expired', () => {
  assert.equal(contract.register.baselineOutstanding, 67);
  assert.equal(contract.register['due2026-11-20'], 60);
  assert.equal(contract.register.expired.total, 7);
  assert.equal(contract.register.staleContainerCandidates, 7);
});

test('severity contract keeps HIGH/CRITICAL actionable with identical flags', () => {
  assert.equal(isActionable('HIGH'), true);
  assert.equal(isActionable('critical'), true);
  assert.equal(isActionable('medium'), false);
  assert.equal(contract.severity.rawMeansBeforeSuppression, true);
  assert.equal(contract.severity.identicalFlagsRequired, true);
});

test('stable keys use canonical aliases independent of day and base SHA', () => {
  const keyA = stableFindingKey({ repository: 'rhanka/sentropic', aliases: { ghsa: 'ghsa-cg2g-xh64-v4q7', cve: 'CVE-2026-111943' }, component: 'dompurify', path: 'ui/package-lock.json' });
  const keyB = stableFindingKey({ repository: 'rhanka/sentropic', aliases: { aliases: ['CVE-2026-111943', 'GHSA-CG2G-XH64-V4Q7'] }, component: 'dompurify', path: 'ui/package-lock.json' });
  assert.equal(keyA, keyB);
  assert.deepEqual(canonicalAliases({ ghsa: 'ghsa-cg2g-xh64-v4q7' }), ['GHSA-CG2G-XH64-V4Q7']);
  const unit = stableUnitKey({ repository: 'r', repairClass: 'npm-patch', targets: ['b', 'a'], fixedTarget: '1.2.4' });
  assert.equal(unit, 'r|npm-patch|a,b|1.2.4');
});

test('grouping batches into bounded lots of 3 units, 10 files, 150 lines', () => {
  const findings = [0, 1, 2, 3].map((n) => ({
    repository: 'rhanka/sentropic', repairClass: 'npm-patch', locks: ['package-lock.json'],
    component: `pkg-${n}`, path: 'package-lock.json', fixedTarget: '1.2.4',
  }));
  const units = groupFindings(findings).map((unit, index) => ({ ...unit, files: 4, lines: 60 }));
  assert.equal(units.length, 4);
  const lots = batchLots(units, contract.grouping.lotBounds);
  assert.equal(lots.length, 2);
  assert.ok(lots.every((lot) => lot.units.length <= 3));
});

test('P3-4 bumpGate classifies published dependency-section edits as manual', () => {
  assert.equal(classifyBumpGate({ alreadyPublished: true, dependencySectionChanged: true }), 'manual');
  assert.equal(classifyBumpGate({ alreadyPublished: false, dependencySectionChanged: true }), 'automatic-eligible');
});

test('all-public owner decision: no private scan repo or storage assumed', () => {
  assert.equal(contract.credentials.killSwitchRepo, 'rhanka/sentropic');
  assert.match(contract.runtime, /no private/);
  assert.match(contract.reconciliation.review, /auto-merge/);
  assert.match(contract.runtime, /zero open vulnerability/);
});

test('N=2 reconciliation accepts two complete scans and resets on gaps', () => {
  const good = scan('2026-10-25'), next = scan('2026-10-26');
  assert.equal(checkReconciliationStreak([good, next], target).ok, true);
  assert.equal(checkReconciliationStreak([good], target).ok, false);
  for (const patch of [{ gaps: 1 }, { flags: ['HIGH', 'CRITICAL'] }, { findingsMatched: 1 },
    { coverage: [] }, { sourceSha: '' }, { scannerIdentity: 'different' },
    { dbUpdatedAt: '2026-10-20T00:00:00Z' }, { policyIdentity: 'changed' }, { kind: 'partial' }]) {
    assert.equal(checkReconciliationStreak([good, { ...next, ...patch }], target).ok, false, JSON.stringify(patch));
  }
  assert.equal(checkReconciliationStreak([good, scan('2026-10-27')], target).ok, false);
  assert.equal(checkReconciliationStreak([good, good], target).ok, false);
  assert.equal(checkReconciliationStreak([good, { ...next, dbIdentity: `sha256:${'d'.repeat(64)}` }], target).ok, true);
});

test('should reject missing scan identities and nonconsecutive reconciliation days', () => {
  const scan = { complete: true, findingsMatched: 0, gaps: 0, identicalFlags: true, surfaceCovered: true, dbIdentity: 'db-1' };
  assert.equal(checkReconciliationStreak([scan, scan]).ok, false);
});

test('should keep repositories and repair classes in separate bounded lots', () => {
  const unit = (repository, repairClass, files = 1, lines = 10) => ({
    unitKey: `${repository}|${repairClass}|pkg|1.2.4`, repository, repairClass, files, lines,
  });
  const lots = batchLots([unit('a', 'dependency'), unit('b', 'dependency'), unit('a', 'reconciliation')]);
  assert.equal(lots.length, 3);
  assert.throws(() => batchLots([unit('a', 'dependency', 11)]), /bound/);
  assert.throws(() => batchLots([unit('a', 'dependency', 1, 151)]), /bound/);
  assert.throws(() => batchLots([{ unitKey: 'unknown' }]), /estimate|identity/);
});

test('should group all affected locks with stable keys and retain no-fix findings', () => {
  const finding = { repository: 'r', repairClass: 'dependency', component: 'pkg',
    path: 'package-lock.json', fixedTarget: '1.2.4', severity: 'LOW' };
  const grouped = groupFindings([finding, { ...finding, path: 'ui/package-lock.json', id: 'another' }]);
  assert.deepEqual(grouped[0].locks, ['package-lock.json', 'ui/package-lock.json']);
  assert.match(grouped[0].unitKey, /package-lock.json,ui\/package-lock.json/);
  assert.equal(groupFindings([{ ...finding, fixedTarget: null }])[0].state, 'no-upstream-fix');
});

test('should retain all severities and declare separate own-code and reconciliation scope', () => {
  assert.deepEqual(contract.severity.inventory, ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  assert.equal(contract.automaticScope.ownCode.enabled, false);
  assert.deepEqual(contract.automaticScope.ownCode.sourcePaths, []);
  assert.deepEqual(contract.automaticScope.ownCode.testPaths, []);
  assert.equal(contract.automaticScope.reconciliation.removalOnly, true);
  const changed = structuredClone(contract);
  changed.severity.actionable = [];
  assert.equal(validateContract(changed).ok, false);
});

test('should reject malformed or absent advisory identities and ambiguous key delimiters', () => {
  for (const aliases of [{ cve: {} }, { aliases: [42] }, { ghsa: 'bad' }]) {
    assert.throws(() => canonicalAliases(aliases), /alias/);
  }
  assert.throws(() => stableFindingKey({ repository: 'r', component: 'p', path: 'x' }), /identity/);
  assert.throws(() => stableUnitKey({ repository: 'r', repairClass: 'dependency', targets: [], fixedTarget: '1.2.4' }), /target/);
  assert.throws(() => stableUnitKey({ repository: 'r|other', repairClass: 'dependency', targets: ['p'], fixedTarget: '1.2.4' }), /identity/);
});
