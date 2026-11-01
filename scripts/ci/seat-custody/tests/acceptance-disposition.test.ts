// T6-M1 (r6 §7.3): enumerate all 69 inherited acceptance IDs, 63 source-path
// dispositions, every §6.4 destination row, the L03a T5/T6 test IDs and the §4.5
// credential/copy/loader receipts. Missing owner, expiry, concrete destination or
// suite collection fails; a bare N/A replacing an old App assertion cannot pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCEPTANCE_IDS, CREDENTIAL_ROWS, L03A_TEST_IDS, LOADER_KINDS, REQUIRED_PATHS,
  SECTION_64_ROWS, resolveDestination, validateAcceptanceDisposition,
} from '../src/acceptance-disposition.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

test('T6-M1: all 69 inherited acceptance IDs are enumerated with an owning lot', () => {
  const result = validateAcceptanceDisposition(repoRoot);
  assert.equal(result.ids, 69);
  assert.equal(ACCEPTANCE_IDS.length, 69);
  assert.equal(new Set(ACCEPTANCE_IDS.map(a => a.id)).size, 69);
  for (const a of ACCEPTANCE_IDS) assert.ok(a.owner.length > 0, `owner missing for ${a.id}`);
  for (const expected of ['L3-A', 'L3-B', 'L3-C', 'L3-D', 'L3-F', 'L3-H', 'L3-I', 'L3-L', 'L10-J']) {
    assert.ok(ACCEPTANCE_IDS.some(a => a.id === expected), `${expected} missing`);
  }
});

test('T6-M1: all 63 source-path dispositions carry a suite and present paths exist in the tree', () => {
  const result = validateAcceptanceDisposition(repoRoot);
  assert.equal(result.paths, 63);
  assert.equal(REQUIRED_PATHS.length, 63);
  const present = REQUIRED_PATHS.filter(p => p.status === 'present');
  const missing = REQUIRED_PATHS.filter(p => p.status === 'missing');
  assert.equal(present.length, 36);
  assert.equal(missing.length, 27);
  for (const p of REQUIRED_PATHS) assert.ok(p.suite.startsWith('make '), `suite missing for ${p.path}`);
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

test('T6-M1: every L03a T5/T6 test ID resolves to an existing file at its §6.4 destination', () => {
  validateAcceptanceDisposition(repoRoot);
  const expected = ['T5-C1', 'T5-C2', 'T5-C3', 'T5-C6', 'T6-C1', 'T6-C2', 'T6-C3', 'T6-M1', 'T6-D1'];
  assert.deepEqual(Object.keys(L03A_TEST_IDS).sort(), expected.sort());
  for (const [id, dests] of Object.entries(L03A_TEST_IDS)) {
    for (const d of dests) {
      const rel = resolveDestination(d);
      assert.ok(rel.startsWith('scripts/ci/seat-custody/tests/') || rel.startsWith('scripts/security/daily/'), `${id}: ${d} outside C//D/`);
    }
  }
  // This suite itself is the T6-M1 C/ destination.
  assert.ok(L03A_TEST_IDS['T6-M1'].includes('C/acceptance-disposition.test.ts'));
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
