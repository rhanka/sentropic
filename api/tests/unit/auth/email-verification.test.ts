import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { generateEmailVerificationCode } from '../../../src/services/email-verification';
import { cmQuery, cmTable } from '../../utils/cm-identity-test-store';

const sendTransactionalEmailMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/scw-tem-client', () => ({
  sendTransactionalEmail: sendTransactionalEmailMock,
}));

describe('Email Verification Service', () => {
  beforeEach(() => {
    sendTransactionalEmailMock.mockReset();
    sendTransactionalEmailMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cmQuery(`DELETE FROM ${cmTable('identity_single_use_proofs')} WHERE kind = 'email_code'`);
  });

  describe('generateEmailVerificationCode', () => {
    it('should brand the verification email as Sentropic', async () => {
      await generateEmailVerificationCode({ email: 'new-user@example.com' });

      expect(sendTransactionalEmailMock).toHaveBeenCalledWith(expect.objectContaining({
        to: 'new-user@example.com',
        subject: 'Votre code de vérification Sentropic',
        text: expect.stringContaining("L'équipe Sentropic"),
        html: expect.stringContaining("L'équipe Sentropic"),
      }));
      expect(JSON.stringify(sendTransactionalEmailMock.mock.calls[0]?.[0])).not.toContain('Top AI Ideas');
    });
  });
});
