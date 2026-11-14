import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './guards.mjs';

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

// A legacy login can move the durable projection: an admin login rewrites the default workspace
// row (rehearsal r9). The P-0 baseline is valid only when captured after the witness login, with no
// admin login and no API restart until the fence. The capture proves the witness session is live and
// binds the baseline to it; the preflight and W0 refuse a baseline bound to anything else.
export const witnessBinding = witness => digest(`${witness?.url}\n${witness?.cookie}`);
export function assertBaselineAfterWitness(baseline, witness) {
  if (typeof witness?.url !== 'string' || typeof witness?.cookie !== 'string' || !witness.cookie.trim()
    || baseline?.witnessSha256 !== witnessBinding(witness)) throw new Error('baseline_not_after_witness');
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
  if (reference) assertBaselineAfterWitness(reference, ctx.config.witness);
  const current = inspectApplicability(ctx, query);
  if (!current) return;
  try {
    assertStable(reference, current);
  } catch (err) {
    // Before the fence nothing but a login, an API restart or a live writer can move the projection.
    throw new Error(phase === 'W0' ? `baseline_stale_before_fence: ${err.message}` : err.message);
  }
  if (phase === 'W5') {
    writeFileSync(`${ctx.stateDir}/applicability-review.json`, JSON.stringify({
      rehearsalOriginalState: reference, fencedSnapshotState: current,
    }), { mode: 0o600 });
  }
}
