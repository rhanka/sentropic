import { IdentityCustodyErrorV1, type IdentityEmailCodeKeyRingV1 } from '@sentropic/cluster-mesh';

/** Q-K is an explicit deployment choice, independent of the already answered Q-G. */
export function loadCmEmailCodePolicy(source: Readonly<Record<string, string | undefined>> = process.env) {
  const keys = new Map<string, Buffer>();
  const unavailable = (): never => { throw new IdentityCustodyErrorV1('identity_contract_unavailable'); };
  try {
    const issuance = source.CM_IDENTITY_EMAIL_CODE_POLICY;
    const approvalRef = source.CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF;
    if (!approvalRef?.trim() || (issuance !== 'sha256' && issuance !== 'hmac-sha256')) return unavailable();
    const encoded: unknown = JSON.parse(source.CM_IDENTITY_EMAIL_CODE_KEYS_JSON ?? '{}');
    if (!encoded || typeof encoded !== 'object' || Array.isArray(encoded)) return unavailable();
    for (const [ref, value] of Object.entries(encoded)) {
      if (!ref || ref.length > 128 || typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return unavailable();
      const key = Buffer.from(value, 'base64url');
      keys.set(ref, key);
      if (key.byteLength !== 32 || key.toString('base64url') !== value) return unavailable();
    }
    const previous: unknown = JSON.parse(source.CM_IDENTITY_EMAIL_CODE_PREVIOUS_KEY_REFS_JSON ?? '[]');
    if (!Array.isArray(previous) || !previous.every(ref => typeof ref === 'string' && keys.has(ref))
      || new Set(previous).size !== previous.length) return unavailable();
    const activeKeyRef = issuance === 'hmac-sha256' ? source.CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF : null;
    if (issuance === 'hmac-sha256' && (!activeKeyRef || !keys.has(activeKeyRef) || previous.includes(activeKeyRef))) return unavailable();
    if (issuance === 'sha256' && source.CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF) return unavailable();
    const policy: IdentityEmailCodeKeyRingV1 = { issuance, activeKeyRef: activeKeyRef ?? null, previousKeyRefs: [...previous] };
    return { policy, approvalRef, keys, dispose() {
      for (const key of keys.values()) key.fill(0);
      keys.clear();
    } };
  } catch {
    for (const key of keys.values()) key.fill(0);
    keys.clear();
    return unavailable();
  }
}
