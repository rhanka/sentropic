import { expect, it } from 'vitest';
import { bundleProof, normalizeReportPath } from '../proof-bundle.mjs';
const file = 'packages/fixture/tests/proof.test.ts', id = 'P01.fixture.executed';
const catalog = { requiresE4: true, files: [file], fileCases: { [file]: [id] } };
const binding = { sourceHead: 'a'.repeat(40), artifactManifestSha256: 'b'.repeat(64), command: 'make fixture ENV=test-memory-l5', runId: '123', attempt: 1 };
function input(edit = value => value) {
  const report = { ...binding, executionMode: 'installed-candidate', success: true,
    testResults: [{ name: '/workspace/' + file, status: 'passed', assertionResults: [{ title: id, fullName: id, status: 'passed' }] }] };
  return { path: 'fixture/report.json', bytes: Buffer.from(JSON.stringify(edit(report))) };
}
it('retains the actual assertion text, counts and execution bindings', () => {
  const result = bundleProof(catalog, [input()], binding);
  expect(result.failures).toEqual([]);
  expect(result.report.testResults[0].assertionResults[0].fullName).toBe(id);
  expect(result.report.command).toBe(binding.command);
  expect(result.result).toMatchObject({ passed: 1, failed: 0, skipped: 0, todo: 0 });
});
it('rejects absent/duplicate files, absent required cases and failed collection', () => {
  expect(bundleProof(catalog, [], binding).failures.join()).toMatch(/missing executed file/);
  expect(bundleProof(catalog, [input(), input()], binding).failures.join()).toMatch(/duplicate/);
  expect(bundleProof(catalog, [input(r => ({ ...r, testResults: [] }))], binding).failures.join()).toMatch(/missing/);
  expect(bundleProof(catalog, [input(r => ({ ...r, success: false }))], binding).failures.join()).toMatch(/did not succeed/);
  expect(bundleProof(catalog, [input(r => {
    r.testResults[0].assertionResults[0].fullName = 'another case'; return r;
  })], binding).failures.join()).toMatch(/missing executed case/);
});
it.each(['failed', 'pending', 'skipped', 'todo'])('preserves nonpassed %s assertions', status => {
  const result = bundleProof(catalog, [input(r => {
    r.testResults[0].assertionResults[0].status = status; return r;
  })], binding);
  expect(result.report.success).toBe(false);
  expect(result.result.passed).toBe(0);
  expect(result.failures.join()).toMatch(/failed\/skipped\/todo/);
});
it.each(['sourceHead', 'artifactManifestSha256', 'runId', 'attempt', 'command'])('rejects missing or stale %s', key => {
  expect(bundleProof(catalog, [input(r => { delete r[key]; return r; })], binding).failures.join()).toContain(key);
  expect(bundleProof(catalog, [input(r => ({ ...r, [key]: 'stale' }))], binding).failures.join()).toContain(key);
});
it('refuses source-only E4 substitution and path traversal', () => {
  expect(bundleProof(catalog, [input(r => ({ ...r, executionMode: 'source-only' }))], binding).failures.join()).toMatch(/not installed E4/);
  expect(() => normalizeReportPath('/tmp/packages/../escape')).toThrow(/invalid report path/);
});
