import { readFileSync, writeFileSync } from 'node:fs';

export const applicabilitySql = () => readFileSync(new URL('./cutover-applicability-v1.sql', import.meta.url), 'utf8');
const hashes = ['durableCutoverApplicabilitySha256', 'encryptedStoresSha256'];
const stores = ['settings_enc','document_connector_accounts_enc','llm_provider_accounts_enc','connector_revocation_custody_enc'];

export function validateApplicability(value) {
  if (value?.version !== 'cutover-applicability-v1' || value.ok !== true
    || hashes.some(key => !/^[a-f0-9]{64}$/.test(value[key] ?? ''))) throw new Error('applicability_invalid');
  if (stores.some(key => !/^[a-f0-9]{64}$/.test(value.encryptedStoreFingerprints?.[key] ?? ''))) {
    throw new Error('encrypted_store_fingerprints_invalid');
  }
  const g = value.guards;
  if (!g || g.cm_identity_schema_present !== false || g.live_federation_flow_states !== 0
    || g.non_null_identity_token_secrets !== 0 || ['cm_identity_invitations', 'cm_identity_import_receipts',
      'app_cm_identity_cutover'].some(key => g[key]?.row_count !== 0)) throw new Error('applicability_guard');
  return value;
}

export function assertStable(reference, current) {
  validateApplicability(reference);
  validateApplicability(current);
  for (const key of hashes) if (reference[key] !== current[key]) throw new Error(`applicability_drift:${key}`);
  for (const key of stores) if (reference.encryptedStoreFingerprints[key] !== current.encryptedStoreFingerprints[key]) {
    throw new Error(`encrypted_store_drift:${key}`);
  }
}

export function inspectApplicability(ctx, query) {
  if (ctx.dryRun && !ctx.probeReadOnly) {
    ctx.print('# dry-run: compare applicability and all four encrypted stores with P-0 baseline');
    return null;
  }
  return validateApplicability(JSON.parse(query(ctx, applicabilitySql()).trim()));
}

export function checkApplicability(ctx, query, phase) {
  const reference = ctx.dryRun && !ctx.probeReadOnly ? null
    : validateApplicability(JSON.parse(readFileSync(ctx.config.applicabilityBaselineFile, 'utf8')));
  const current = inspectApplicability(ctx, query);
  if (!current) return;
  assertStable(reference, current);
  if (phase === 'W5') {
    writeFileSync(`${ctx.stateDir}/applicability-review.json`, JSON.stringify({
      rehearsalOriginalState: reference, fencedSnapshotState: current,
    }), { mode: 0o600 });
  }
}
