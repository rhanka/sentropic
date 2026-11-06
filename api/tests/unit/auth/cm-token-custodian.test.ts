import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { createCmTokenCustodian } from '../../../src/services/identity/cm-token-custodian';

const sessionKey = randomBytes(32);
const ticketKey = randomBytes(32);
const now = '2026-11-01T12:00:00.000Z';
const expiresAt = '2026-11-01T13:00:00.000Z';
const login = { mfaVerified: true, authTime: 1793520000, sessionVersion: 1793520000000 };
const owned: ReturnType<typeof createCmTokenCustodian>[] = [];
const custodian = () => {
  const value = createCmTokenCustodian({ sessionKey, ticketKey });
  owned.push(value);
  return value;
};
afterEach(() => { for (const value of owned.splice(0)) value.dispose(); });

describe('CM host token custodian', () => {
  it('should preserve signed login lineage and issue distinct token candidates', async () => {
    const { loginTokens } = custodian();
    const input = { userId: 'subject', sessionId: 'session', role: 'editor' as const, login, expiresAt };
    const first = await loginTokens.sign({ ...input, tokenUse: 'session' });
    const second = await loginTokens.sign({ ...input, tokenUse: 'session' });
    expect(first).not.toBe(second);
    await expect(loginTokens.verify(Buffer.from(first), 'session', now)).resolves.toMatchObject({
      userId: 'subject', sessionId: 'session', tokenUse: 'session', expiresAt, login,
    });
    await expect(loginTokens.verify(Buffer.from(first), 'refresh', now)).rejects.toMatchObject({ code: 'login_binding_mismatch' });
    await expect(loginTokens.verify(Buffer.from(first), 'session', expiresAt)).rejects.toMatchObject({ code: 'login_binding_mismatch' });
  });

  it('should admit a legacy session without MFA evidence and reject it as a refresh credential', async () => {
    const token = await new SignJWT({ userId: 'subject', sessionId: 'session', role: 'editor' })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(new Date(expiresAt)).sign(sessionKey);
    const { loginTokens } = custodian();
    await expect(loginTokens.verify(Buffer.from(token), 'session', now)).resolves.toMatchObject({ login: null });
    await expect(loginTokens.verify(Buffer.from(token), 'refresh', now)).rejects.toMatchObject({ code: 'login_binding_mismatch' });
  });

  it('should require every immutable login field on signed refresh credentials', async () => {
    const token = await new SignJWT({ userId: 'subject', sessionId: 'session', tokenUse: 'refresh',
      login: { mfaVerified: true, authTime: 123 } })
      .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(new Date(expiresAt)).sign(sessionKey);
    await expect(custodian().loginTokens.verify(Buffer.from(token), 'refresh', now))
      .rejects.toMatchObject({ code: 'login_binding_mismatch' });
  });

  it('should verify expired source tickets for import while preserving normal expiry refusal', async () => {
    const { ticketTokens } = custodian();
    const claims = { email: 'subject@example.test', codeProofId: 'source-code', issuedAt: now, expiresAt };
    const token = await ticketTokens.sign(claims);
    await expect(ticketTokens.verifyForImport(Buffer.from(token))).resolves.toEqual(claims);
    await expect(ticketTokens.verify(Buffer.from(token), expiresAt)).rejects.toMatchObject({ code: 'proof_binding_mismatch' });
    const tampered = `${token.slice(0, token.lastIndexOf('.') + 1)}${Buffer.alloc(32).toString('base64url')}`;
    await expect(ticketTokens.verifyForImport(Buffer.from(tampered))).rejects.toMatchObject({ code: 'proof_binding_mismatch' });
  });

  it('should reject signature-valid tickets whose source binding is incomplete', async () => {
    const token = await new SignJWT({ email: 'subject@example.test' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(1793520000).setExpirationTime(1793523600).sign(ticketKey);
    await expect(custodian().ticketTokens.verifyForImport(Buffer.from(token)))
      .rejects.toMatchObject({ code: 'proof_binding_mismatch' });
  });

  it('should dispose owned keys without modifying the borrowed source keys', async () => {
    const before = Buffer.from(sessionKey);
    const value = custodian();
    value.dispose();
    expect(sessionKey).toEqual(before);
    await expect(value.loginTokens.sign({ userId: 'subject', sessionId: 'session', role: 'editor',
      tokenUse: 'session', login, expiresAt })).rejects.toMatchObject({ code: 'identity_contract_unavailable' });
  });
});
