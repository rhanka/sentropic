import { describe, expect, it } from 'vitest';
import { a4InvalidatedProofCounts, mapA4Invitation, mapA4Social } from '../../../src/services/identity/cm-import-continuations';
import { expectCustodyCode } from '../../utils/cm-custody-assertions';

describe('A4 continuation source mapping', () => {
  it('should report invalidated proofs by type without publishing their material', () => {
    expect(a4InvalidatedProofCounts(new Map([
      ['webauthn_challenges', [{ challenge: 'private-challenge' }]],
      ['email_verification_codes', [{ verification_token: null }, { verification_token: 'old-seed-ticket' }]],
      ['magic_links', [{ token_hash: 'private-hash' }]],
      ['user_sessions', [{ refresh_token_hash: null }, { refresh_token_hash: 'private-hash' }]],
    ]))).toEqual({ webauthn_challenge: 1, email_code: 2, email_ticket: 1,
      magic_link: 1, login_session: 2, login_refresh_token: 1 });
  });

  it('should preserve invitation consumption and client binding without inventing workspace or tenant grants', () => {
    const row = mapA4Invitation({ id: 'invite', email: 'user@example.test', client_id: 'client', token_hash: 'a'.repeat(64),
      created_at: '2026-10-01T00:00:00', expires_at: '2026-11-01T00:00:00',
      consumed_at: '2026-10-02T00:00:00', consumed_by_user_id: null });
    expect(row).toMatchObject({ status: 'consumed', clientId: 'client', consumedByUserId: null, revision: 0 });
    expect(row.tenantId).toBeNull();
    expect(row.workspaceId).toBeNull();
  });

  it('should refuse every non-null social provider secret before importing an identity', async () => {
    await expectCustodyCode(() => mapA4Social({ token_secret: '' }), 'identity_import_invalid');
  });
});
