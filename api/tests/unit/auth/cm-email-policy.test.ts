import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadCmEmailCodePolicy } from '../../../src/services/identity/cm-email-policy';

describe('A4 explicit email-code deployment policy', () => {
  it.each([{}, { CM_IDENTITY_EMAIL_CODE_POLICY: '' }, { CM_IDENTITY_EMAIL_CODE_POLICY: 'sha256' }])
  ('should refuse startup without an explicit choice and decision reference', input => {
    expect(() => loadCmEmailCodePolicy(input)).toThrow(expect.objectContaining({ code: 'identity_contract_unavailable' }));
  });

  it('should permit the explicitly approved SHA-256 choice without creating a key', () => {
    const result = loadCmEmailCodePolicy({ CM_IDENTITY_EMAIL_CODE_POLICY: 'sha256',
      CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF: 'owner-decision-test' });
    expect(result.policy).toEqual({ issuance: 'sha256', activeKeyRef: null, previousKeyRefs: [] });
    expect(result.keys.size).toBe(0);
    result.dispose();
  });

  it('should require every active and retained HMAC reader before selecting issuance', () => {
    const keys = { current: randomBytes(32).toString('base64url'), previous: randomBytes(32).toString('base64url') };
    const input = { CM_IDENTITY_EMAIL_CODE_POLICY: 'hmac-sha256', CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF: 'owner-decision-test',
      CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF: 'current', CM_IDENTITY_EMAIL_CODE_PREVIOUS_KEY_REFS_JSON: '["previous"]',
      CM_IDENTITY_EMAIL_CODE_KEYS_JSON: JSON.stringify(keys) };
    const result = loadCmEmailCodePolicy(input);
    expect(result.policy).toEqual({ issuance: 'hmac-sha256', activeKeyRef: 'current', previousKeyRefs: ['previous'] });
    const retained = [...result.keys.values()];
    result.dispose();
    expect(retained.every(key => key.every(byte => byte === 0))).toBe(true);
    expect(() => loadCmEmailCodePolicy({ ...input, CM_IDENTITY_EMAIL_CODE_KEYS_JSON: JSON.stringify({ current: keys.current }) }))
      .toThrow(expect.objectContaining({ code: 'identity_contract_unavailable' }));
  });
});
