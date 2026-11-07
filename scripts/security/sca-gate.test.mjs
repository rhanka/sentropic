import assert from 'node:assert/strict';
import test from 'node:test';
import { inRange, lockDirs, parseRegister, registerMatch, auditFindings } from './sca-gate.mjs';

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
      affected_version: 4.13.0
      review_due: 2026-11-08
`;

test('should honour register expiry', () => {
  const entries = parseRegister(register);
  const key = { ghsa: 'GHSA-aaaa-bbbb-cccc', pkg: 'hono', version: '4.13.0' };
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
