import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { mapA4EmailTicket, mapA4Invitation, mapA4Social } from '../../../src/services/identity/cm-import-continuations';
import { createCmTokenCustodian } from '../../../src/services/identity/cm-token-custodian';

describe('A4 continuation source mapping', () => {
  it('should verify an expired source token while retaining its exact digest, expiry and pending ticket lifecycle', async () => {
    const key = new TextEncoder().encode('synthetic-source-key-for-import-test');
    const tokens = createCmTokenCustodian({ sessionKey: key, ticketKey: key, emailCodeKeys: new Map() });
    try {
      const token = await new SignJWT({ email: 'user@example.test', codeId: 'code' })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt(100).setExpirationTime(200).sign(key);
      const ticket = await mapA4EmailTicket({ id: 'code', email: 'user@example.test', used: true,
        verification_token: token }, tokens.ticketTokens);
      expect(ticket).toMatchObject({ codeProofId: 'code', state: 'pending', revision: 0,
        createdAt: '1970-01-01T00:01:40.000Z', expiresAt: '1970-01-01T00:03:20.000Z', consumedAt: null });
      await expect(mapA4EmailTicket({ id: 'other', email: 'user@example.test', used: true,
        verification_token: token }, tokens.ticketTokens)).rejects.toThrow('identity_import_invalid');
    } finally { key.fill(0); tokens.dispose(); }
  });

  it('should preserve invitation consumption and client binding without inventing workspace or tenant grants', () => {
    const row = mapA4Invitation({ id: 'invite', email: 'user@example.test', client_id: 'client', token_hash: 'a'.repeat(64),
      created_at: '2026-10-01T00:00:00', expires_at: '2026-11-01T00:00:00',
      consumed_at: '2026-10-02T00:00:00', consumed_by_user_id: null });
    expect(row).toMatchObject({ status: 'consumed', clientId: 'client', consumedByUserId: null, revision: 0 });
    expect(row).not.toHaveProperty('tenantId');
    expect(row).not.toHaveProperty('workspaceId');
  });

  it('should refuse every non-null social provider secret before importing an identity', () => {
    expect(() => mapA4Social({ token_secret: '' })).toThrow('identity_import_invalid');
  });
});
