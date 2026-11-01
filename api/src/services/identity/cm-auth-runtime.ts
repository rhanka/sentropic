import { createSentropicOAuthHostPorts, getSentropicOAuthPorts, resolveSessionTokenSecret } from '../../routes/auth/oauth';
import { env } from '../../config/env';
import { resolveEmailVerificationTokenSecret } from '../email-verification';
import { getWebAuthnConfig } from '../webauthn-config';
import { sendTransactionalEmail } from '../scw-tem-client';
import { createCmAuthRequestRunner } from './cm-auth-binding';
import { createCmTokenCustodian } from './cm-token-custodian';
import { loadCmEmailCodePolicy } from './cm-email-policy';
import { provisionCmAuthWorkspace } from './cm-auth-workspace';

/** Load immutable host configuration and keys before entering any CM callback. */
export async function withAppCmAuth<T>(operation: (runner: ReturnType<typeof createCmAuthRequestRunner>) => Promise<T>): Promise<T> {
  const codePolicy = loadCmEmailCodePolicy();
  const sessionKey = new TextEncoder().encode(resolveSessionTokenSecret());
  const ticketKey = new TextEncoder().encode(resolveEmailVerificationTokenSecret());
  const tokens = (() => {
    try { return createCmTokenCustodian({ sessionKey, ticketKey, emailCodeKeys: codePolicy.keys }); }
    finally { sessionKey.fill(0); ticketKey.fill(0); codePolicy.dispose(); }
  })();
  try {
    const rp = getWebAuthnConfig();
    const policy = getSentropicOAuthPorts().accountPolicy;
    return await operation(createCmAuthRequestRunner({
      hostPortsForTransaction: createSentropicOAuthHostPorts, tokens,
      rp: { id: rp.rpID, name: rp.rpName, expectedOrigins: typeof rp.origin === 'string' ? [rp.origin] : [...rp.origin] },
      accountPolicy: {
        normalizeEmail: policy.normalizeEmail, deriveDisplayName: policy.deriveDisplayName,
        resolveUserVerification: () => 'required', roleForNewUser: policy.roleForNewUser,
        statusForNewUser: policy.statusForNewUser,
      },
      emailCodeKeys: codePolicy.policy,
      magicLinkBaseUrl: env.AUTH_CALLBACK_BASE_URL || 'http://localhost:5173',
      business: {
        afterUserCreated: (user, tx) => provisionCmAuthWorkspace(user.id, tx),
        provisionWorkspace: provisionCmAuthWorkspace,
      },
      async sendDeferredMail(intent) {
        try {
          await sendTransactionalEmail({ to: intent.email,
            subject: intent.kind === 'code' ? 'Your Sentropic verification code' : 'Your Sentropic sign-in link',
            text: intent.kind === 'code' ? `Your verification code is ${intent.code}.` : `Sign in: ${intent.url}` });
        } catch { throw new Error('identity_mail_delivery_failed'); }
      },
    }));
  } finally { tokens.dispose(); }
}
