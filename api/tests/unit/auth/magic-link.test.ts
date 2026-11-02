import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { withAppCmAuth } from '../../../src/services/identity/cm-auth-runtime';
import { sendCmDeferredMail } from '../../../src/services/identity/cm-auth-mail';
import { createCmUser, findCmUserById } from '../../../src/services/identity/cm-users';
import { createCmMagicLink, findCmMagicLinkByTokenHash, sha256Hex } from '../../../src/services/identity/cm-proofs';
import { cmPurgeAllIdentity } from '../../utils/cm-identity-test-store';

const sendTransactionalEmailMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/scw-tem-client', () => ({
  sendTransactionalEmail: sendTransactionalEmailMock,
}));

const generateMagicLink = async (input: { email: string; userId?: string }) => {
  const outcome = await withAppCmAuth(runner => runner.complete('magic_link_issue', binding =>
    binding.magicLink.requestMagicLink(input)));
  if (!outcome.committed || !outcome.value.success) throw new Error('Magic-link fixture issuance failed');
  const text = sendTransactionalEmailMock.mock.calls.at(-1)?.[0]?.text;
  const url = typeof text === 'string' ? text.match(/https?:\/\/[^\s]+/)?.[0] : undefined;
  const token = url ? new URL(url).searchParams.get('token') : null;
  if (!token) throw new Error('Committed magic-link mail was not delivered');
  return { token, expiresAt: outcome.value.expiresAt };
};
const verifyMagicLink = async (token: string) => {
  const outcome = await withAppCmAuth(runner => runner.complete('magic_link', binding =>
    binding.magicLink.verifyMagicLink({ token })));
  if (!outcome.committed || !outcome.value.valid) return { valid: false as const, userId: undefined, email: undefined };
  return { valid: true as const, userId: outcome.value.user.id, email: outcome.value.user.email };
};

describe('Magic Link Service', () => {
  beforeEach(() => {
    sendTransactionalEmailMock.mockReset();
    sendTransactionalEmailMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cmPurgeAllIdentity();
  });

  describe('generateMagicLink', () => {
    it('should generate magic link with token and expiration', async () => {
      const result = await generateMagicLink({ email: 'test@example.com' });

      expect(result.token).toBeDefined();
      expect(result.token.length).toBeGreaterThan(20);
      expect(result.expiresAt).toBeInstanceOf(Date);
      
      // Should expire in ~10 minutes
      const expiresIn = result.expiresAt.getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(9 * 60 * 1000);
      expect(expiresIn).toBeLessThan(11 * 60 * 1000);
    });

    it('should store hashed token in database', async () => {
      const { token } = await generateMagicLink({ email: 'test@example.com' });
      
      // Token should not be stored in plain text
      const record = await findCmMagicLinkByTokenHash(sha256Hex(token));
      
      expect(record).toBeDefined();
      expect(record?.tokenHash).not.toBe(token);
      expect(record?.email).toBe('test@example.com');
      expect(record?.used).toBe(false);
    });
  });

  describe('sendMagicLinkEmail', () => {
    it('should brand the magic-link email as Sentropic', async () => {
      await sendCmDeferredMail({ kind: 'magic_link', email: 'test@example.com', token: 'abc',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        url: 'https://sentropic.sent-tech.ca/auth/magic-link/verify?token=abc' });

      expect(sendTransactionalEmailMock).toHaveBeenCalledWith(expect.objectContaining({
        to: 'test@example.com',
        subject: 'Votre lien de connexion Sentropic',
        text: expect.stringContaining('L’équipe Sentropic'),
        html: expect.stringContaining('L’équipe Sentropic'),
      }));
      expect(JSON.stringify(sendTransactionalEmailMock.mock.calls[0]?.[0])).not.toContain('Top AI Ideas');
    });
  });

  describe('verifyMagicLink', () => {
    it('should verify valid magic link and create new user', async () => {
      const { token } = await generateMagicLink({ email: 'newuser@example.com' });
      
      const result = await verifyMagicLink(token);
      
      expect(result.valid).toBe(true);
      expect(result.userId).toBeDefined();
      expect(result.email).toBe('newuser@example.com');
      
      // User should be created
      const user = await findCmUserById(result.userId!);
      
      expect(user).toBeDefined();
      expect(user?.email).toBe('newuser@example.com');
      expect(user?.emailVerified).toBe(true);
      // New users get immediate access (editor) but are pending admin approval
      expect(user?.role).toBe('editor');
      expect(user?.accountStatus).toBe('pending_admin_approval');
      expect(user?.approvalDueAt).toBeInstanceOf(Date);
    });

    it('should verify magic link for existing user', async () => {
      // Create user first
      const userId = crypto.randomUUID();
      await createCmUser({ userId, email: 'existing@example.com', displayName: 'Existing User', role: 'editor', emailVerified: true, accountStatus: 'active' });
      
      const { token } = await generateMagicLink({ 
        email: 'existing@example.com',
        userId,
      });
      
      const result = await verifyMagicLink(token);
      
      expect(result.valid).toBe(true);
      expect(result.userId).toBe(userId);
    });

    it('should reject invalid token', async () => {
      const result = await verifyMagicLink('invalid-token');
      expect(result.valid).toBe(false);
    });

    it('should reject expired magic link', async () => {
      const token = 'expired-synthetic-magic-link';
      await createCmMagicLink({ email: 'expired@example.test', tokenHash: sha256Hex(token),
        now: new Date(Date.now() - 601_000), expiresAt: new Date(Date.now() - 1000) });
      expect((await verifyMagicLink(token)).valid).toBe(false);
    });

    it('should reject used magic link', async () => {
      const { token } = await generateMagicLink({ email: 'test@example.com' });
      
      // Use it once
      await verifyMagicLink(token);
      
      // Try to use again
      const result = await verifyMagicLink(token);
      expect(result.valid).toBe(false);
    });
  });
});
