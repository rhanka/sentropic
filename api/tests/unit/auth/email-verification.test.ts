import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendCmDeferredMail } from '../../../src/services/identity/cm-auth-mail';

const sendTransactionalEmailMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/scw-tem-client', () => ({
  sendTransactionalEmail: sendTransactionalEmailMock,
}));

describe('Committed CM verification mail delivery', () => {
  beforeEach(() => {
    sendTransactionalEmailMock.mockReset();
    sendTransactionalEmailMock.mockResolvedValue(undefined);
  });

  describe('sendCmDeferredMail', () => {
    it('should brand the verification email as Sentropic', async () => {
      await sendCmDeferredMail({ kind: 'code', email: 'new-user@example.com', code: '123456',
        expiresAt: new Date(Date.now() + 600_000).toISOString() });

      expect(sendTransactionalEmailMock).toHaveBeenCalledWith(expect.objectContaining({
        to: 'new-user@example.com',
        subject: 'Votre code de vérification Sentropic',
        text: expect.stringContaining("L'équipe Sentropic"),
        html: expect.stringContaining("L'équipe Sentropic"),
      }));
      expect(JSON.stringify(sendTransactionalEmailMock.mock.calls[0]?.[0])).not.toContain('Top AI Ideas');
    });
    it('reports delivery failure without leaking transport errors or silently succeeding', async () => {
      sendTransactionalEmailMock.mockRejectedValue(new Error('transport-canary-123456'));
      await expect(sendCmDeferredMail({ kind: 'code', email: 'new-user@example.com', code: '123456',
        expiresAt: new Date(Date.now() + 600_000).toISOString() }))
        .rejects.toThrow(/^identity_mail_delivery_failed$/);
    });
  });
});
