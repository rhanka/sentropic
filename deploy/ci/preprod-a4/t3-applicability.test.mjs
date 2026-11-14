import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertStable, checkApplicability, validateApplicability, witnessBinding } from './t3-applicability.mjs';

export const applicabilityFixture = () => ({ version: 'cutover-applicability-v1', ok: true,
  durableCutoverApplicabilitySha256: 'a'.repeat(64), encryptedStoresSha256: 'b'.repeat(64),
  encryptedStoreFingerprints: Object.fromEntries(['settings_enc','document_connector_accounts_enc',
    'llm_provider_accounts_enc','connector_revocation_custody_enc'].map(key => [key,'d'.repeat(64)])),
  guards: { cm_identity_schema_present: false, live_federation_flow_states: 0,
    non_null_identity_token_secrets: 0, cm_identity_invitations: { row_count: 0 },
    cm_identity_import_receipts: { row_count: 0 }, app_cm_identity_cutover: { row_count: 0 } } });

test('applicability fails closed on missing source relations, guards and malformed hashes', () => {
  for (const patch of [{ ok: false }, { guards: {} }, { encryptedStoresSha256: '' }]) {
    assert.throws(() => validateApplicability({ ...applicabilityFixture(), ...patch }));
  }
  assert.doesNotThrow(() => assertStable(applicabilityFixture(), applicabilityFixture()));
});
test('applicability rejects durable drift and same-length encrypted value changes', () => {
  for (const key of ['durableCutoverApplicabilitySha256', 'encryptedStoresSha256']) {
    const reference = applicabilityFixture(), changed = { ...reference, [key]: 'c'.repeat(64) };
    assert.throws(() => assertStable(reference, changed), /applicability_drift/);
  }
});
test('W5 applicability review omits witnessSha256 and witnessSalt from rehearsalOriginalState', () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-app-'));
  try {
    const witness = { url: 'https://app.test/api/v1/me', cookie: 'session=secret' };
    const witnessSalt = 'e'.repeat(64);
    const baselinePath = join(dir, 'baseline.json');
    writeFileSync(baselinePath, JSON.stringify({
      ...applicabilityFixture(), witnessSalt, witnessSha256: witnessBinding(witness, witnessSalt),
    }), { mode: 0o600 });
    checkApplicability({
      dryRun: false, stateDir: dir,
      config: { applicabilityBaselineFile: baselinePath, witness },
    }, () => JSON.stringify(applicabilityFixture()), 'W5');
    const review = JSON.parse(readFileSync(join(dir, 'applicability-review.json'), 'utf8'));
    assert.equal(review.rehearsalOriginalState.witnessSha256, undefined);
    assert.equal(review.rehearsalOriginalState.witnessSalt, undefined);
    assert.equal(review.rehearsalOriginalState.durableCutoverApplicabilitySha256, 'a'.repeat(64));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
