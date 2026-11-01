export const L08A_ACCEPTANCE = [
  { id: 'L8-B', owner: 'ACT-L08a', destinations: ['report-branch-integrity.test.mjs', 'workflow-contract.test.mjs'], tests: ['T5-C1', 'T5-C4'], disposition: 'replaced-collector-app-with-deploy-key', suite: 'test-security-daily' },
  { id: 'L8-C', owner: 'ACT-L08a', destinations: ['report-format.test.mjs', 'report-transfer.test.mjs'], tests: ['T5-C3-shared'], disposition: 'replaced-anonymous-public-access', suite: 'test-security-daily' },
  { id: 'L8-D', owner: 'ACT-L08a', destinations: ['report-branch-integrity.test.mjs'], tests: ['T5-C4', 'T6-C2-shared'], disposition: 'replaced-git-data-api-with-ssh-cas', suite: 'test-security-daily' },
  { id: 'L8-G', owner: 'ACT-L08a', destinations: ['enable.test.mjs', 'control-permit.test.mjs', 'control-permit-channel.test.mjs', 'control-clock.test.mjs', 'cancellation.test.mjs'], tests: ['T5-C6', 'T6-C1', 'T6-C3'], disposition: 'replaced-app-token-with-reader-copies', suite: 'test-security-daily' },
  { id: 'L8-H', owner: 'ACT-L08a', destinations: ['resource-envelope.test.mjs', 'workflow-contract.test.mjs'], tests: ['T6-B1'], disposition: 'replaced-private-counts-with-same-repo-envelope', suite: 'test-security-daily' },
  { id: 'L8-I', owner: 'ACT-L08a', destinations: ['deadline-report.test.mjs', 'report-format.test.mjs'], tests: ['T5-C1', 'T5-C4'], disposition: 'retained-independent-deadline-path', suite: 'test-security-daily' },
  { id: 'L8-J', owner: 'ACT-L08a', destinations: ['control-provisioning.test.mjs', 'control-permit-channel.test.mjs', 'control-clock.test.mjs'], tests: ['T5-C1', 'T5-C4', 'T5-C6', 'T6-C1', 'T6-C3', 'T6-M1'], disposition: 'replaced-app-ids-with-token-key-rows', suite: 'test-security-daily' },
  { id: 'L8-K', owner: 'ACT-L08a', destinations: ['collector-provenance.test.mjs', 'control-image-publish.test.mjs', 'workflow-contract.test.mjs'], tests: ['T5-C1', 'T5-C6'], disposition: 'retained-separate-builder-publisher', suite: 'test-security-daily' },
  { id: 'T5-C1', owner: 'ACT-L03a/ACT-L08a', destinations: ['workflow-contract.test.mjs'], tests: [], disposition: 'shared-single-environment-map', suite: 'test-security-daily' },
  { id: 'T5-C4', owner: 'ACT-L08a/ACT-L10a', destinations: ['report-branch-integrity.test.mjs'], tests: [], disposition: 'shared-deploy-key-update', suite: 'test-security-daily' },
  { id: 'T5-C6', owner: 'ACT-L03a/ACT-L08a/ACT-L10a', destinations: ['control-provisioning.test.mjs', 'control-permit-channel.test.mjs', 'control-clock.test.mjs'], tests: [], disposition: 'shared-credential-topology', suite: 'test-security-daily' },
  { id: 'T6-C1', owner: 'ACT-L03a/ACT-L08a/ACT-L10a', destinations: ['workflow-contract.test.mjs', 'control-provisioning.test.mjs'], tests: [], disposition: 'shared-emitted-job-inventory', suite: 'test-security-daily' },
  { id: 'T6-B1', owner: 'ACT-L08a/ACT-L08b/ACT-L10a', destinations: ['resource-envelope.test.mjs'], tests: [], disposition: 'shared-frozen-graph-bounds', suite: 'test-security-daily' },
  { id: 'T6-C3', owner: 'ACT-L03a/ACT-L08a/ACT-L10a', destinations: ['control-permit-channel.test.mjs', 'control-clock.test.mjs'], tests: [], disposition: 'shared-peer-elevation-guardian', suite: 'test-security-daily' },
  { id: 'T6-M1', owner: 'ACT-L03b/ACT-L08a/ACT-L10a', destinations: ['control-provisioning.test.mjs'], tests: [], disposition: 'shared-disposition-enumeration', suite: 'test-security-daily' },
];

export const L05_ACCEPTANCE = [
  { id: 'L5-A', owner: 'ACT-L05', destinations: ['target-custody.test.mjs', 'trivy.test.mjs'], tests: [], disposition: 'exact-three-image-main-cohort-with-immutable-remote-scan', suite: 'test-security-daily' },
  { id: 'L5-B', owner: 'ACT-L05', destinations: ['target-custody.test.mjs'], tests: [], disposition: 'target-scoped-acquisition-boundary-with-anonymous-public-pull', suite: 'test-security-daily' },
  { id: 'L5-C', owner: 'ACT-L05', destinations: ['rebuild-isolation.test.mjs'], tests: [], disposition: 'isolated-rebuild-with-verified-receipt', suite: 'test-security-daily' },
  { id: 'L5-D', owner: 'ACT-L05', destinations: ['report-transfer.test.mjs'], tests: [], disposition: 'chunked-public-report-transfer-with-forgery-rejection', suite: 'test-security-daily' },
  { id: 'L5-E', owner: 'ACT-L05', destinations: ['report-transfer.test.mjs'], tests: [], disposition: 'measured-transfer-budget-with-independent-report-storage', suite: 'test-security-daily' },
];

export function validateDisposition(rows) {
  const errors = [];
  for (const row of rows) {
    if (!row.id || !row.owner) errors.push('every row needs an id and an owner');
    if (!Array.isArray(row.destinations) || row.destinations.length === 0) {
      errors.push(`${row.id}: concrete destination is required`);
    }
    if (row.suite !== 'test-security-daily') errors.push(`${row.id}: suite must be test-security-daily`);
    if (row.disposition === 'na') errors.push(`${row.id}: bare N/A cannot replace an assertion`);
  }
  return errors;
}
