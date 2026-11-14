import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertStable, validateApplicability } from './t3-applicability.mjs';

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
