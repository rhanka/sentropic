import { createSentropicOAuthHostPorts, createSentropicOAuthStateCodec, getSentropicOAuthPorts, resolveSessionTokenSecret } from '../../routes/auth/oauth';
import { env } from '../../config/env';
import { resolveEmailVerificationTokenSecret } from './cm-token-secrets';
import { getWebAuthnConfig } from '../webauthn-config';
import { sendCmDeferredMail } from './cm-auth-mail';
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
      webAuthnTimeouts: { registration: rp.timeout.registration, authentication: rp.timeout.authentication },
      accountPolicy: {
        normalizeEmail: policy.normalizeEmail, deriveDisplayName: policy.deriveDisplayName,
        resolveUserVerification: () => 'required', roleForNewUser: policy.roleForNewUser,
        statusForNewUser: policy.statusForNewUser,
      },
      emailCodeKeys: codePolicy.policy,
      magicLinkBaseUrl: env.AUTH_CALLBACK_BASE_URL || 'http://localhost:5173',
      registrationContinuation: createSentropicOAuthStateCodec(),
      business: {
        afterUserCreated: (user, tx) => provisionCmAuthWorkspace(user.id, tx),
        provisionWorkspace: provisionCmAuthWorkspace,
      },
      sendDeferredMail: sendCmDeferredMail,
    }));
  } finally { tokens.dispose(); }
}
