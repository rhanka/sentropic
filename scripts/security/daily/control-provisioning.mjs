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
