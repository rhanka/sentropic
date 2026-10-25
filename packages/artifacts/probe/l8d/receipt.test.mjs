import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSuite, aggregate, suites } from './receipt.mjs';

const sha = 'a'.repeat(64);
const suite = (path) => ({ path, sourceSha256: sha, gate: 1, exitCode: 0,
  command: 'make test ENV=test-861-l8d', log: '',
  report: { testResults: [{ name: `/radar/${path}`,
    assertionResults: [{ status: 'passed' }] }] } });

test('should require all eight exact Radar suites', () => {
  assert.equal(suites.length, 8);
  for (const path of suites) assert.equal(validateSuite(suite(path)), 1);
});
for (const [label, mutate] of [
  ['disabled gate', (s) => { s.gate = 0; }],
  ['disabled reminder', (s) => { s.log = '[acceptance-disabled]'; }],
  ['failed command', (s) => { s.exitCode = 1; }],
  ['empty report', (s) => { s.report.testResults = []; }],
  ['wrong suite', (s) => { s.report.testResults[0].name += '.other'; }],
  ['skipped case', (s) => { s.report.testResults[0].assertionResults[0].status = 'pending'; }],
  ['failing case', (s) => { s.report.testResults[0].assertionResults[0].status = 'failed'; }],
  ['missing source hash', (s) => { delete s.sourceSha256; }],
]) test(`should refuse ${label}`, () => {
  const input = suite(suites[0]); mutate(input);
  assert.throws(() => validateSuite(input));
});

const shards = () => ['L8a', 'L8b', 'L8c', 'L8d'].map((lane) => ({
  lane, sourceCommit: 'b'.repeat(40), tupleDigest: sha, status: 'passed',
}));
test('should aggregate four passing shards for identical candidate bytes', () => {
  assert.equal(aggregate(shards()).status, 'passed');
});
for (const [label, mutate] of [
  ['missing lane', (s) => s.pop()],
  ['duplicate lane', (s) => { s[3].lane = 'L8a'; }],
  ['different archives', (s) => { s[2].tupleDigest = 'c'.repeat(64); }],
  ['different source', (s) => { s[1].sourceCommit = 'd'.repeat(40); }],
  ['known failure', (s) => { s[0].status = 'known_failure'; }],
]) test(`should refuse aggregate with ${label}`, () => {
  const input = shards(); mutate(input); assert.throws(() => aggregate(input));
});
