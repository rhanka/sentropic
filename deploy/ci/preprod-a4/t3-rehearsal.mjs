import { readFileSync, writeFileSync } from 'node:fs';
import { canonical, digest } from './guards.mjs';
import { aclSql } from './t3-restore.mjs';

export const STATE_HASHES = ['sourceContentSha256','schemaSha256','journalSha256','remoteSnapshotDigest',
  'mappingSha256','identityAssetSha256','connectorAssetSha256'];
export function validateReceiptPolicy(config, grant, read) {
  const policy = config.applicabilityReceiptPolicy;
  if (!policy || grant.applicabilityReceiptPolicySha256 !== digest(canonical(policy))
    || policy.originalRehearsalSha256 !== digest(read(config.rehearsalFile))
    || policy.baselineSha256 !== digest(read(config.applicabilityBaselineFile))
    || JSON.stringify(policy.allowedChanges) !== '["sourceContentSha256"]'
    || typeof policy.reviewRef !== 'string' || !policy.reviewRef.trim()
    || /pending|TODO|<|>/i.test(policy.reviewRef)) throw new Error('receipt_policy_invalid');
}

export function fencedReceipt(original,snapshot,policy) {
  for (const key of STATE_HASHES) {
    if (!/^[a-f0-9]{64}$/.test(original[key] ?? '') || !/^[a-f0-9]{64}$/.test(snapshot[key] ?? '')) {
      throw new Error('receipt_hash_missing');
    }
    if (key !== 'sourceContentSha256' && original[key] !== snapshot[key]) throw new Error(`receipt_asset_drift:${key}`);
  }
  if (original.candidateCommit !== snapshot.candidateCommit || original.candidateImage !== snapshot.candidateImage
    || original.candidateBootPassed !== true || original.functionalAuthPassed !== true || original.d11Passed !== true) {
    throw new Error('original_rehearsal_unqualified');
  }
  return { ...original,sourceContentSha256: snapshot.sourceContentSha256,applicabilityReviewRef: policy.reviewRef };
}

// Called only after full applicability equality at W5, before staging the final receipt.
export function prepareFencedReceipt(ctx,query) {
  if (ctx.dryRun && !ctx.probeReadOnly) {
    ctx.print('# dry-run: verify W5 ACLs and rebase the qualified receipt under its bound applicability policy');
    return ctx.config.rehearsalFile;
  }
  const config = ctx.config, originalBytes = readFileSync(config.rehearsalFile,'utf8');
  const original = JSON.parse(originalBytes), policy = config.applicabilityReceiptPolicy;
  if (digest(originalBytes) !== policy?.originalRehearsalSha256) throw new Error('original_rehearsal_changed');
  const snapshot = JSON.parse(ctx.call(['exec','sentropic-a4-custodian','-c','custodian','--','node','-e',
    "process.stdout.write(require('node:fs').readFileSync('/run/cm-cutover/snapshot.json','utf8'))"]));
  if (snapshot.operationId !== config.request.operationId || snapshot.candidateCommit !== config.request.candidateCommit
    || snapshot.candidateImage !== config.request.candidateImage || !/^[a-f0-9]{64}$/.test(snapshot.backupSha256)) {
    throw new Error('fenced_snapshot_binding_invalid');
  }
  const acl = JSON.parse(readFileSync(config.aclReceiptFile,'utf8'));
  if (query(ctx,aclSql()).trim() !== acl.aclCatalogSha256
    || digest(readFileSync(config.restoreAclFile)) !== acl.aclSqlSha256) throw new Error('w5_acl_drift');
  const receipt = fencedReceipt(original,snapshot,policy);
  const path = `${ctx.stateDir}/fenced-rehearsal.json`;
  writeFileSync(path,JSON.stringify(receipt),{ mode: 0o600,flag: 'wx' });
  writeFileSync(`${ctx.stateDir}/w5-review.json`,JSON.stringify({ originalRehearsalSha256: digest(originalBytes),
    fencedRehearsalSha256: digest(JSON.stringify(receipt)),backupSha256: snapshot.backupSha256,
    aclCatalogSha256: acl.aclCatalogSha256,aclSqlSha256: acl.aclSqlSha256 }),{ mode: 0o600,flag: 'wx' });
  return path;
}
