export const REPORT_REF = 'security-reports';
export const ALLOWED_PATH_PREFIXES = ['reports/', 'state/', 'index.json'];
export const MAX_CAS_ATTEMPTS = 3;
export const ROTATION_MAX_DAYS = 90;
export const DAY_MS = 86400000;

const REPORT_WRITERS = new Set(['deploy-key']);

export function validatePushRequest(req) {
  const errors = [];
  if (req.ref !== REPORT_REF) errors.push(`ref must be ${REPORT_REF}`);
  if (req.force) errors.push('forced push refuses');
  if (req.deleteRef) errors.push('ref deletion refuses');
  if (!REPORT_WRITERS.has(req.actor)) errors.push(`actor ${req.actor} cannot update the report ref`);
  for (const entry of req.paths ?? []) {
    const path = typeof entry === 'string' ? entry : entry.path ?? '';
    if (typeof entry === 'object' && entry.symlink) {
      errors.push('symlinks refuse');
      continue;
    }
    const allowed = path === 'index.json' || path.startsWith('reports/') || path.startsWith('state/');
    if (!allowed) errors.push(`path ${path} is outside the data allowlist`);
    if (path.includes('.github/workflows')) errors.push(`workflow path ${path} refuses`);
    if (path.includes('..') || path.startsWith('/')) errors.push(`path ${path} escapes the ref`);
  }
  if (req.expectedParent !== req.actualParent) errors.push('cas conflict: re-read and recompute before retry');
  return errors;
}

export function casAdvance(attempts) {
  let tried = 0;
  for (const [index, attempt] of attempts.entries()) {
    tried += 1;
    if (tried > MAX_CAS_ATTEMPTS + 1) return { winner: -1, attempts: tried };
    if (attempt.expectedParent === attempt.actualParent) return { winner: index, attempts: tried };
  }
  return { winner: -1, attempts: tried };
}

export function rotationDue({ createdAt, now }) {
  return now - createdAt > ROTATION_MAX_DAYS * DAY_MS;
}

export function verifyRotation({ newKeyPush, oldKeyPush }) {
  const errors = [];
  if (newKeyPush !== 'allowed') errors.push('new key must prove a positive push');
  if (oldKeyPush !== 'denied') errors.push('old key must prove denied SSH after server-side removal');
  return errors;
}
