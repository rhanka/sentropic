import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inRange, lockDirs, lockPartition, parseRegister, registerMatch, auditFindings, advisoryFindings, routeAdvisoryErrors, clean, cmp, MODES, walkLocks, issueLine, errorAnnotation, manifestWarning } from './sca-gate.mjs';

test('should evaluate advisory ranges', () => {
  assert.equal(inRange('1.19.17', '< 1.19.18'), true);
  assert.equal(inRange('2.1.6', '< 2.1.6'), false);
  assert.equal(inRange('4.13.0', '>= 4.0.0, < 4.13.1'), true);
  assert.equal(inRange('4.13.1', '>= 4.0.0, < 4.13.1'), false);
  assert.equal(inRange('1.0.0', ''), false);
});

test('should select runtime lockfiles and skip fixtures', () => {
  assert.deepEqual(lockDirs(['package-lock.json', 'api/package-lock.json', 'packages/a/tests/x/package-lock.json',
    'tools/memory-mcp-l5/artifacts/lock-snapshots/aa.package-lock.json', 'docs/governance/kit/package-lock.json',
    'apps/auth-idp/web/package-lock.json']), ['.', 'api', 'apps/auth-idp/web']);
});

const register = `vulnerability_register:
  vulnerabilities:
    GHSA-aaaa-bbbb-cccc_x:
      source: https://github.com/x/y/security/advisories/GHSA-aaaa-bbbb-cccc
      package: "hono"
      component: api
      affected_version: 4.13.0
      review_due: 2026-11-08
`;

test('should honour register expiry', () => {
  const entries = parseRegister(register);
  const key = { ghsa: 'GHSA-aaaa-bbbb-cccc', pkg: 'hono', version: '4.13.0', dir: 'api' };
  assert.deepEqual(registerMatch(entries, '2026-11-07', key), { accepted: true, expired: false });
  assert.deepEqual(registerMatch(entries, '2026-11-09', key), { accepted: false, expired: true });
  assert.deepEqual(registerMatch(entries, '2026-11-07', { ...key, version: '4.13.9' }), { accepted: false, expired: false });
});

test('should flag unregistered high findings from npm audit output', () => {
  const lock = { packages: { 'node_modules/hono': { version: '4.13.0' } } };
  const json = { vulnerabilities: { hono: { via: [{ name: 'hono', severity: 'high', url: 'https://github.com/advisories/GHSA-zzzz-zzzz-zzzz', range: '<4.13.1', title: 't' }, 'other'] } } };
  const found = auditFindings('api', json, lock, parseRegister(register), '2026-11-07');
  assert.equal(found.length, 1);
  assert.equal(found[0].accepted, false);
  assert.equal(found[0].version, '4.13.0');
});

test('should cover locks under any top-level directory and list the policy exclusions', () => {
  const part = lockPartition(['spec/ci-cd-ten-minutes/dossier/package-lock.json', 'package-lock.json',
    'docs/governance/kit/package-lock.json', 'packages/a/tests/x/package-lock.json']);
  assert.deepEqual(part.covered, ['.', 'spec/ci-cd-ten-minutes/dossier']);
  assert.deepEqual(part.excluded, ['docs/governance/kit/package-lock.json', 'packages/a/tests/x/package-lock.json']);
});

test('should not accept a register entry from another component or an empty advisory id', () => {
  const entries = parseRegister(register);
  const key = { ghsa: 'GHSA-aaaa-bbbb-cccc', pkg: 'hono', version: '4.13.0' };
  assert.deepEqual(registerMatch(entries, '2026-11-07', { ...key, dir: 'api' }), { accepted: true, expired: false });
  assert.deepEqual(registerMatch(entries, '2026-11-07', { ...key, dir: 'ui' }), { accepted: false, expired: false });
  assert.deepEqual(registerMatch(entries, '2026-11-07', { ...key, dir: '.' }), { accepted: false, expired: false });
  assert.deepEqual(registerMatch(entries, '2026-11-07', { ...key, ghsa: '', dir: 'api' }), { accepted: false, expired: false });
});

test('should order prerelease versions below their release', () => {
  assert.equal(cmp('4.13.17-rc.1', '4.13.17'), -1);
  assert.equal(inRange('4.13.17-rc.1', '< 4.13.17'), true);
  assert.equal(inRange('4.13.17', '< 4.13.17'), false);
  assert.equal(cmp('1.0.0-rc.2', '1.0.0-rc.10'), -1);
  assert.equal(cmp('1.0.0-alpha', '1.0.0-1'), 1);
});

test('should defuse workflow commands and newlines in third-party text', () => {
  assert.equal(clean('a\n::error::b\r\nc'), 'a : :error: :b c');
});

test('should accept only known modes and keep scheduled fail-closed', () => {
  assert.deepEqual(MODES, ['pr', 'scheduled']);
  assert.deepEqual(routeAdvisoryErrors('scheduled', ['e']), { errors: ['e'], warnings: [] });
  assert.deepEqual(routeAdvisoryErrors('pr', ['e']), { errors: [], warnings: ['e'] });
});

const okPage = body => ({ ok: true, status: 200, json: async () => body });
const adv = (id, severity, range, extra = {}) => ({ ghsa_id: id, severity, summary: 's', vulnerabilities: [{ package: { name: 'hono' }, vulnerable_version_range: range }], ...extra });
const ctx = { dir: 'api', pkgJson: { dependencies: { hono: '^4', left: '1' } }, lock: { packages: { 'node_modules/hono': { version: '4.13.0' }, 'node_modules/left': { version: '1.0.0' } } }, entries: parseRegister(register), today: '2026-11-07' };

test('should flag repository advisories by range, severity, withdrawal and component', async () => {
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    return okPage([adv('GHSA-1', 'high', '< 4.13.1'), adv('GHSA-2', 'low', '< 4.13.1'),
      adv('GHSA-3', 'high', '< 4.13.1', { withdrawn_at: 'x' }), adv('GHSA-4', 'high', '>= 4.14.0'), adv('GHSA-aaaa-bbbb-cccc', 'critical', '< 4.13.1')]);
  };
  const { findings, errors } = await advisoryFindings({ ...ctx, fetchFn });
  assert.equal(calls.length, 1, 'only the allowlisted direct dependency is queried');
  assert.deepEqual(errors, []);
  assert.deepEqual(findings.map(f => [f.ghsa, f.accepted]), [['GHSA-1', false], ['GHSA-aaaa-bbbb-cccc', true]]);
  const other = await advisoryFindings({ ...ctx, dir: 'ui', fetchFn });
  assert.deepEqual(other.findings.map(f => [f.ghsa, f.accepted]), [['GHSA-1', false], ['GHSA-aaaa-bbbb-cccc', false]]);
});

test('should surface fetch failures and paginate full pages', async () => {
  const failed = await advisoryFindings({ ...ctx, fetchFn: async () => ({ ok: false, status: 403 }) });
  assert.deepEqual(failed.errors, ['api: advisories hono: HTTP 403']);
  const pages = [Array.from({ length: 100 }, (_, i) => adv(`GHSA-p${i}`, 'low', '< 1')), [adv('GHSA-late', 'high', '< 4.13.1')]];
  let n = 0;
  const paged = await advisoryFindings({ ...ctx, fetchFn: async () => okPage(pages[n++]) });
  assert.equal(n, 2);
  assert.deepEqual(paged.findings.map(f => f.ghsa), ['GHSA-late']);
  const endless = await advisoryFindings({ ...ctx, fetchFn: async () => okPage(pages[0]) });
  assert.match(endless.errors[0], /more than 20 pages/);
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED_COVERED = ['.', 'api', 'apps/auth-idp/web', 'e2e', 'e2e/npm-toolchain', 'packages/llm-mesh/seat-tools',
  'spec/ci-cd-ten-minutes/dossier', 'tools/scw-tem-mock', 'ui'];

test('should pin the real covered lock set and have no manifest-less covered lock', () => {
  const { covered } = lockPartition(walkLocks(repoRoot));
  assert.deepEqual(covered, EXPECTED_COVERED);
  assert.deepEqual(covered.filter(d => !existsSync(path.join(repoRoot, d, 'package.json'))), []);
});

test('should clean every field of annotation and issue templates', () => {
  const evil = { severity: 'high\n::error::s', package: 'p\r\n::warning::x', version: '1::2', dir: 'd\n::e', ghsa: 'G\n::g', title: 't\n::t', expired: true };
  for (const out of [issueLine(evil), errorAnnotation(evil).replace(/^::error::/, '')]) {
    assert.doesNotMatch(out, /[\r\n]/);
    assert.doesNotMatch(out, /::/);
  }
  assert.match(errorAnnotation(evil), /^::error::/);
});

test('should emit one workflow warning per covered lock without a manifest', () => {
  assert.equal(manifestWarning('tools/x'), '::warning::covered lock tools/x/package-lock.json has no sibling package.json: not audited');
  assert.equal(manifestWarning('a\n::error::b').split('\n').length, 1);
  assert.equal(manifestWarning('a\n::error::b').slice(11).includes('::'), false);
});
