export const LOADER_KINDS = {
  'SEAT_ENVIRONMENT_WRITER_TOKEN': 'seat-environment-writer',
  'SECURITY_CONTROL_READER_TOKEN': 'control-reader',
  'SECURITY_REPORT_DEPLOY_KEY': 'report-deploy-key',
  'SECURITY_REVIEW_ATTESTOR_TOKEN': 'review-attestor',
  'SECURITY_CONTROL_PERMIT_SIGNING_KEY_PUBLIC': 'scan-permit-signer',
  'SECURITY_CONTROL_PERMIT_SIGNING_KEY_CUSTODY': 'seat-permit-signer',
  'SEAT_SETTLEMENT_DECRYPTION_KEY': 'seat-settlement-recipient',
  'SEAT_SUCCESSOR_RECOVERY_KEY': 'seat-successor-recipient',
};

export const L08A_ROWS = [
  {
    loaderKind: 'control-reader',
    credential: 'SECURITY_CONTROL_READER_TOKEN',
    copies: 12,
    rotation: 'one logical epoch across every copy',
  },
  {
    loaderKind: 'report-deploy-key',
    credential: 'SECURITY_REPORT_DEPLOY_KEY',
    copies: 1,
    rotation: 'ninety days maximum, immediate revocation on compromise',
  },
  {
    loaderKind: 'scan-permit-signer',
    credential: 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_PUBLIC',
    copies: 1,
    rotation: 'ninety days maximum, invalidate old sessions and pins',
  },
];

const VALUE_LIKE_KEYS = new Set(['value', 'privateKey', 'token', 'secret', 'seed', 'digest']);
const MAX_LIFETIME_MS = 90 * 86400000;

export function loaderKindFor(credential) {
  return LOADER_KINDS[credential];
}

export function validateProvisioningReceipt(r) {
  const errors = [];
  if (!LOADER_KINDS[r.credential]) errors.push(`credential ${r.credential} has no reviewed loader kind`);
  if (r.loaderKind !== LOADER_KINDS[r.credential]) errors.push('loader kind must match the credential map');
  for (const key of Object.keys(r)) {
    if (VALUE_LIKE_KEYS.has(key)) errors.push(`receipt must never carry ${key}`);
  }
  if (typeof r.expiresAt !== 'number' || typeof r.createdAt !== 'number') {
    errors.push('creation and expiry metadata are required');
  } else if (r.expiresAt - r.createdAt > MAX_LIFETIME_MS) {
    errors.push('persistent credential lifetime must not exceed ninety days');
  }
  if (!Array.isArray(r.copies) || r.copies.length === 0) errors.push('exact environment copies are required');
  if (!Array.isArray(r.probes) || r.probes.length === 0) errors.push('permitted and denied probe results are required');
  return errors;
}

// r6 §4.5 / T5-C6 / T6-M1 — credential provisioning, copy and rotation receipt contract.
// Names-only: no secret value or credential-derived digest may appear in a receipt.
// The ten §4.5 rows are embedded because the .tmp preservation inventories are not part
// of the shipped tree; the C/ suite (acceptance-disposition.ts) carries the same rows and
// this module cross-checks the workflow environment map against the C/ contract source.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const REPOSITORY = 'rhanka/sentropic';
export const MAX_TOKEN_EXPIRY_DAYS = 90;

// The twelve environments holding a same-epoch copy of SECURITY_CONTROL_READER_TOKEN (r6 §4.1).
export const READER_ENVIRONMENTS = [
  'security-daily-control', 'security-nightly', 'security-seat-writer', 'security-seat-admission',
  'security-seat-dispatch', 'security-report-publish', 'security-repair-publish', 'security-repair-merge',
  'security-review-attest', 'security-source-acquire', 'security-ci-status', 'security-promotion-control',
];

// The fixed loader-kind vocabulary reuses the reviewed credential map above and adds the
// two non-credential delivery kinds of the r6 §4.5 table.
export const LOADER_KIND_LIST = [
  ...new Set(Object.values(LOADER_KINDS)),
  'five-CLI enrollment/refresh loader',
  'none-platform-delivery',
];

// r6 §4.5 credential table: credential, provisioning/rotation owner, expiry rule,
// every exact environment/name copy, and the fixed rotation loader kind.
export const CREDENTIAL_ROWS = [
  { credential: 'SEAT_ENVIRONMENT_WRITER_TOKEN', owner: 'ACT-L03a', expiry: '<=90d', copies: ['security-seat-writer/SEAT_ENVIRONMENT_WRITER_TOKEN'], loaderKind: 'seat-environment-writer' },
  { credential: 'SECURITY_CONTROL_READER_TOKEN', owner: 'ACT-L08a', expiry: 'one-rotation-epoch-all-copies', copies: READER_ENVIRONMENTS.map(e => `${e}/SECURITY_CONTROL_READER_TOKEN`), loaderKind: 'control-reader' },
  { credential: 'SECURITY_REPORT_DEPLOY_KEY', owner: 'ACT-L08a', expiry: '<=90d', copies: ['security-report-publish/SECURITY_REPORT_DEPLOY_KEY'], loaderKind: 'report-deploy-key' },
  { credential: 'SECURITY_REVIEW_ATTESTOR_TOKEN', owner: 'ACT-L10a', expiry: '<=90d', copies: ['security-review-attest/SECURITY_REVIEW_ATTESTOR_TOKEN'], loaderKind: 'review-attestor' },
  { credential: 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_PUBLIC', owner: 'ACT-L08a', expiry: '<=90d-or-compromise', copies: ['security-daily-control/SECURITY_CONTROL_PERMIT_SIGNING_KEY_PUBLIC'], loaderKind: 'scan-permit-signer' },
  { credential: 'SECURITY_CONTROL_PERMIT_SIGNING_KEY_CUSTODY', owner: 'ACT-L03a', expiry: '<=90d-or-compromise', copies: ['security-nightly/SECURITY_CONTROL_PERMIT_SIGNING_KEY_CUSTODY'], loaderKind: 'seat-permit-signer' },
  { credential: 'SEAT_SETTLEMENT_DECRYPTION_KEY', owner: 'ACT-L03a', expiry: '<=90d-or-compromise', copies: ['security-seat-writer/SEAT_SETTLEMENT_DECRYPTION_KEY'], loaderKind: 'seat-settlement-recipient' },
  { credential: 'SEAT_SUCCESSOR_RECOVERY_KEY', owner: 'ACT-L03a', expiry: '<=90d-or-compromise', copies: ['security-seat-writer/SEAT_SUCCESSOR_RECOVERY_KEY'], loaderKind: 'seat-successor-recipient' },
  { credential: 'SEAT_*/SEAT_CANDIDATE_*/SEAT_USE_* slot manifest', owner: 'enrollment owner + ACT-L03a', expiry: 'provider-lifecycle', copies: ['security-seat-maintenance canonical/candidate', 'security-nightly projections'], loaderKind: 'five-CLI enrollment/refresh loader' },
  { credential: 'per-job GITHUB_TOKEN / scanner OIDC', owner: 'respective workflow maintainer', expiry: 'end-of-job', copies: ['no stored copy'], loaderKind: 'none-platform-delivery' },
];

const FORBIDDEN_RECEIPT_KEYS = ['value', 'secretValue', 'secret', 'token', 'privateKey', 'pem', 'password', 'credentialValue'];
const DIGEST_FIELD_ALLOWLIST = ['bundleDigest', 'protectionDigest', 'manifestDigest', 'publicKeyFingerprint'];

export function assertCredentialRows(rows = CREDENTIAL_ROWS) {
  if (rows.length !== 10) throw new Error('credential-row-count');
  for (const row of rows) {
    if (!row.credential || !row.owner || !row.expiry) throw new Error('credential-row-incomplete:' + row.credential);
    if (!Array.isArray(row.copies) || row.copies.length === 0) throw new Error('credential-copies-missing:' + row.credential);
    if (!LOADER_KIND_LIST.includes(row.loaderKind)) throw new Error('loader-kind-unknown:' + row.loaderKind);
    if (row.expiry === '<=90d' && MAX_TOKEN_EXPIRY_DAYS !== 90) throw new Error('expiry-bound-changed');
  }
  const reader = rows.find(r => r.credential === 'SECURITY_CONTROL_READER_TOKEN');
  if (reader.copies.length !== 12) throw new Error('reader-copy-count');
  return true;
}

// CredentialProvisioningReceiptV1 (r6 §4.5): logical IDs, numeric principals, exact
// environment/name copies, allowlist, digests, creation/expiry/next-rotation metadata,
// probe results, loader revision, revocation result, verification IDs. Names-only.
export function assertProvisioningReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') throw new Error('receipt-missing');
  for (const key of Object.keys(receipt)) {
    if (FORBIDDEN_RECEIPT_KEYS.includes(key)) throw new Error('receipt-secret-material:' + key);
  }
  for (const [key, value] of Object.entries(receipt)) {
    if (key.endsWith('Digest') || key.endsWith('Fingerprint')) {
      if (!DIGEST_FIELD_ALLOWLIST.some(a => key === a)) throw new Error('receipt-digest-not-allowlisted:' + key);
      if (typeof value !== 'string' || !/^(sha256:)?[0-9a-f]{64}$/.test(value)) throw new Error('receipt-digest-malformed:' + key);
    }
  }
  if (!receipt.credentialId || !receipt.credentialType) throw new Error('receipt-credential-id');
  if (!Number.isSafeInteger(receipt.principalId) && !receipt.keyId) throw new Error('receipt-principal');
  if (!Array.isArray(receipt.repositoryIds) || receipt.repositoryIds.some(id => !Number.isSafeInteger(id))) throw new Error('receipt-repositories');
  if (!Array.isArray(receipt.grantedPermissions) || receipt.grantedPermissions.length === 0) throw new Error('receipt-permissions');
  if (!Array.isArray(receipt.environmentNameCopies) || receipt.environmentNameCopies.length === 0) throw new Error('receipt-copies');
  for (const copy of receipt.environmentNameCopies) {
    if (typeof copy !== 'string' || !/^[a-z0-9-]+\/[A-Z0-9_]+$/.test(copy)) throw new Error('receipt-copy-malformed:' + copy);
  }
  if (!Array.isArray(receipt.workflowStepAllowlist) || !Array.isArray(receipt.probeResults)) throw new Error('receipt-allowlist-probes');
  const created = Date.parse(receipt.createdAt); const expires = Date.parse(receipt.expiresAt); const next = Date.parse(receipt.nextRotationAt);
  if (![created, expires, next].every(Number.isFinite)) throw new Error('receipt-dates');
  const row = CREDENTIAL_ROWS.find(r => r.credential === receipt.credentialId);
  if (row && row.expiry === '<=90d') {
    const days = (expires - created) / 86_400_000;
    if (days > MAX_TOKEN_EXPIRY_DAYS) throw new Error('receipt-expiry-over-90d');
    if (next > expires) throw new Error('receipt-rotation-after-expiry');
  }
  if (typeof receipt.loaderKind !== 'string' || !LOADER_KIND_LIST.includes(receipt.loaderKind)) throw new Error('receipt-loader-kind');
  if (!receipt.oldCredentialRevoked) throw new Error('receipt-revocation-missing');
  if (!Array.isArray(receipt.verificationRunIds) || receipt.verificationRunIds.length === 0) throw new Error('receipt-verification');
  if (receipt.outcome !== 'accepted') throw new Error('receipt-outcome:' + receipt.outcome);
  return true;
}

// Cross-check the §4.1 environment map against the C/ contract source and the actual
// workflow files: every security-* environment literal used by a workflow must be one
// of the fixed JOB_ENVIRONMENTS values, and the twelve reader copies must match.
export function crossCheckWorkflowEnvironments(repoRoot) {
  const contractSource = readFileSync(join(repoRoot, 'scripts/ci/seat-custody/src/seat-workflow-contract.ts'), 'utf8');
  const jobBlock = /JOB_ENVIRONMENTS[^=]*= \{([\s\S]*?)\};/.exec(contractSource);
  if (!jobBlock) throw new Error('job-map-unparseable');
  const jobEnvs = new Set([...jobBlock[1].matchAll(/'([a-z0-9-]+)':\s*'([a-z0-9-]+)'/g)].map(m => m[2]));
  const readerBlock = /READER_TOKEN_ENVIRONMENTS[^=]*= \[([\s\S]*?)\];/.exec(contractSource);
  if (!readerBlock) throw new Error('reader-map-unparseable');
  const readerEnvs = [...readerBlock[1].matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
  if (readerEnvs.length !== 12 || new Set(readerEnvs).size !== 12) throw new Error('reader-copy-count');
  if (readerEnvs.join(',') !== READER_ENVIRONMENTS.join(',')) throw new Error('reader-map-mismatch');
  for (const env of READER_ENVIRONMENTS) if (!jobEnvs.has(env)) throw new Error('reader-env-not-in-job-map:' + env);

  const wfDir = join(repoRoot, '.github/workflows');
  const used = new Set();
  for (const file of readdirSync(wfDir)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const text = readFileSync(join(wfDir, file), 'utf8');
    for (const m of text.matchAll(/environment:\s*([a-z0-9-]+)/g)) used.add(m[1]);
  }
  for (const env of used) {
    if (env.startsWith('security-') && !jobEnvs.has(env)) throw new Error('workflow-environment-not-allowlisted:' + env);
  }
  return { jobEnvironments: jobEnvs.size, readerEnvironments: readerEnvs.length, workflowEnvironments: used.size };
}
