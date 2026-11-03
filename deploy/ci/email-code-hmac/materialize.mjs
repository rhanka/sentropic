// Pure materialize logic for .github/workflows/email-code-hmac-secret.yml
// (method qk-secret-custody-r2 §3.2). Imported by workflow.mjs and by the
// selftest; contains no I/O. Values arrive only through the caller (workflow
// step env bound to secrets.*/vars.*) and leave only as base64 manifest data.
import { KEY_RE, REF_RE, SECRET_NAME, keyedFingerprint, refFp16, refTier } from './core.mjs';

export const NAMESPACES = { preprod: 'sentropic-preprod', prod: 'sentropic' };
export const ROLLOUT_DEPLOYMENT = 'api';
export const APPLY_FIELD_MANAGER = 'email-code-hmac-secret';

const isSet = v => v !== undefined && v !== null && v !== '';

// Validate the ring before any cluster write (method §3.2 step 1). Throws
// Error with a fixed code; never includes a value in the message.
export function validateRing({ tier, active, activeRef, previous, previousRef }) {
  if (!isSet(active) || !KEY_RE.test(active)) throw new Error('email_code_hmac_credential_invalid');
  if (!isSet(activeRef) || !REF_RE.test(activeRef)) throw new Error('email_code_hmac_ref_mismatch');
  if (refTier(activeRef) !== tier) throw new Error('email_code_hmac_ref_mismatch');
  if (refFp16(activeRef) !== keyedFingerprint(active).slice(0, 16)) throw new Error('email_code_hmac_ref_mismatch');
  const hasPrevious = isSet(previous);
  const hasPreviousRef = isSet(previousRef);
  if (hasPrevious !== hasPreviousRef) throw new Error('email_code_hmac_credential_invalid');
  let previousFingerprint = null;
  if (hasPrevious) {
    if (!KEY_RE.test(previous)) throw new Error('email_code_hmac_credential_invalid');
    if (!REF_RE.test(previousRef) || refTier(previousRef) !== tier) throw new Error('email_code_hmac_ref_mismatch');
    if (refFp16(previousRef) !== keyedFingerprint(previous).slice(0, 16)) throw new Error('email_code_hmac_ref_mismatch');
    if (keyedFingerprint(previous) === keyedFingerprint(active)) throw new Error('email_code_hmac_ref_mismatch');
    previousFingerprint = keyedFingerprint(previous);
  }
  return {
    activeRef,
    previousRef: hasPrevious ? previousRef : null,
    activeFingerprint: keyedFingerprint(active),
    previousFingerprint,
  };
}

// Manifest data carries exactly the §1.2 keys that are present; no empty-string
// keys, no create (the shell Secret already exists; apply is an update).
export function buildManifest({ namespace, active, activeRef, previous, previousRef }) {
  const data = {
    EMAIL_CODE_HMAC_KEY_ACTIVE: Buffer.from(active, 'utf8').toString('base64'),
    EMAIL_CODE_HMAC_KEY_ACTIVE_REF: Buffer.from(activeRef, 'utf8').toString('base64'),
  };
  if (isSet(previous)) {
    data.EMAIL_CODE_HMAC_KEY_PREVIOUS = Buffer.from(previous, 'utf8').toString('base64');
    data.EMAIL_CODE_HMAC_KEY_PREVIOUS_REF = Buffer.from(previousRef, 'utf8').toString('base64');
  }
  return { apiVersion: 'v1', kind: 'Secret', metadata: { name: SECRET_NAME, namespace }, type: 'Opaque', data };
}

export const applyResultOk = stdout => new RegExp(`^secret/${SECRET_NAME} serverside-applied\\s*$`).test(stdout);

// The single JSON log line (method §3.2 step 4): names, refs and keyed
// fingerprints only — never a bare hash of a value, never a value.
export function summaryLine({ namespace, ring }) {
  return JSON.stringify({
    name: SECRET_NAME,
    namespace,
    status: 'serverside-applied',
    activeRef: ring.activeRef,
    previousRef: ring.previousRef,
    activeFingerprint: ring.activeFingerprint,
    previousFingerprint: ring.previousFingerprint,
  });
}

export function summaryMarkdown({ namespace, ring }) {
  return `### Secret ${SECRET_NAME} (${namespace})\n\n\`\`\`json\n${summaryLine({ namespace, ring })}\n\`\`\`\n`;
}
