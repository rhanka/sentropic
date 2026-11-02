import { describe, expect, it } from 'vitest';
import { mapA4Account, mapA4Credential, mapA4Login, mapA4Proof } from '../../../src/services/identity/cm-import-mapping';

const created = '2026-10-30T12:34:56.789';
const account = { id: 'subject', email: ' Subject@Example.test ', role: 'editor',
  account_status: 'active', email_verified: false, display_name: null,
  approval_due_at: null, approved_at: null, approved_by_user_id: null,
  disabled_at: null, disabled_reason: null, created_at: created, updated_at: null };

describe('A4 source mapping preservation', () => {
  it('should retain the unapproved expired state and original timestamp fallback', () => {
    const result = mapA4Account({ ...account, account_status: 'approval_expired_readonly' });
    expect(result.record).toEqual({ userId: 'subject', email: 'subject@example.test', globalRole: 'editor',
      accountStatus: 'pending_admin_approval', createdAt: `${created}Z`, updatedAt: `${created}Z` });
    expect(result.profile).toMatchObject({ emailVerified: false, displayName: null,
      legacyAccountStatus: 'approval_expired_readonly', approvedAt: null, disabledAt: null });
  });

  it('should refuse missing email and unknown status without inventing data', () => {
    expect(() => mapA4Account({ ...account, email: null })).toThrow('identity_import_invalid');
    expect(() => mapA4Account({ ...account, account_status: 'unexpected' })).toThrow('identity_import_invalid');
  });

  it('should preserve the disabled entry point independently from its descriptive reason', () => {
    const result = mapA4Account({ ...account, account_status: 'disabled_by_user', disabled_reason: 'disabled_by_admin' });
    expect(result.record.accountStatus).toBe('disabled');
    expect(result.profile.legacyAccountStatus).toBe('disabled_by_user');
    expect(result.profile.disabledReason).toBe('disabled_by_admin');
  });

  it('should retain used state with an unknown terminal time and expired pending proofs', () => {
    const source = { id: 'proof', email: 'subject@example.test', code_hash: 'a'.repeat(64),
      created_at: created, expires_at: created, used: true };
    expect(mapA4Proof('email_code', source, { rpId: 'app.test', origins: ['https://app.test'] }))
      .toMatchObject({ kind: 'email_code', state: 'consumed', revision: 0, consumedAt: null,
        revokedAt: null, userId: null, codeDigest: { algorithm: 'sha256', value: 'a'.repeat(64) } });
    expect(mapA4Proof('email_code', { ...source, used: false }, { rpId: 'app.test', origins: ['https://app.test'] }).state)
      .toBe('pending');
  });

  it('should preserve null attestation metadata and initialize credential revision without resetting the counter', () => {
    expect(mapA4Credential({ id: 'proof', user_id: 'subject', credential_id: 'Y3JlZA', public_key_cose: 'cHVibGlj',
      counter: 41, device_name: 'Key', transports_json: '["usb"]', uv: false, created_at: created,
      last_used_at: null }, 'app.test')).toMatchObject({ counter: 41, revision: 0, deviceType: null,
      backedUp: null, revokedAt: null, transports: ['usb'], uv: false });
  });

  it('should retain both login hashes and exact immutable lineage with a zero CAS baseline', () => {
    const result = mapA4Login({ id: 'login', user_id: 'subject', session_token_hash: 'a'.repeat(64),
      refresh_token_hash: null, device_name: null, ip_address: null, user_agent: null, mfa_verified: true,
      created_at: created, expires_at: '2026-11-30T12:34:56.789', last_activity_at: null }, '2026-11-01T00:00:00.000Z');
    expect(result).toMatchObject({ status: 'active', mfaState: 'step_up', refreshCount: 0,
      rotationVersion: 0, refreshTokenHash: null, login: { mfaVerified: true,
        sessionVersion: Date.parse(`${created}Z`), authTime: Math.floor(Date.parse(`${created}Z`) / 1000) } });
    expect(result).not.toHaveProperty('revokedAt');
  });
});
