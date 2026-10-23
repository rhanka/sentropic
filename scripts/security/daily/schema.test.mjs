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
  assert.deepEqual(canonicalAliases({ ghsa: 'ghsa-b' }), ['GHSA-B']);
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
  const good = { complete: true, findingsMatched: 0, gaps: 0, identicalFlags: true, surfaceCovered: true, dbIdentity: 'db-1' };
  assert.equal(checkReconciliationStreak([good, { ...good }]).ok, true);
  assert.equal(checkReconciliationStreak([good]).ok, false);
  assert.equal(checkReconciliationStreak([good, { ...good, gaps: 1 }]).ok, false);
  assert.equal(checkReconciliationStreak([good, { ...good, identicalFlags: false }]).ok, false);
});
