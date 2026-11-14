import { writeFileSync } from 'node:fs';
import { digest } from './guards.mjs';
import { STATE_HASHES } from './t3-rehearsal.mjs';
export function rehearsalFixture(dir,config,baselineBytes) {
  const original = { format: 'preprod-a4-rehearsal/2',receiptRef: 'track:qualified-rehearsal',
    applicabilityReviewRef: 'track:prior-review',candidateBootPassed: true,functionalAuthPassed: true,d11Passed: true,
    candidateCommit: config.candidateCommit,candidateImage: config.candidateImage,
    ...Object.fromEntries(STATE_HASHES.map(key => [key,'a'.repeat(64)])) };
  const bytes = JSON.stringify(original), aclBytes = '-- fixture acl\n';
  const paths = { rehearsalFile: `${dir}/original-rehearsal.json`,aclReceiptFile: `${dir}/acl.json`,restoreAclFile: `${dir}/acl.sql` };
  writeFileSync(paths.rehearsalFile,bytes); writeFileSync(paths.restoreAclFile,aclBytes);
  writeFileSync(paths.aclReceiptFile,JSON.stringify({ aclCatalogSha256: 'a'.repeat(64),aclSqlSha256: digest(aclBytes) }));
  return { ...paths,applicabilityReceiptPolicy: { originalRehearsalSha256: digest(bytes),baselineSha256: digest(baselineBytes),
    reviewRef: 'track:qualified-applicability',allowedChanges: ['sourceContentSha256'] },
    snapshot: { ...original,format: 'preprod-a4-snapshot/1',operationId: config.operationId,
      sourceContentSha256: 'b'.repeat(64),backupSha256: 'c'.repeat(64) } };
}
