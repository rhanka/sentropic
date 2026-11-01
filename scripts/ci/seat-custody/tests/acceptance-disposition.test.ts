// T6-M1 (r6 §7.3, L03b): enumerate all 69 inherited acceptance IDs, resolve the
// 63 source-path dispositions (41 present after the L03a re-landing, 22 with exact
// reviewed replacement destinations), every §6.4 row, the L03a/L03b T5/T6 IDs and
// the §4.5 credential/copy/loader receipts. Collection proof: every destination
// file exists AND is wired into its owning required Make suite; a missing, silently
// renamed, excluded or bare-N/A case fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCEPTANCE_IDS, CREDENTIAL_ROWS, L03A_TEST_IDS, L03B_TEST_IDS, LOADER_KINDS,
  REQUIRED_PATHS, SECTION_64_ROWS, resolveDestination, validateAcceptanceDisposition,
  validateCollection,
} from '../src/acceptance-disposition.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

test('T6-M1: all 69 inherited acceptance IDs are enumerated with an owning lot', () => {
  const result = validateAcceptanceDisposition(repoRoot);
  assert.equal(result.ids, 69);
  assert.equal(ACCEPTANCE_IDS.length, 69);
  assert.equal(new Set(ACCEPTANCE_IDS.map(a => a.id)).size, 69);
  for (const a of ACCEPTANCE_IDS) assert.ok(a.owner.length > 0, `owner missing for ${a.id}`);
  for (const expected of ['L3-A', 'L3-B', 'L3-C', 'L3-D', 'L3-E', 'L3-G', 'L3-H', 'L3-J', 'L3-K', 'L3-M', 'L10-J']) {
    assert.ok(ACCEPTANCE_IDS.some(a => a.id === expected), `${expected} missing`);
  }
});

test('T6-M1: the 63-path inventory is resolved — 41 present in the tree, 22 with exact replacements', () => {
  const result = validateAcceptanceDisposition(repoRoot);
  assert.equal(result.paths, 63);
  assert.equal(REQUIRED_PATHS.length, 63);
  const present = REQUIRED_PATHS.filter(p => p.status === 'present');
  const replaced = REQUIRED_PATHS.filter(p => p.status === 'missing');
  assert.equal(present.length, 41);
  assert.equal(replaced.length, 22);
  for (const p of REQUIRED_PATHS) assert.ok(p.suite.startsWith('make '), `suite missing for ${p.path}`);
  // The STOP report's dated 36/27 split is resolved: the five files re-landed by
  // ACT-L03a are now present, and every remaining absent path carries an exact
  // reviewed replacement destination that exists in the tree.
  for (const p of replaced) {
    assert.ok(p.replacement && p.replacementOwner, `replacement missing for ${p.path}`);
    // Exact reviewed replacement: a concrete repo-relative destination that exists.
    assert.ok(!p.replacement.startsWith('C/') && !p.replacement.startsWith('D/'), `use repo-relative replacement for ${p.path}`);
  }
});

test('T6-M1: every §6.4 row has an owner and concrete C//D/ destinations', () => {
  const result = validateAcceptanceDisposition(repoRoot);
  assert.equal(result.rows, 28);
  assert.equal(SECTION_64_ROWS.length, 28);
  for (const row of SECTION_64_ROWS) {
    assert.ok(row.owner.length > 0, `owner missing for ${row.id}`);
    assert.ok(row.destinations.length > 0, `destinations missing for ${row.id}`);
    for (const d of row.destinations) assert.match(d, /^[CD]\//, `non-concrete destination ${d} in ${row.id}`);
  }
});

test('T6-M1: every L03a and L03b T5/T6 test ID resolves to an existing file at its §6.4 destination', () => {
  validateAcceptanceDisposition(repoRoot);
  const expectedL03a = ['T5-C1', 'T5-C2', 'T5-C3', 'T5-C6', 'T6-C1', 'T6-C2', 'T6-C3', 'T6-M1', 'T6-D1'];
  assert.deepEqual(Object.keys(L03A_TEST_IDS).sort(), expectedL03a.sort());
  const expectedL03b = ['T5-C5', 'T6-R1', 'T6-M1', 'L3-E'];
  assert.deepEqual(Object.keys(L03B_TEST_IDS).sort(), expectedL03b.sort());
  assert.deepEqual(L03B_TEST_IDS['T5-C5'], ['D/ci-trigger-bridge.test.mjs', 'D/review.test.mjs']);
  assert.deepEqual(L03B_TEST_IDS['T6-R1'], ['D/post-merge-effects.test.mjs']);
  assert.ok(L03B_TEST_IDS['L3-E'].includes('C/operation-model-map.test.ts'));
  for (const [id, dests] of Object.entries({ ...L03A_TEST_IDS, ...L03B_TEST_IDS })) {
    for (const d of dests) {
      const rel = resolveDestination(d);
      assert.ok(rel.startsWith('scripts/ci/seat-custody/tests/') || rel.startsWith('scripts/security/daily/'), `${id}: ${d} outside C//D/`);
    }
  }
  // This suite itself is the T6-M1 C/ destination.
  assert.ok(L03A_TEST_IDS['T6-M1'].includes('C/acceptance-disposition.test.ts'));
  assert.ok(L03B_TEST_IDS['T6-M1'].includes('C/acceptance-disposition.test.ts'));
  assert.ok(L03A_TEST_IDS['T6-D1'].includes('C/owner-procedure-contract.test.ts'));
});

test('T6-M1: §4.5 credential/copy/loader receipts are complete (10 rows, fixed loader kinds)', () => {
  validateAcceptanceDisposition(repoRoot);
  assert.equal(CREDENTIAL_ROWS.length, 10);
  for (const row of CREDENTIAL_ROWS) {
    assert.ok(row.owner.length > 0, `owner missing for ${row.credential}`);
    assert.ok(row.expiry.length > 0, `expiry missing for ${row.credential}`);
    assert.ok(row.copies.length > 0, `copies missing for ${row.credential}`);
    assert.ok(LOADER_KINDS.includes(row.loaderKind), `unknown loader kind ${row.loaderKind}`);
  }
  const writer = CREDENTIAL_ROWS.find(r => r.credential === 'SEAT_ENVIRONMENT_WRITER_TOKEN');
  assert.equal(writer?.expiry, '<=90d');
  const reader = CREDENTIAL_ROWS.find(r => r.credential === 'SECURITY_CONTROL_READER_TOKEN');
  assert.equal(reader?.expiry, 'one-rotation-epoch-all-copies');
});

test('T6-M1: a present path absent from the tree fails the disposition (no silent N/A)', () => {
  assert.throws(() => validateAcceptanceDisposition(resolve(repoRoot, 'scripts/ci/seat-custody')), /present-path-absent/);
});

test('T6-M1: collection proof — every destination exists and is wired into its owning required Make suite', () => {
  const collection = validateCollection(repoRoot);
  assert.equal(collection.destinations, new Set([
    ...SECTION_64_ROWS.flatMap(r => r.destinations),
    ...Object.values(L03A_TEST_IDS).flat(),
    ...Object.values(L03B_TEST_IDS).flat(),
    ...REQUIRED_PATHS.filter(p => p.status === 'missing').map(p => p.replacement!),
  ]).size);
  // Replacements are plain repo-relative paths; C//D/ destinations resolve via resolveDestination.
  assert.ok(collection.missingFiles.every(f => typeof f === 'string'));
  assert.ok(collection.cWired > 0 && collection.dWired > 0, 'both C/ and D/ destinations must be suite-wired');
  assert.equal(collection.unwired.length, 0, `unwired destinations: ${collection.unwired.join(', ')}`);
  assert.equal(collection.missingFiles.length, 0, `missing destination files: ${collection.missingFiles.join(', ')}`);
  // Every present inherited path's suite is a real Make target.
  assert.equal(collection.unknownSuites.length, 0, `unknown make targets: ${collection.unknownSuites.join(', ')}`);
});
