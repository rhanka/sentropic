import assert from 'node:assert/strict';
import { json } from './bindings.mjs';
import { profileCases } from './candidates.mjs';

export function qualifyProfiles(b, mesh, claims) {
  const report = json(b.read('stage-b-result.json'));
  assert.equal(report.success, true, 'Stage B must pass');
  for (const field of ['numFailedTests', 'numPendingTests', 'numTodoTests', 'numFailedTestSuites'])
    assert.equal(report[field], 0, `Stage B ${field}`);
  assert.equal(report.numTotalTests, 24);
  assert.equal(report.numPassedTests, 24);
  const tests = report.testResults.flatMap((suite) => suite.assertionResults);
  assert.equal(tests.length, 24);
  assert(tests.every((test) => test.status === 'passed' && test.failureMessages.length === 0));
  const actual = tests.filter((test) => test.title !== 'inventory: should execute every Stage B case through the installed handle')
    .map((test) => test.title.split(':')[0]).sort();
  const expected = Object.entries(profileCases).flatMap(([profile, cases]) => cases.map((name) => `${profile}/${name}`)).sort();
  assert.deepEqual(actual, expected, 'every named Stage B behavior must pass exactly once');
  assert.equal(b.read('stage-b.status').toString(), 'exit=0\ncleanup=0\n');
  assert(b.read('stage-b.log').toString().includes('MEMORY_STAGE_B_RUNTIME'));
  const lock = json(b.read('stage-b-lock.json'));
  const entry = lock.packages[`node_modules/${mesh.name}`];
  assert.equal(entry.version, mesh.version);
  assert.equal(entry.integrity, mesh.integrity, 'Stage B must exercise the identical mesh archive');
  assert.equal(lock.packages['node_modules/@sentropic/engram'].version, '0.21.3');
  return claims.map((claim) => ({ ...claim, status: 'QUALIFIED',
    cases: profileCases[claim.name].map((name) => `${claim.name}/${name}`),
    evidence: 'stage-b-result.json', evidenceSha256: b.files['stage-b-result.json'].sha256,
    meshSha256: mesh.sha256 }));
}
