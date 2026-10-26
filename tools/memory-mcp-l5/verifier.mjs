// Qualification trust roots are host input. Production stays closed until its mappings are accepted.
import { createHash, createPublicKey, verify } from 'node:crypto';
const fail = () => { throw new Error('gate_failed'); };
const digest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
export function verifyAssurance(token, { policy, now, tenantId, principalId, enrollment }) {
  try {
    if (!policy || !['production', 'qualification'].includes(policy.purpose) || !policy.version ||
        !Number.isSafeInteger(now) || !Number.isInteger(policy.maxStepUpAgeSeconds) ||
        policy.maxStepUpAgeSeconds < 1 || policy.maxStepUpAgeSeconds > 300) return fail();
    if (policy.purpose === 'production' && (policy.issuer !== 'https://auth.sent-tech.ca' || policy.mappingStatus !== 'verified')) return fail();
    if (policy.purpose === 'qualification' && policy.issuer !== 'https://qualification.memory.test') return fail();
    if (typeof token !== 'string' || token.length > 16384) return fail();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(x => !/^[A-Za-z0-9_-]+$/.test(x) || Buffer.from(x, 'base64url').toString('base64url') !== x)) return fail();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (Object.keys(header).sort().join() !== 'alg,kid,typ' || header.alg !== 'EdDSA' || header.typ !== 'JWT' ||
        typeof header.kid !== 'string' || !Object.hasOwn(policy.keys, header.kid)) return fail();
    const key = createPublicKey({ key: policy.keys[header.kid], format: 'jwk' });
    if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(parts.slice(0, 2).join('.')), key, Buffer.from(parts[2], 'base64url'))) return fail();
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (claims.iss !== policy.issuer || claims.aud !== policy.audience || claims.tid !== tenantId ||
        typeof claims.sub !== 'string' || !claims.sub ||
        !['iat', 'nbf', 'exp', 'auth_time'].every(k => Number.isSafeInteger(claims[k])) ||
        claims.iat > now || claims.nbf > now || claims.exp <= now || claims.exp <= claims.iat ||
        claims.auth_time > now || now - claims.auth_time > policy.maxStepUpAgeSeconds) return fail();
    if (!Array.isArray(policy.acr) || !policy.acr.length || !policy.acr.includes(claims.acr) ||
        !Array.isArray(policy.amr) || !policy.amr.length || !Array.isArray(claims.amr) ||
        !policy.amr.every(method => claims.amr.includes(method))) return fail();
    // Enrollment is independently resolved by the host, never copied from token/email claims.
    const record = enrollment({ issuer: claims.iss, subject: claims.sub, tenantId });
    if (!record || record.subject !== claims.sub || record.tenantId !== tenantId || record.principalId !== principalId ||
        record.enrolled !== true || record.enrolled2fa !== true || record.human !== true || record.revoked !== false ||
        !/^sha256:[0-9a-f]{64}$/.test(record.receiptDigest)) return fail();
    return Object.freeze({ enrolled_oidc_domain: 'sent-tech.ca', issuer: claims.iss,
      approving_subject_sub: claims.sub, approving_human_principal_id: record.principalId,
      enrollment_receipt_digest: record.receiptDigest, step_up_2fa_receipt_digest: digest(token),
      assurance_policy_version: policy.version, authenticated: true, enrolled_2fa: true,
      step_up_assurance_verified: true, hardware_key_required: false, identity_source: 'enrolled_oidc_2fa' });
  } catch { return fail(); }
}
